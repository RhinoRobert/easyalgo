"""Unsigned Pera/Ledger deployment tooling for PNET Instant Launchpad v3.

This module never accepts a mnemonic or private key and never submits a
transaction. It prepares reproducible unsigned payloads, and separately
verifies confirmed create/initialize transactions before writing a non-secret
local manifest.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path

import algosdk
from algosdk import abi, transaction
from algosdk.v2client import algod

from launchpad_v3._constants import (  # read from contract.py's source: importing it needs the Puya-only `algopy`
    APP_SAFETY_CUSHION,
    INITIALIZE_FUNDING,
    MAINNET_CANCEL_DELAY_ROUNDS,
    PLATFORM_WALLET_ADDRESS,
)
from launchpad_v3.network import BROKEN_V2_APP_ID, NETWORKS, PRODUCTION_LAUNCHPAD_APP_ID, NetworkConfig


HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts" / "launchpad_v3"
ARC56 = ARTIFACTS / "PNETInstantLaunchpad.arc56.json"
BUILD_MANIFEST = HERE / "build-manifest.json"
GLOBAL_UINTS = 9
GLOBAL_BYTES = 2


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_build_manifest() -> dict:
    manifest = json.loads(BUILD_MANIFEST.read_text(encoding="utf-8"))
    expected = manifest.get("sha256", {})
    files = {
        "contract": HERE / "contract.py",
        "arc56": ARC56,
        "approvalTeal": ARTIFACTS / "PNETInstantLaunchpad.approval.teal",
        "clearTeal": ARTIFACTS / "PNETInstantLaunchpad.clear.teal",
    }
    for name, path in files.items():
        if not path.exists() or _sha256(path) != expected.get(name):
            raise SystemExit(f"Build artifact drift detected for {name}; compile again")
    return manifest


def _guard(network: str) -> None:
    expected = network.upper()
    if os.environ.get("ALLOW_LAUNCHPAD_V3_DEPLOY") != expected:
        raise SystemExit(f"Set ALLOW_LAUNCHPAD_V3_DEPLOY={expected} to prepare {network}")
    if network == "mainnet":
        phrase = f"{PRODUCTION_LAUNCHPAD_APP_ID}-REMAINS-UNTOUCHED"
        if os.environ.get("CONFIRM_NEW_MAINNET_APP") != phrase:
            raise SystemExit(f"Set CONFIRM_NEW_MAINNET_APP={phrase}")


def _resolved_config(network: str) -> tuple[NetworkConfig, int, str]:
    if network not in NETWORKS:
        raise SystemExit("Network must be testnet or mainnet")
    config = NETWORKS[network]
    pnet_id = config.pnet_asset_id
    source_pool = config.source_pool_address
    if network == "testnet":
        pnet_id = int(os.environ.get("LAUNCHPAD_V3_PNET_ASSET_ID", "0"))
        source_pool = os.environ.get("LAUNCHPAD_V3_SOURCE_POOL", "").strip()
    if pnet_id <= 0:
        raise SystemExit("A six-decimal PNET/mock-PNET asset ID is required")
    if not algosdk.encoding.is_valid_address(source_pool):
        raise SystemExit("A valid Tinyman v2 ALGO/PNET source-pool address is required")
    return config, pnet_id, source_pool


def _local_state(account: dict, app_id: int) -> dict[bytes, int | bytes]:
    for entry in account.get("apps-local-state", []):
        if int(entry["id"]) != app_id:
            continue
        result: dict[bytes, int | bytes] = {}
        for item in entry.get("key-value", []):
            key = base64.b64decode(item["key"])
            value = item["value"]
            result[key] = int(value["uint"]) if int(value["type"]) == 2 else base64.b64decode(value["bytes"])
        return result
    raise RuntimeError("Source pool is not opted into the configured Tinyman validator")


def _global_state(app: dict) -> dict[bytes, int | bytes]:
    result: dict[bytes, int | bytes] = {}
    for item in app["params"].get("global-state", []):
        key = base64.b64decode(item["key"])
        value = item["value"]
        result[key] = int(value["uint"]) if int(value["type"]) == 2 else base64.b64decode(value["bytes"])
    return result


def _preflight(client: algod.AlgodClient, config: NetworkConfig, pnet_id: int, source_pool: str) -> None:
    params = client.suggested_params()
    if params.gen != config.genesis_id or params.gh != config.genesis_hash:
        raise RuntimeError("Algod genesis does not match the selected network")
    asset = client.asset_info(pnet_id)["params"]
    if int(asset["decimals"]) != 6:
        raise RuntimeError("Configured PNET asset must use exactly six decimals")
    for label, app_id in (
        ("Tinyman", config.tinyman_app_id),
        ("Vestige", config.vestige_app_id),
        ("ARC-54", config.arc54_app_id),
    ):
        if int(client.application_info(app_id)["id"]) != app_id:
            raise RuntimeError(f"{label} application lookup mismatch")
    burn_address = algosdk.logic.get_application_address(config.arc54_app_id)
    if burn_address != config.arc54_address:
        raise RuntimeError("ARC-54 application/address invariant failed")
    pool_state = _local_state(client.account_info(source_pool), config.tinyman_app_id)
    if (
        pool_state.get(b"asset_1_id") != pnet_id
        or pool_state.get(b"asset_2_id") != 0
        or int(pool_state.get(b"pool_token_asset_id", 0)) <= 0
    ):
        raise RuntimeError("Source pool is not the configured PNET/ALGO Tinyman v2 pool")
    if (
        config.source_pool_lp_asset_id
        and int(pool_state.get(b"pool_token_asset_id", 0)) != config.source_pool_lp_asset_id
    ):
        raise RuntimeError("Source pool LP asset does not match the pinned deployment")
    platform = client.account_info(PLATFORM_WALLET_ADDRESS)
    platform_assets = {
        int(item["asset-id"]): int(item["amount"])
        for item in platform.get("assets", [])
    }
    if pnet_id not in platform_assets:
        raise RuntimeError(
            "Hardcoded platform authority must opt into PNET before deployment so timed cancellation cannot lock"
        )


def _artifact_data() -> tuple[dict, bytes, bytes, dict]:
    build = _verify_build_manifest()
    artifact = json.loads(ARC56.read_text(encoding="utf-8"))
    approval = base64.b64decode(artifact["byteCode"]["approval"])
    clear = base64.b64decode(artifact["byteCode"]["clear"])
    return artifact, approval, clear, build


def _write_package(network: str, stage: str, payload: dict) -> Path:
    output = HERE / f"deployment-{network}-{stage}.unsigned.local.json"
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    return output


def prepare_create(network: str, deployer: str) -> Path:
    _guard(network)
    if deployer != PLATFORM_WALLET_ADDRESS:
        raise SystemExit("Connect the hardcoded platform-authority account before deployment")
    config, pnet_id, source_pool = _resolved_config(network)
    client = algod.AlgodClient("", config.algod_url)
    _preflight(client, config, pnet_id, source_pool)
    _artifact, approval, clear, build = _artifact_data()
    params = client.suggested_params()
    params.flat_fee = True
    params.fee = 1_000
    selector = abi.Method.from_signature(
        "create(address,address,uint64,uint64,uint64,uint64,uint64)void"
    ).get_selector()
    burn_address = algosdk.logic.get_application_address(config.arc54_app_id)
    cancel_delay = MAINNET_CANCEL_DELAY_ROUNDS if network == "mainnet" else int(os.environ.get("LAUNCHPAD_V3_CANCEL_DELAY", MAINNET_CANCEL_DELAY_ROUNDS))
    create = transaction.ApplicationCreateTxn(
        sender=deployer,
        sp=params,
        on_complete=transaction.OnComplete.NoOpOC,
        approval_program=approval,
        clear_program=clear,
        global_schema=transaction.StateSchema(num_uints=GLOBAL_UINTS, num_byte_slices=GLOBAL_BYTES),
        local_schema=transaction.StateSchema(num_uints=0, num_byte_slices=0),
        extra_pages=max(0, (len(approval) + len(clear) - 1) // 2_048),
        app_args=[
            selector,
            algosdk.encoding.decode_address(burn_address),
            algosdk.encoding.decode_address(source_pool),
            pnet_id.to_bytes(8, "big"),
            config.tinyman_app_id.to_bytes(8, "big"),
            config.vestige_app_id.to_bytes(8, "big"),
            config.arc54_app_id.to_bytes(8, "big"),
            cancel_delay.to_bytes(8, "big"),
        ],
        accounts=[source_pool],
        foreign_apps=[config.tinyman_app_id, config.vestige_app_id, config.arc54_app_id],
        foreign_assets=[pnet_id],
        note=b"PNET Instant Launchpad v3 create",
    )
    payload = {
        "schemaVersion": 3,
        "stage": "create",
        "network": network,
        "deployer": deployer,
        "requiresAuthority": PLATFORM_WALLET_ADDRESS,
        "unsignedTransactions": [algosdk.encoding.msgpack_encode(create)],
        "transactionIds": [create.get_txid()],
        "networkConfig": {
            "pnetAssetId": pnet_id,
            "sourcePool": source_pool,
            "tinymanAppId": config.tinyman_app_id,
            "vestigeAppId": config.vestige_app_id,
            "arc54AppId": config.arc54_app_id,
            "arc54Address": burn_address,
        },
        "artifacts": {
            "arc56Sha256": _sha256(ARC56),
            "approvalSha256": hashlib.sha256(approval).hexdigest(),
            "clearSha256": hashlib.sha256(clear).hexdigest(),
            "sourceSha256": build["sha256"]["contract"],
            "compiler": build["compiler"],
            "clientGenerator": build["clientGenerator"],
        },
        "legacyProductionAppUntouched": PRODUCTION_LAUNCHPAD_APP_ID,
    }
    return _write_package(network, "create", payload)


def prepare_initialize(network: str, deployer: str, app_id: int) -> Path:
    _guard(network)
    if deployer != PLATFORM_WALLET_ADDRESS:
        raise SystemExit("Connect the hardcoded platform-authority account before initialization")
    if app_id <= 0 or app_id in (PRODUCTION_LAUNCHPAD_APP_ID, BROKEN_V2_APP_ID):
        raise SystemExit("Refusing invalid, legacy production or unfinishable v2 App ID")
    config, pnet_id, source_pool = _resolved_config(network)
    client = algod.AlgodClient("", config.algod_url)
    _preflight(client, config, pnet_id, source_pool)
    _artifact, approval, clear, build = _artifact_data()
    app_address = algosdk.logic.get_application_address(app_id)
    params = client.suggested_params()
    params.flat_fee = True
    params.fee = 1_000
    payment = transaction.PaymentTxn(
        sender=deployer,
        sp=params,
        receiver=app_address,
        amt=INITIALIZE_FUNDING,
        note=b"PNET Launchpad v3 MBR and safety cushion",
    )
    call_params = client.suggested_params()
    call_params.flat_fee = True
    call_params.fee = 2_000
    selector = abi.Method.from_signature("initialize(pay)void").get_selector()
    call = transaction.ApplicationNoOpTxn(
        sender=deployer,
        sp=call_params,
        index=app_id,
        app_args=[selector, b"\x00"],
        foreign_assets=[pnet_id],
        note=b"PNET Launchpad v3 initialize",
    )
    payment, call = transaction.assign_group_id([payment, call])
    payload = {
        "schemaVersion": 3,
        "stage": "initialize",
        "network": network,
        "deployer": deployer,
        "appId": app_id,
        "appAddress": app_address,
        "fundingAmount": INITIALIZE_FUNDING,
        "requiresAuthority": PLATFORM_WALLET_ADDRESS,
        "unsignedTransactions": [
            algosdk.encoding.msgpack_encode(payment),
            algosdk.encoding.msgpack_encode(call),
        ],
        "transactionIds": [payment.get_txid(), call.get_txid()],
        "networkConfig": {
            "pnetAssetId": pnet_id,
            "sourcePool": source_pool,
            "tinymanAppId": config.tinyman_app_id,
            "vestigeAppId": config.vestige_app_id,
            "arc54AppId": config.arc54_app_id,
            "arc54Address": config.arc54_address,
        },
        "artifacts": {
            "arc56Sha256": _sha256(ARC56),
            "approvalSha256": hashlib.sha256(approval).hexdigest(),
            "clearSha256": hashlib.sha256(clear).hexdigest(),
            "sourceSha256": build["sha256"]["contract"],
            "compiler": build["compiler"],
            "clientGenerator": build["clientGenerator"],
        },
        "legacyProductionAppUntouched": PRODUCTION_LAUNCHPAD_APP_ID,
    }
    return _write_package(network, "initialize", payload)


def verify_and_record(network: str, app_id: int, create_tx_id: str, initialize_tx_id: str) -> Path:
    if app_id <= 0 or app_id in (PRODUCTION_LAUNCHPAD_APP_ID, BROKEN_V2_APP_ID):
        raise SystemExit("Refusing invalid, legacy production or unfinishable v2 App ID")
    config, pnet_id, source_pool = _resolved_config(network)
    client = algod.AlgodClient("", config.algod_url)
    _preflight(client, config, pnet_id, source_pool)
    _artifact, approval, clear, build = _artifact_data()
    create_info = client.pending_transaction_info(create_tx_id)
    initialize_info = client.pending_transaction_info(initialize_tx_id)
    if int(create_info.get("confirmed-round", 0)) <= 0 or int(initialize_info.get("confirmed-round", 0)) <= 0:
        raise RuntimeError("Create and initialize transactions must both be confirmed")
    if int(create_info.get("application-index", 0)) != app_id:
        raise RuntimeError("Create transaction does not identify the supplied App ID")

    app = client.application_info(app_id)
    params = app["params"]
    if params.get("creator") != PLATFORM_WALLET_ADDRESS:
        raise RuntimeError("On-chain application creator is not the hardcoded platform authority")
    if base64.b64decode(params["approval-program"]) != approval:
        raise RuntimeError("On-chain approval program differs from reviewed artifact")
    if base64.b64decode(params["clear-state-program"]) != clear:
        raise RuntimeError("On-chain clear program differs from reviewed artifact")
    if int(params["global-state-schema"]["num-uint"]) != GLOBAL_UINTS:
        raise RuntimeError("On-chain global uint schema mismatch")
    if int(params["global-state-schema"]["num-byte-slice"]) != GLOBAL_BYTES:
        raise RuntimeError("On-chain global byte schema mismatch")
    if int(params["local-state-schema"]["num-uint"]) != 0 or int(
        params["local-state-schema"]["num-byte-slice"]
    ) != 0:
        raise RuntimeError("On-chain local schema mismatch")
    expected_extra_pages = max(0, (len(approval) + len(clear) - 1) // 2_048)
    if int(params.get("extra-program-pages", 0)) != expected_extra_pages:
        raise RuntimeError("On-chain extra program pages mismatch")
    state = _global_state(app)
    expected_burn = algosdk.encoding.decode_address(config.arc54_address)
    expected_source = algosdk.encoding.decode_address(source_pool)
    expected = {
        b"pnet": pnet_id,
        b"tinyman": config.tinyman_app_id,
        b"vestige": config.vestige_app_id,
        b"arc54": config.arc54_app_id,
        b"burn": expected_burn,
        b"source": expected_source,
        b"init": 1,
        b"delay": MAINNET_CANCEL_DELAY_ROUNDS if network == "mainnet" else state.get(b"delay"),
    }
    for key, value in expected.items():
        if state.get(key) != value:
            raise RuntimeError(f"On-chain configuration mismatch for {key!r}")
    app_address = algosdk.logic.get_application_address(app_id)
    account = client.account_info(app_address)
    holdings = {int(item["asset-id"]): int(item["amount"]) for item in account.get("assets", [])}
    if pnet_id not in holdings:
        raise RuntimeError("Launchpad app is not opted into PNET")
    if int(account["amount"]) - int(account["min-balance"]) < APP_SAFETY_CUSHION:
        raise RuntimeError("Launchpad app does not retain the required safety cushion")

    manifest = {
        "schemaVersion": 1,
        "network": network,
        "appId": app_id,
        "appAddress": app_address,
        "createTxId": create_tx_id,
        "initializeTxId": initialize_tx_id,
        "createRound": int(create_info["confirmed-round"]),
        "initializeRound": int(initialize_info["confirmed-round"]),
        "status": "initialized-chain-verified",
        "pnetAssetId": pnet_id,
        "sourcePool": source_pool,
        "tinymanAppId": config.tinyman_app_id,
        "vestigeAppId": config.vestige_app_id,
        "arc54AppId": config.arc54_app_id,
        "platformAuthority": PLATFORM_WALLET_ADDRESS,
        "approvalSha256": hashlib.sha256(approval).hexdigest(),
        "clearSha256": hashlib.sha256(clear).hexdigest(),
        "arc56Sha256": _sha256(ARC56),
        "sourceSha256": build["sha256"]["contract"],
        "compiler": build["compiler"],
        "legacyProductionAppUntouched": PRODUCTION_LAUNCHPAD_APP_ID,
    }
    output = HERE / f"deployment-{network}.local.json"
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("prepare-create")
    create.add_argument("network", choices=NETWORKS)
    create.add_argument("deployer")
    initialize = sub.add_parser("prepare-initialize")
    initialize.add_argument("network", choices=NETWORKS)
    initialize.add_argument("deployer")
    initialize.add_argument("app_id", type=int)
    record = sub.add_parser("verify-record")
    record.add_argument("network", choices=NETWORKS)
    record.add_argument("app_id", type=int)
    record.add_argument("create_tx_id")
    record.add_argument("initialize_tx_id")
    args = parser.parse_args()
    if args.command == "prepare-create":
        output = prepare_create(args.network, args.deployer)
    elif args.command == "prepare-initialize":
        output = prepare_initialize(args.network, args.deployer, args.app_id)
    else:
        output = verify_and_record(
            args.network, args.app_id, args.create_tx_id, args.initialize_tx_id,
        )
    print(output)


if __name__ == "__main__":
    main()
