"""Protocol deployment and launchpad v3 call builders for the end-to-end tests (private devnet only)."""

from __future__ import annotations

import base64
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from algosdk import logic
from algosdk import transaction as tx
from algosdk.abi import Method
from algosdk.atomic_transaction_composer import (
    AccountTransactionSigner,
    AtomicTransactionComposer,
    LogicSigTransactionSigner,
    TransactionWithSigner,
)
from algosdk.encoding import decode_address

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from launchpad_v3._constants import CONSTANTS  # noqa: E402

from devkit import ALGO, Dev, MIN_FEE, Tinyman, u64  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parents[1] / "launchpad_v3" / "artifacts" / "launchpad_v3"
C = CONSTANTS

M_CREATE = "create(address,address,uint64,uint64,uint64,uint64,uint64)void"
M_INITIALIZE = "initialize(pay)void"
M_START = "launch_start(pay,string,string,uint64,string,uint64,uint64)uint64"
M_FINISH = "launch_finish(pay,uint64,address,uint64)void"
M_CLAIM = "claim_creator_lp(axfer,uint64)void"
M_CANCEL = "cancel_launch(uint64)void"
M_BUDGET = "budget()void"
M_VESTIGE = "grant_vestige_access(pay,uint64)void"
M_RELEASE_PLATFORM = "release_platform_allocation(uint64,address,uint64)uint64"
M_RELEASE_PNET = "release_cancelled_pnet(uint64)uint64"

# Realistic MainNet-like source pool: about 20,500 PNET per ALGO, price impact below 1% for the 1 ALGO swap.
SOURCE_POOL_PNET = 2_800_000 * 10**6
SOURCE_POOL_ALGO = 135 * 10**6


def _reason(message: str) -> str:
    """algod echoes the whole signed transaction before the reason; keep only the reason."""
    import re
    match = re.search(r"(logic eval error.*|overspend.*|below min.*|transaction pool.*|asset .*|account .*|invalid .*|fee .*)$", message, re.S)
    return (match.group(1) if match else message[-400:])[:600]


class TxFailed(Exception):
    """A transaction group the node refused or the AVM rejected (message = algod's text)."""


def box_name(prefix: bytes, key: bytes) -> bytes:
    return prefix + key


def pending_box(user: str) -> bytes:
    return box_name(b"p", decode_address(user))


def launch_box(asset_id: int) -> bytes:
    return box_name(b"l", u64(asset_id))


def index_box(index: int) -> bytes:
    return box_name(b"i", u64(index))


def allocation_box(asset_id: int) -> bytes:
    return box_name(b"a", u64(asset_id))


def box_mbr(name: bytes, value: bytes) -> int:
    return 2_500 + 400 * (len(name) + len(value))


@dataclass
class Protocol:
    dev: Dev
    tm: Tinyman
    pnet: int
    arc54: int
    vestige: int
    source_pool: str
    source_lp: int
    pnet_sk: str
    pnet_holder: str

    @property
    def burn(self) -> str:
        return logic.get_application_address(self.arc54)

    @classmethod
    def deploy(cls, dev: Dev, pool_pnet: int = SOURCE_POOL_PNET, pool_algo: int = SOURCE_POOL_ALGO) -> "Protocol":
        tm = Tinyman.deploy(dev)
        sk, addr = dev.new_account(10_000_000_000_000)
        pnet = dev.create_asset(sk, addr, "PNET", total=10**16, decimals=6)
        # The real ARC-54 program's create route is selected by its first method selector.
        arc54 = dev.deploy_fixture("arc54", sk, addr, app_args=[bytes.fromhex("b8447b36")])
        vestige = dev.deploy_fixture("vestige", sk, addr)
        pool = tm.bootstrap(sk, addr, pnet, ALGO)
        lp = tm.add_initial_liquidity(sk, addr, pnet, ALGO, pool_pnet, pool_algo)
        return cls(dev, tm, pnet, arc54, vestige, pool, lp, sk, addr)

    def fund_user_pnet(self, user: str, user_sk: str, amount: int = 1_000_000) -> None:
        if not self.dev.holds(user, self.pnet):
            self.dev.opt_in(user_sk, user, self.pnet)
        self.dev.transfer(self.pnet_sk, self.pnet_holder, user, self.pnet, amount)


def _load_programs(dev: Dev) -> tuple[bytes, bytes]:
    approval = (ARTIFACTS / "PNETInstantLaunchpad.approval.teal").read_text("utf-8")
    clear = (ARTIFACTS / "PNETInstantLaunchpad.clear.teal").read_text("utf-8")
    return dev.compile(approval), dev.compile(clear)


@dataclass
class Launchpad:
    proto: Protocol
    app_id: int
    admin_sk: str
    admin: str
    cancel_delay: int
    notes: dict[str, Any] = field(default_factory=dict)

    @property
    def dev(self) -> Dev:
        return self.proto.dev

    @property
    def address(self) -> str:
        return logic.get_application_address(self.app_id)

    # -- deployment ---------------------------------------------------------------------------------------------------
    @classmethod
    def deploy(cls, proto: Protocol, cancel_delay: int = 40, platform: tuple[str, str] | None = None) -> "Launchpad":
        """Create + initialize. ``platform`` is the (sk, address) that signs initialize; the contract pins the platform address,
        so on the devnet the patched approval program is recompiled with the test platform wallet substituted."""
        dev = proto.dev
        sk, addr = platform or dev.new_account()
        approval_teal = (ARTIFACTS / "PNETInstantLaunchpad.approval.teal").read_text("utf-8")
        clear_teal = (ARTIFACTS / "PNETInstantLaunchpad.clear.teal").read_text("utf-8")
        approval_teal = patch_platform(approval_teal, addr)
        approval, clear = dev.compile(approval_teal), dev.compile(clear_teal)
        method = Method.from_signature(M_CREATE)
        args = [
            proto.burn, proto.source_pool, proto.pnet, proto.tm.app_id, proto.vestige, proto.arc54, cancel_delay,
        ]
        atc = AtomicTransactionComposer()
        # create(...) has no app id yet: build the create txn by hand with ABI-encoded args and explicit reference arrays.
        accounts = [proto.burn, proto.source_pool]
        app_args = [
            method.get_selector(), decode_address(proto.burn), decode_address(proto.source_pool), u64(proto.pnet), u64(proto.tm.app_id), u64(proto.vestige),
            u64(proto.arc54), u64(cancel_delay),
        ]
        create = tx.ApplicationCreateTxn(
            addr, dev.params(), tx.OnComplete.NoOpOC, approval, clear,
            tx.StateSchema(num_uints=9, num_byte_slices=2), tx.StateSchema(0, 0),
            app_args=app_args, accounts=accounts,
            foreign_apps=[proto.tm.app_id, proto.vestige, proto.arc54], foreign_assets=[proto.pnet],
            extra_pages=2,
        )
        del atc, args
        app_id = int(dev.send([create], [sk])["application-index"])
        lp = cls(proto, app_id, sk, addr, cancel_delay)
        lp.initialize()
        return lp

    def initialize(self) -> None:
        dev = self.dev
        pay = tx.PaymentTxn(self.admin, dev.params(), self.address, C["INITIALIZE_FUNDING"])
        call = tx.ApplicationNoOpTxn(
            self.admin, dev.params(2 * MIN_FEE), self.app_id, app_args=[Method.from_signature(M_INITIALIZE).get_selector()],
            foreign_assets=[self.proto.pnet],
        )
        dev.send([pay, call], [self.admin_sk, self.admin_sk])

    # -- helpers ------------------------------------------------------------------------------------------------------
    def free_balance(self) -> int:
        info = self.dev.algod.account_info(self.address)
        return int(info["amount"]) - int(info["min-balance"])

    def global_state(self) -> dict[str, int | bytes]:
        return self.dev.app_global(self.app_id)

    def total_records(self) -> int:
        return int(self.global_state().get("total", 0))

    def _composer_call(
        self, atc: AtomicTransactionComposer, signature: str, user: str, user_sk: str, args: list[Any], fee: int,
        boxes: list[bytes], accounts: list[str] | None = None, apps: list[int] | None = None,
        assets: list[int] | None = None, box_refs: list[tuple[int, bytes]] | None = None,
    ) -> None:
        sp = self.dev.params(fee)
        refs = [(0, b) for b in boxes] + (box_refs or [])
        atc.add_method_call(
            self.app_id, Method.from_signature(signature), user, sp, AccountTransactionSigner(user_sk),
            method_args=args, boxes=refs, accounts=accounts or [], foreign_apps=apps or [], foreign_assets=assets or [],
        )

    def _run(self, atc: AtomicTransactionComposer) -> Any:
        try:
            result = atc.execute(self.dev.algod, 4)
        except Exception as err:  # noqa: BLE001 - surface algod's refusal text
            raise TxFailed(_reason(str(err))) from err
        return result

    # -- the two launch approvals ---------------------------------------------------------------------------------------
    def start_group(
        self, user: str, user_sk: str, name: str, unit: str, total_raw: int, url: str = "",
        quote_round: int | None = None, minimum_pnet: int = 0, fee: int = 5 * MIN_FEE, funding: int | None = None,
        budget_calls: int = 0,
    ) -> AtomicTransactionComposer:
        dev = self.dev
        atc = AtomicTransactionComposer()
        pay = tx.PaymentTxn(user, dev.params(), self.address, C["LAUNCH_START_FUNDING"] if funding is None else funding)
        quote_round = dev.round() if quote_round is None else quote_round
        self._composer_call(
            atc, M_START, user, user_sk,
            [TransactionWithSigner(pay, AccountTransactionSigner(user_sk)), name, unit, total_raw, url, quote_round, minimum_pnet],
            fee, [pending_box(user)], accounts=[self.proto.source_pool], apps=[self.proto.tm.app_id],
            assets=[self.proto.pnet, ALGO],
        )
        return atc

    def start(self, user: str, user_sk: str, name: str = "Canary", unit: str = "CNRY", total_raw: int = 1_000_000 * 10**6, **kw: Any) -> int:
        result = self._run(self.start_group(user, user_sk, name, unit, total_raw, **kw))
        return int(result.abi_results[0].return_value)

    def finish_group(
        self, user: str, user_sk: str, asset_id: int, with_bootstrap: bool = True, grant_vestige: int = 1,
        fee: int = 14 * MIN_FEE, funding: int | None = None, budget_calls: int = 1, pool_override: str | None = None,
    ) -> AtomicTransactionComposer:
        dev = self.dev
        proto = self.proto
        atc = AtomicTransactionComposer()
        user_signer = AccountTransactionSigner(user_sk)
        pool = proto.tm.pool_address(asset_id, proto.pnet)
        if with_bootstrap:
            txns, lsig = proto.tm.bootstrap_txns(user, asset_id, proto.pnet)
            atc.add_transaction(TransactionWithSigner(txns[0], user_signer))
            atc.add_transaction(TransactionWithSigner(txns[1], LogicSigTransactionSigner(lsig)))
        # One app call may carry at most 8 references; the group shares them. The budget call carries the accounts, apps and
        # assets plus the Vestige box (8 references), so the finish call keeps its four own boxes.
        pool_lp = proto.tm.pool_state(asset_id, proto.pnet).get("pool_token_asset_id")
        known_lp = [int(pool_lp)] if (pool_lp and not with_bootstrap) else []
        for i in range(max(budget_calls, 1)):
            carried = (
                dict(accounts=[pool_override or pool], apps=[proto.tm.app_id, proto.arc54, proto.vestige],
                     assets=[asset_id, proto.pnet, *known_lp], box_refs=[(proto.vestige, b"m" + u64(asset_id))]) if i == 0 else {}
            )
            self._composer_call(atc, M_BUDGET, user, user_sk, [], MIN_FEE, [], **carried)
        burn_holds_lp = False  # decided by the caller through `funding`; default assumes ARC-54 still needs the LP holding
        expected = C["LP_HOLDING_MBR"] + C["ARC54_LP_HOLDING_MBR"] + (C["VESTIGE_FUNDING"] if grant_vestige else 0)
        del burn_holds_lp
        pay = tx.PaymentTxn(user, dev.params(), self.address, expected if funding is None else funding)
        total = self.total_records()
        self._composer_call(
            atc, M_FINISH, user, user_sk,
            [TransactionWithSigner(pay, user_signer), asset_id, pool_override or pool, grant_vestige],
            fee,
            [pending_box(user), launch_box(asset_id), index_box(total), allocation_box(asset_id)],
        )
        return atc

    def finish(self, user: str, user_sk: str, asset_id: int, **kw: Any) -> None:
        self._run(self.finish_group(user, user_sk, asset_id, **kw))

    def claim_group(self, user: str, user_sk: str, asset_id: int, lp_id: int, fee: int = 2 * MIN_FEE) -> AtomicTransactionComposer:
        atc = AtomicTransactionComposer()
        opt = tx.AssetTransferTxn(user, self.dev.params(), user, 0, lp_id)
        self._composer_call(
            atc, M_CLAIM, user, user_sk, [TransactionWithSigner(opt, AccountTransactionSigner(user_sk)), asset_id], fee,
            [launch_box(asset_id)], assets=[lp_id],
        )
        return atc

    def cancel_group(self, user: str, user_sk: str, asset_id: int, fee: int = 8 * MIN_FEE,
                     with_opt_ins: bool = False) -> AtomicTransactionComposer:
        atc = AtomicTransactionComposer()
        if with_opt_ins:
            signer = AccountTransactionSigner(user_sk)
            for asset in (asset_id, self.proto.pnet):
                if not self.dev.holds(user, asset):
                    atc.add_transaction(TransactionWithSigner(tx.AssetTransferTxn(user, self.dev.params(), user, 0, asset), signer))
        self._composer_call(
            atc, M_CANCEL, user, user_sk, [asset_id], fee,
            [pending_box(user), launch_box(asset_id), index_box(self.total_records()), allocation_box(asset_id)],
            accounts=[self.admin], assets=[asset_id, self.proto.pnet],
        )
        return atc

    # -- later steps ------------------------------------------------------------------------------------------------------
    def vestige_group(self, user: str, user_sk: str, asset_id: int, fee: int = 4 * MIN_FEE) -> AtomicTransactionComposer:
        atc = AtomicTransactionComposer()
        vestige_addr = logic.get_application_address(self.proto.vestige)
        pay = tx.PaymentTxn(user, self.dev.params(), vestige_addr, C["VESTIGE_FUNDING"])
        self._composer_call(
            atc, M_VESTIGE, user, user_sk, [TransactionWithSigner(pay, AccountTransactionSigner(user_sk)), asset_id], fee,
            [launch_box(asset_id)], apps=[self.proto.vestige], assets=[asset_id],
            box_refs=[(self.proto.vestige, b"m" + u64(asset_id))],
        )
        return atc

    def release_platform_group(self, launch_asset_id: int, holding_asset: int, receiver: str, amount: int,
                               sender: tuple[str, str] | None = None, fee: int = 3 * MIN_FEE) -> AtomicTransactionComposer:
        sk, addr = sender or (self.admin_sk, self.admin)
        atc = AtomicTransactionComposer()
        self._composer_call(
            atc, M_RELEASE_PLATFORM, addr, sk, [launch_asset_id, receiver, amount], fee,
            [allocation_box(launch_asset_id), launch_box(launch_asset_id)], accounts=[receiver], assets=[holding_asset],
        )
        return atc

    def release_pnet_group(self, launch_asset_id: int, fee: int = 3 * MIN_FEE) -> AtomicTransactionComposer:
        atc = AtomicTransactionComposer()
        self._composer_call(
            atc, M_RELEASE_PNET, self.admin, self.admin_sk, [launch_asset_id], fee, [launch_box(launch_asset_id)],
            assets=[self.proto.pnet],
        )
        return atc

def patch_platform(approval_teal: str, address: str) -> str:
    """The contract hardcodes the MainNet platform wallet as a ``base32(...)`` key constant. The devnet suite swaps in its own
    platform account by replacing that constant in the compiled TEAL (and the readable address comments)."""
    def b32(addr: str) -> str:
        return base64.b32encode(decode_address(addr)).decode().rstrip("=")

    platform = C["PLATFORM_WALLET_ADDRESS"]
    old = f"base32({b32(platform)})"
    assert old in approval_teal, "platform wallet constant not found in TEAL"
    return approval_teal.replace(old, f"base32({b32(address)})").replace(platform, address)