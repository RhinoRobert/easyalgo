"""Private-devnet helpers for the launchpad end-to-end tests. Never MainNet: ``Dev.connect`` refuses a non-local algod."""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from algosdk import account, encoding, logic, mnemonic
from algosdk import transaction as tx
from algosdk.abi import Method
from algosdk.v2client.algod import AlgodClient

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures"
CONFIG = HERE / "devnet.local.json"
MIN_FEE = 1_000
ALGO = 0


def _schema(ints: int, slices: int) -> tx.StateSchema:
    return tx.StateSchema(num_uints=ints, num_byte_slices=slices)


def selector(signature: str) -> bytes:
    return Method.from_signature(signature).get_selector()


def u64(value: int) -> bytes:
    return int(value).to_bytes(8, "big")


@dataclass
class Dev:
    algod: AlgodClient
    funder_sk: str
    funder: str
    _teal_cache: dict[str, bytes] = field(default_factory=dict)

    @classmethod
    def connect(cls) -> "Dev":
        cfg = json.loads(CONFIG.read_text("utf-8"))
        if "127.0.0.1" not in cfg["algod"]:
            raise RuntimeError("the launchpad test kit only talks to a local private devnet")
        client = AlgodClient(cfg["token"], cfg["algod"])
        return cls(client, mnemonic.to_private_key(cfg["mnemonic"]), cfg["address"])

    # -- plumbing ---------------------------------------------------------------------------------------------------
    def params(self, fee: int = MIN_FEE) -> tx.SuggestedParams:
        sp = self.algod.suggested_params()
        sp.flat_fee, sp.fee = True, fee
        return sp

    def send(self, txns: list[tx.Transaction], signers: list[Any], wait: bool = True) -> dict[str, Any]:
        """Group (when more than one), sign each (a secret key, or a LogicSigAccount) and submit."""
        if len(txns) > 1:
            tx.assign_group_id(txns)
        signed = []
        for txn, signer in zip(txns, signers, strict=True):
            if isinstance(signer, tx.LogicSigAccount):
                signed.append(tx.LogicSigTransaction(txn, signer))
            else:
                signed.append(txn.sign(signer))
        txid = self.algod.send_transactions(signed)
        return self.wait(txid) if wait else {"txid": txid}

    def wait(self, txid: str, seconds: float = 20.0) -> dict[str, Any]:
        """A dev-mode chain makes a block per transaction, so poll instead of waiting for the next block."""
        deadline = time.time() + seconds
        while time.time() < deadline:
            info = self.algod.pending_transaction_info(txid)
            if info.get("confirmed-round"):
                return info
            if info.get("pool-error"):
                raise RuntimeError(info["pool-error"])
            time.sleep(0.05)
        raise TimeoutError(f"{txid} not confirmed in {seconds}s")

    def compile(self, teal: str) -> bytes:
        if teal not in self._teal_cache:
            self._teal_cache[teal] = base64.b64decode(self.algod.compile(teal)["result"])
        return self._teal_cache[teal]

    def round(self) -> int:
        return int(self.algod.status()["last-round"])

    def advance(self, rounds: int) -> None:
        """Dev mode only produces blocks when a transaction arrives: send throwaway payments to move the round."""
        sk, addr = account.generate_account()
        for _ in range(rounds):
            self.send([tx.PaymentTxn(self.funder, self.params(), addr, 0)], [self.funder_sk])

    # -- accounts and balances --------------------------------------------------------------------------------------
    def new_account(self, algo: int = 100_000_000_000) -> tuple[str, str]:
        sk, addr = account.generate_account()
        self.send([tx.PaymentTxn(self.funder, self.params(), addr, algo)], [self.funder_sk])
        return sk, addr

    def balance(self, address: str, asset: int = ALGO) -> int:
        info = self.algod.account_info(address)
        if asset == ALGO:
            return int(info["amount"]) - int(info.get("rewards", 0))
        for held in info.get("assets", []):
            if held["asset-id"] == asset:
                return int(held["amount"])
        return 0

    def holds(self, address: str, asset: int) -> bool:
        return any(h["asset-id"] == asset for h in self.algod.account_info(address).get("assets", []))

    def create_asset(self, sk: str, addr: str, name: str, total: int = 10**16, decimals: int = 6) -> int:
        txn = tx.AssetConfigTxn(
            addr, self.params(), total=total, decimals=decimals, default_frozen=False, unit_name=name[:8],
            asset_name=name, strict_empty_address_check=False,
        )
        return int(self.send([txn], [sk])["asset-index"])

    def opt_in(self, sk: str, addr: str, asset: int) -> None:
        self.send([tx.AssetTransferTxn(addr, self.params(), addr, 0, asset)], [sk])

    def transfer(self, sk: str, sender: str, receiver: str, asset: int, amount: int) -> None:
        self.send([tx.AssetTransferTxn(sender, self.params(), receiver, amount, asset)], [sk])

    # -- apps -------------------------------------------------------------------------------------------------------
    def deploy_fixture(self, name: str, sk: str, addr: str, app_args: list[bytes] | None = None) -> int:
        """Deploy an unchanged copy of a real MainNet program saved by fetch_fixtures.py."""
        fx = json.loads((FIXTURES / f"{name}.json").read_text("utf-8"))
        g, loc = fx["global-state-schema"], fx["local-state-schema"]
        txn = tx.ApplicationCreateTxn(
            addr, self.params(), tx.OnComplete.NoOpOC,
            base64.b64decode(fx["approval-program"]), base64.b64decode(fx["clear-state-program"]),
            _schema(g["num-uint"], g["num-byte-slice"]), _schema(loc["num-uint"], loc["num-byte-slice"]),
            app_args=app_args, extra_pages=fx.get("extra-program-pages", 0),
        )
        app = int(self.send([txn], [sk])["application-index"])
        # Program accounts need a base balance before they can hold anything.
        self.send([tx.PaymentTxn(self.funder, self.params(), logic.get_application_address(app), 1_000_000)], [self.funder_sk])
        return app

    def app_local(self, address: str, app_id: int) -> dict[str, int | bytes]:
        """Decoded local state of ``address`` for ``app_id`` (empty dict when not opted in)."""
        info = self.algod.account_info(address)
        for local in info.get("apps-local-state", []):
            if local["id"] == app_id:
                out: dict[str, int | bytes] = {}
                for kv in local.get("key-value", []):
                    key = base64.b64decode(kv["key"]).decode("latin1")
                    out[key] = kv["value"]["uint"] if kv["value"]["type"] == 2 else base64.b64decode(kv["value"]["bytes"])
                return out
        return {}

    def app_global(self, app_id: int) -> dict[str, int | bytes]:
        info = self.algod.application_info(app_id)
        out: dict[str, int | bytes] = {}
        for kv in info["params"].get("global-state", []):
            key = base64.b64decode(kv["key"]).decode("latin1")
            out[key] = kv["value"]["uint"] if kv["value"]["type"] == 2 else base64.b64decode(kv["value"]["bytes"])
        return out

    def box(self, app_id: int, name: bytes) -> bytes | None:
        try:
            return base64.b64decode(self.algod.application_box_by_name(app_id, name)["value"])
        except Exception:  # noqa: BLE001 - algod answers 404 for a missing box
            return None


# -- Tinyman v2 on the devnet (the real validator program, unchanged) ---------------------------------------------------
POOL_LOGICSIG_TEMPLATE = base64.b64decode("BoAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgQBbNQA0ADEYEkQxGYEBEkSBAUM=")


@dataclass
class Tinyman:
    dev: Dev
    app_id: int

    @classmethod
    def deploy(cls, dev: Dev) -> "Tinyman":
        sk, addr = dev.new_account()
        return cls(dev, dev.deploy_fixture("tinyman_v2", sk, addr))

    @property
    def app_address(self) -> str:
        return logic.get_application_address(self.app_id)

    def pool_logicsig(self, asset_a: int, asset_b: int) -> tx.LogicSigAccount:
        a1, a2 = max(asset_a, asset_b), min(asset_a, asset_b)
        program = POOL_LOGICSIG_TEMPLATE[:3] + u64(self.app_id) + u64(a1) + u64(a2) + POOL_LOGICSIG_TEMPLATE[27:]
        return tx.LogicSigAccount(program)

    def pool_address(self, asset_a: int, asset_b: int) -> str:
        return self.pool_logicsig(asset_a, asset_b).address()

    def bootstrap_txns(self, user: str, asset_a: int, asset_b: int) -> tuple[list[tx.Transaction], tx.LogicSigAccount]:
        """The two-transaction bootstrap pair exactly as the Tinyman JS SDK builds it (fee 7000 ASA/ASA, 6000 ASA/ALGO)."""
        a1, a2 = max(asset_a, asset_b), min(asset_a, asset_b)
        lsig = self.pool_logicsig(a1, a2)
        pool = lsig.address()
        asa_algo = a2 == ALGO
        call_fee = (6 if asa_algo else 7) * MIN_FEE
        funding = 949_000 + (0 if asa_algo else 100_000) + 0  # replaced below by the SDK-derived constant
        funding = (1_049_000 - 100_000 - MIN_FEE) if asa_algo else 1_049_000
        pay = tx.PaymentTxn(user, self.dev.params(), pool, funding)
        call = tx.ApplicationOptInTxn(
            pool, self.dev.params(call_fee), self.app_id, app_args=[b"bootstrap"], foreign_assets=[a1, a2],
            rekey_to=self.app_address,
        )
        return [pay, call], lsig

    def bootstrap(self, user_sk: str, user: str, asset_a: int, asset_b: int) -> str:
        txns, lsig = self.bootstrap_txns(user, asset_a, asset_b)
        self.dev.send(txns, [user_sk, lsig])
        return lsig.address()

    def pool_state(self, asset_a: int, asset_b: int) -> dict[str, int | bytes]:
        return self.dev.app_local(self.pool_address(asset_a, asset_b), self.app_id)

    def add_initial_liquidity(self, user_sk: str, user: str, asset_a: int, asset_b: int, amount_a: int, amount_b: int) -> int:
        a1, a2 = max(asset_a, asset_b), min(asset_a, asset_b)
        amounts = {asset_a: amount_a, asset_b: amount_b}
        pool = self.pool_address(a1, a2)
        lp = int(self.pool_state(a1, a2)["pool_token_asset_id"])
        if not self.dev.holds(user, lp):
            self.dev.opt_in(user_sk, user, lp)

        def leg(asset: int, amount: int, fee: int = MIN_FEE) -> tx.Transaction:
            if asset == ALGO:
                return tx.PaymentTxn(user, self.dev.params(fee), pool, amount)
            return tx.AssetTransferTxn(user, self.dev.params(fee), pool, amount, asset)

        call = tx.ApplicationNoOpTxn(
            user, self.dev.params(3 * MIN_FEE), self.app_id, app_args=[b"add_initial_liquidity"], accounts=[pool],
            foreign_assets=[lp],
        )
        self.dev.send([leg(a1, amounts[a1]), leg(a2, amounts[a2]), call], [user_sk] * 3)
        return lp

    def swap_fixed_input(self, user_sk: str, user: str, asset_in: int, asset_out: int, amount: int, minimum_out: int = 0) -> None:
        pool = self.pool_address(asset_in, asset_out)
        leg = (
            tx.PaymentTxn(user, self.dev.params(), pool, amount) if asset_in == ALGO
            else tx.AssetTransferTxn(user, self.dev.params(), pool, amount, asset_in)
        )
        call = tx.ApplicationNoOpTxn(
            user, self.dev.params(4 * MIN_FEE), self.app_id, app_args=[b"swap", b"fixed-input", u64(minimum_out)],
            accounts=[pool], foreign_assets=[a for a in (asset_in, asset_out) if a != ALGO] + ([ALGO] if ALGO in (asset_in, asset_out) else []),
        )
        self.dev.send([leg, call], [user_sk, user_sk])
