"""PNET Instant Launchpad v2.

The application is the immutable creator and custody account for every launch.
It buys PNET with exactly one ALGO through a pinned Tinyman v2 pool, supplies
the entire newly-created ASA and the measured PNET output as initial Tinyman
liquidity, burns 80% of the received LP through ARC-54, gives 10% to the
launcher, and retains the rounding remainder as the platform allocation.

The application cannot be updated or deleted. A timed cancellation is only
available after PNET has been escrowed and returns half of both escrowed assets
to the launcher. Vestige delegation is post-launch and retryable.
"""

import algopy
from algopy import ARC4Contract, BoxMap, Global, GlobalState, Txn, UInt64, arc4, gtxn, itxn, op


DECIMALS = 6
ALGO_SWAP_INPUT = 1_000_000
QUOTE_MAX_AGE_ROUNDS = 10
CANCEL_DELAY_ROUNDS = 20_000
SLIPPAGE_BPS = 100
MAX_PRICE_IMPACT_BPS = 500
BURN_BPS = 8_000
BPS_DENOMINATOR = 10_000
LOCKED_TINYMAN_POOL_TOKENS = 1_000

APP_BASE_MBR = 100_000
ASSET_HOLDING_MBR = 100_000
APP_SAFETY_CUSHION = 1_000_000
INITIALIZE_FUNDING = APP_BASE_MBR + ASSET_HOLDING_MBR + APP_SAFETY_CUSHION
LP_HOLDING_MBR = 100_000
ARC54_LP_HOLDING_MBR = 100_000
VESTIGE_FUNDING = 100_000
FINALIZE_APP_FEE_ARC54_NEEDED = 11_000
FINALIZE_APP_FEE_ARC54_READY = 8_000

# Every transaction-id field always contains 32 bytes, including the zero
# sentinel. This keeps serialized box sizes and therefore MBR deterministic.
ZERO_TX_ID = b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
PENDING_BOX_MBR = 66_900
LAUNCH_RECORD_MBR = 161_300
LAUNCH_INDEX_MBR = 9_300
PLATFORM_ALLOCATION_MBR = 18_900
CREATE_FUNDING = ASSET_HOLDING_MBR + LAUNCH_RECORD_MBR + LAUNCH_INDEX_MBR + PLATFORM_ALLOCATION_MBR

STATUS_CREATED = 0
STATUS_PNET_ESCROWED = 1
STATUS_COMPLETE = 2
STATUS_CANCELLED = 3

ALLOCATION_CANCELLED_ASA = 1
ALLOCATION_PLATFORM_LP = 2

PLATFORM_WALLET_ADDRESS = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E"

# These values are enforced by bytecode whenever the app runs on MainNet.
# Non-MainNet deployments remain configurable so LocalNet protocol mocks and
# the required TestNet lifecycle can exercise the exact same program.
MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8="
MAINNET_PNET_ASSET_ID = 3_169_177_585
MAINNET_TINYMAN_APP_ID = 1_002_541_853
MAINNET_VESTIGE_APP_ID = 3_129_810_607
MAINNET_ARC54_APP_ID = 1_257_620_981
MAINNET_SOURCE_POOL = "ANESQRCMZ5KWZFKDGESLJEWQLRCVUZU725FJL7NO3BMKJEYMAB3TR56R3E"


class PendingLaunch(arc4.Struct):
    asset_id: arc4.UInt64
    total_raw: arc4.UInt64
    status: arc4.UInt64
    created_round: arc4.UInt64
    swap_round: arc4.UInt64
    pnet_output: arc4.UInt64
    quote_minimum: arc4.UInt64
    create_tx_id: arc4.DynamicBytes
    swap_tx_id: arc4.DynamicBytes


class LaunchRecord(arc4.Struct):
    launcher: arc4.Address
    asset_id: arc4.UInt64
    total_raw: arc4.UInt64
    status: arc4.UInt64
    created_round: arc4.UInt64
    swap_round: arc4.UInt64
    terminal_round: arc4.UInt64
    pool_address: arc4.Address
    pool_token_id: arc4.UInt64
    pnet_seed: arc4.UInt64
    burned_lp: arc4.UInt64
    creator_lp: arc4.UInt64
    platform_lp: arc4.UInt64
    cancel_creator_token: arc4.UInt64
    cancel_platform_token: arc4.UInt64
    cancel_creator_pnet: arc4.UInt64
    cancel_platform_pnet: arc4.UInt64
    cancel_platform_pnet_remaining: arc4.UInt64
    vestige_granted: arc4.UInt64
    vestige_funding: arc4.UInt64
    create_tx_id: arc4.DynamicBytes
    swap_tx_id: arc4.DynamicBytes
    terminal_tx_id: arc4.DynamicBytes
    vestige_tx_id: arc4.DynamicBytes
    release_tx_id: arc4.DynamicBytes


class PlatformAllocation(arc4.Struct):
    launch_asset_id: arc4.UInt64
    holding_asset_id: arc4.UInt64
    remaining: arc4.UInt64
    kind: arc4.UInt64


class AssetCreated(arc4.Struct):
    launcher: arc4.Address
    asset_id: arc4.UInt64
    total_raw: arc4.UInt64


class PnetEscrowed(arc4.Struct):
    launcher: arc4.Address
    asset_id: arc4.UInt64
    pnet_output: arc4.UInt64


class LaunchFinalized(arc4.Struct):
    launcher: arc4.Address
    asset_id: arc4.UInt64
    pool_token_id: arc4.UInt64
    burned_lp: arc4.UInt64
    creator_lp: arc4.UInt64
    platform_lp: arc4.UInt64


class LaunchCancelled(arc4.Struct):
    launcher: arc4.Address
    asset_id: arc4.UInt64
    creator_token: arc4.UInt64
    creator_pnet: arc4.UInt64


class VestigeAccessGranted(arc4.Struct):
    launcher: arc4.Address
    asset_id: arc4.UInt64


class PlatformAllocationReleased(arc4.Struct):
    holding_asset_id: arc4.UInt64
    receiver: arc4.Address
    amount: arc4.UInt64
    remaining: arc4.UInt64


class PNETInstantLaunchpad(ARC4Contract):
    """Immutable Tinyman-backed PNET launch escrow and public directory."""

    def __init__(self) -> None:
        self.burn_account = GlobalState(algopy.Account, key=b"burn")
        self.source_pool = GlobalState(algopy.Account, key=b"source")
        self.pnet_asset_id = GlobalState(UInt64, key=b"pnet")
        self.tinyman_app_id = GlobalState(UInt64, key=b"tinyman")
        self.vestige_app_id = GlobalState(UInt64, key=b"vestige")
        self.arc54_app_id = GlobalState(UInt64, key=b"arc54")
        self.total_records = GlobalState(UInt64, key=b"total")
        self.initialized = GlobalState(UInt64, key=b"init")
        self.reserved_pnet = GlobalState(UInt64, key=b"reserved")
        self.platform_pnet = GlobalState(UInt64, key=b"platpnet")

        self.pending = BoxMap(algopy.Account, PendingLaunch, key_prefix=b"p")
        self.launches = BoxMap(UInt64, LaunchRecord, key_prefix=b"l")
        self.launch_index = BoxMap(UInt64, UInt64, key_prefix=b"i")
        self.platform_allocations = BoxMap(UInt64, PlatformAllocation, key_prefix=b"a")

    @arc4.abimethod(allow_actions=["NoOp"], create="require")
    def create(
        self,
        burn_account: algopy.Account,
        source_pool: algopy.Account,
        pnet_asset_id: UInt64,
        tinyman_app_id: UInt64,
        vestige_app_id: UInt64,
        arc54_app_id: UInt64,
    ) -> None:
        assert Global.group_size == UInt64(1), "Create must be standalone"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert Txn.fee == Global.min_txn_fee, "Wrong create fee"
        assert source_pool != algopy.Account(), "Tinyman source pool required"
        assert burn_account != algopy.Account(), "ARC-54 account required"
        assert algopy.Account(PLATFORM_WALLET_ADDRESS) != burn_account, "Platform and burn must differ"

        if Global.genesis_hash == algopy.Bytes.from_base64(MAINNET_GENESIS_HASH):
            assert pnet_asset_id == UInt64(MAINNET_PNET_ASSET_ID), "Wrong MainNet PNET"
            assert tinyman_app_id == UInt64(MAINNET_TINYMAN_APP_ID), "Wrong MainNet Tinyman"
            assert vestige_app_id == UInt64(MAINNET_VESTIGE_APP_ID), "Wrong MainNet Vestige"
            assert arc54_app_id == UInt64(MAINNET_ARC54_APP_ID), "Wrong MainNet ARC-54"
            assert source_pool == algopy.Account(MAINNET_SOURCE_POOL), "Wrong MainNet source pool"

        pnet_decimals, pnet_exists = op.AssetParamsGet.asset_decimals(pnet_asset_id)
        tinyman_address, tinyman_exists = op.AppParamsGet.app_address(tinyman_app_id)
        vestige_address, vestige_exists = op.AppParamsGet.app_address(vestige_app_id)
        official_burn, arc54_exists = op.AppParamsGet.app_address(arc54_app_id)
        assert pnet_exists and pnet_decimals == UInt64(DECIMALS), "PNET must be six decimals"
        assert tinyman_exists and tinyman_address != algopy.Account(), "Invalid Tinyman app"
        assert vestige_exists and vestige_address != algopy.Account(), "Invalid Vestige app"
        assert arc54_exists and official_burn == burn_account, "ARC-54 app/address mismatch"

        tinyman = algopy.Application(tinyman_app_id)
        asset_1, has_a1 = op.AppLocal.get_ex_uint64(source_pool, tinyman, b"asset_1_id")
        asset_2, has_a2 = op.AppLocal.get_ex_uint64(source_pool, tinyman, b"asset_2_id")
        pool_token, has_lp = op.AppLocal.get_ex_uint64(source_pool, tinyman, b"pool_token_asset_id")
        assert has_a1 and has_a2 and has_lp and pool_token > UInt64(0), "Invalid source pool state"
        assert asset_1 == pnet_asset_id and asset_2 == UInt64(0), "Source pool must be PNET/ALGO"

        self.burn_account.value = burn_account
        self.source_pool.value = source_pool
        self.pnet_asset_id.value = pnet_asset_id
        self.tinyman_app_id.value = tinyman_app_id
        self.vestige_app_id.value = vestige_app_id
        self.arc54_app_id.value = arc54_app_id
        self.total_records.value = UInt64(0)
        self.initialized.value = UInt64(0)
        self.reserved_pnet.value = UInt64(0)
        self.platform_pnet.value = UInt64(0)

    @arc4.abimethod
    def initialize(self, reserve_payment: gtxn.PaymentTransaction) -> None:
        """Fund base/PNET MBR and a one-ALGO safety reserve once."""
        assert self.initialized.value == UInt64(0), "Already initialized"
        assert Global.group_size == UInt64(2), "Initialize requires payment and app call"
        assert reserve_payment.group_index + UInt64(1) == Txn.group_index, "Payment must precede call"
        assert reserve_payment.sender == Txn.sender, "Funding sender mismatch"
        assert reserve_payment.receiver == Global.current_application_address, "Wrong funding receiver"
        assert reserve_payment.amount == UInt64(INITIALIZE_FUNDING), "Wrong initialization funding"
        assert reserve_payment.fee == Global.min_txn_fee, "Wrong payment fee"
        assert reserve_payment.close_remainder_to == algopy.Account(), "No close remainder"
        assert reserve_payment.rekey_to == algopy.Account(), "No payment rekey"
        assert Txn.fee == Global.min_txn_fee * UInt64(2), "Wrong initialize app fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"

        app_pnet_balance, app_opted = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, self.pnet_asset_id.value
        )
        assert not app_opted, "App already opted into PNET"
        itxn.AssetTransfer(
            xfer_asset=self.pnet_asset_id.value,
            asset_receiver=Global.current_application_address,
            asset_amount=UInt64(0),
            fee=UInt64(0),
        ).submit()
        self.initialized.value = UInt64(1)

    @arc4.abimethod
    def create_asset(
        self,
        funding: gtxn.PaymentTransaction,
        name: arc4.String,
        unit_name: arc4.String,
        total_raw: UInt64,
        url: arc4.String,
    ) -> UInt64:
        """Create an immutable six-decimal ASA and retain its entire supply."""
        assert self.initialized.value == UInt64(1), "Initialize launchpad first"
        assert Global.group_size == UInt64(2), "Create requires funding and app call"
        assert funding.group_index + UInt64(1) == Txn.group_index, "Funding must precede call"
        assert funding.sender == Txn.sender, "Funding sender mismatch"
        assert funding.receiver == Global.current_application_address, "Wrong funding receiver"
        assert funding.amount == UInt64(CREATE_FUNDING), "Wrong launch storage funding"
        assert funding.fee == Global.min_txn_fee, "Wrong funding fee"
        assert funding.close_remainder_to == algopy.Account(), "No close remainder"
        assert funding.rekey_to == algopy.Account(), "No funding rekey"
        assert Txn.fee == Global.min_txn_fee * UInt64(2), "Wrong create app fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert total_raw >= UInt64(2_000), "Supply too small for Tinyman"
        assert Txn.sender not in self.pending, "Finish current launch first"

        raw_name = name.bytes
        raw_unit = unit_name.bytes
        raw_url = url.bytes
        assert raw_name.length > UInt64(0) and raw_name.length <= UInt64(32), "Invalid name length"
        assert raw_unit.length > UInt64(0) and raw_unit.length <= UInt64(8), "Invalid unit length"
        assert raw_url.length <= UInt64(96), "URL exceeds 96 bytes"

        asset_txn = itxn.AssetConfig(
            total=total_raw,
            decimals=UInt64(DECIMALS),
            asset_name=raw_name,
            unit_name=raw_unit,
            url=raw_url,
            default_frozen=False,
            manager=algopy.Account(),
            reserve=algopy.Account(),
            freeze=algopy.Account(),
            clawback=algopy.Account(),
            fee=UInt64(0),
            note=b"PNET Instant Launchpad v2",
        ).submit()
        asset_id = asset_txn.created_asset.id

        self.pending[Txn.sender] = PendingLaunch(
            asset_id=arc4.UInt64(asset_id), total_raw=arc4.UInt64(total_raw),
            status=arc4.UInt64(UInt64(STATUS_CREATED)), created_round=arc4.UInt64(Global.round),
            swap_round=arc4.UInt64(UInt64(0)), pnet_output=arc4.UInt64(UInt64(0)),
            quote_minimum=arc4.UInt64(UInt64(0)), create_tx_id=arc4.DynamicBytes(Txn.tx_id),
            swap_tx_id=arc4.DynamicBytes(ZERO_TX_ID),
        ).copy()
        arc4.emit(AssetCreated(arc4.Address(Txn.sender), arc4.UInt64(asset_id), arc4.UInt64(total_raw)))
        return asset_id

    @arc4.abimethod
    def swap_pnet(
        self,
        payment: gtxn.PaymentTransaction,
        asset_id: UInt64,
        quote_round: UInt64,
        minimum_pnet: UInt64,
    ) -> UInt64:
        """Atomically swap exactly one ALGO and escrow measured PNET output."""
        assert Global.group_size == UInt64(2), "Swap requires payment and app call"
        assert payment.group_index + UInt64(1) == Txn.group_index, "Payment must precede call"
        assert payment.sender == Txn.sender, "Swap payer mismatch"
        assert payment.receiver == Global.current_application_address, "Wrong swap receiver"
        assert payment.amount == UInt64(ALGO_SWAP_INPUT), "Swap input must equal one ALGO"
        assert payment.fee == Global.min_txn_fee, "Wrong swap payment fee"
        assert payment.close_remainder_to == algopy.Account(), "No close remainder"
        assert payment.rekey_to == algopy.Account(), "No payment rekey"
        assert Txn.fee == Global.min_txn_fee * UInt64(4), "Wrong swap app fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert Txn.sender in self.pending, "Unknown launch"
        pending = self.pending[Txn.sender].copy()
        assert pending.asset_id.as_uint64() == asset_id, "Asset mismatch"
        assert pending.status.as_uint64() == UInt64(STATUS_CREATED), "PNET already escrowed"
        assert quote_round <= Global.round, "Quote round is in the future"
        assert Global.round - quote_round <= UInt64(QUOTE_MAX_AGE_ROUNDS), "Quote expired"

        tinyman = algopy.Application(self.tinyman_app_id.value)
        asset_1, has_a1 = op.AppLocal.get_ex_uint64(self.source_pool.value, tinyman, b"asset_1_id")
        asset_2, has_a2 = op.AppLocal.get_ex_uint64(self.source_pool.value, tinyman, b"asset_2_id")
        reserve_1, has_r1 = op.AppLocal.get_ex_uint64(self.source_pool.value, tinyman, b"asset_1_reserves")
        reserve_2, has_r2 = op.AppLocal.get_ex_uint64(self.source_pool.value, tinyman, b"asset_2_reserves")
        fee_share, has_fee = op.AppLocal.get_ex_uint64(self.source_pool.value, tinyman, b"total_fee_share")
        assert has_a1 and has_a2 and has_r1 and has_r2 and has_fee, "Invalid source pool"

        algo_reserve = UInt64(0)
        pnet_reserve = UInt64(0)
        assert asset_1 == self.pnet_asset_id.value and asset_2 == UInt64(0), "Wrong source pair"
        pnet_reserve = reserve_1
        algo_reserve = reserve_2
        assert algo_reserve > UInt64(0) and pnet_reserve > UInt64(0), "Empty source pool"
        assert fee_share < UInt64(BPS_DENOMINATOR), "Invalid Tinyman fee"

        fee_amount = (UInt64(ALGO_SWAP_INPUT) * fee_share) // UInt64(BPS_DENOMINATOR)
        swap_amount = UInt64(ALGO_SWAP_INPUT) - fee_amount
        k_high, k_low = op.mulw(algo_reserve, pnet_reserve)
        remaining_pnet = op.divw(k_high, k_low, algo_reserve + swap_amount)
        assert pnet_reserve > remaining_pnet + UInt64(1), "No executable output"
        expected_pnet = pnet_reserve - remaining_pnet - UInt64(1)

        rate_high, rate_low = op.mulw(expected_pnet, algo_reserve)
        effective_pool_units = op.divw(rate_high, rate_low, UInt64(ALGO_SWAP_INPUT))
        min_effective_units = (
            (pnet_reserve // UInt64(BPS_DENOMINATOR)) * UInt64(BPS_DENOMINATOR - MAX_PRICE_IMPACT_BPS)
            + ((pnet_reserve % UInt64(BPS_DENOMINATOR)) * UInt64(BPS_DENOMINATOR - MAX_PRICE_IMPACT_BPS)
               + UInt64(BPS_DENOMINATOR - 1)) // UInt64(BPS_DENOMINATOR)
        )
        assert effective_pool_units >= min_effective_units, "Price impact exceeds five percent"
        required_minimum = (
            (expected_pnet // UInt64(BPS_DENOMINATOR)) * UInt64(BPS_DENOMINATOR - SLIPPAGE_BPS)
            + ((expected_pnet % UInt64(BPS_DENOMINATOR)) * UInt64(BPS_DENOMINATOR - SLIPPAGE_BPS))
            // UInt64(BPS_DENOMINATOR)
        )
        assert minimum_pnet <= expected_pnet, "Quoted output is no longer available"
        # Preserve the user's originally quoted floor while also enforcing a
        # fresh one-percent floor from current reserves. A favorable price move
        # therefore cannot invalidate an otherwise live quote.
        swap_minimum = required_minimum
        if minimum_pnet > swap_minimum:
            swap_minimum = minimum_pnet

        before_pnet, app_opted = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, self.pnet_asset_id.value
        )
        assert app_opted, "Launchpad is not opted into PNET"
        itxn.submit_txns(
            itxn.Payment(receiver=self.source_pool.value, amount=UInt64(ALGO_SWAP_INPUT), fee=UInt64(0)),
            itxn.ApplicationCall(
                app_id=tinyman,
                app_args=(b"swap", b"fixed-input", op.itob(swap_minimum)),
                accounts=(self.source_pool.value,),
                assets=(algopy.Asset(self.pnet_asset_id.value), algopy.Asset(UInt64(0))),
                fee=UInt64(0), note=b"PNET Launchpad v2 one-ALGO acquisition",
            ),
        )
        after_pnet, still_opted = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, self.pnet_asset_id.value
        )
        assert still_opted and after_pnet > before_pnet, "Tinyman returned no PNET"
        confirmed_output = after_pnet - before_pnet
        assert confirmed_output >= swap_minimum, "Tinyman output below minimum"

        pending.status = arc4.UInt64(UInt64(STATUS_PNET_ESCROWED))
        pending.swap_round = arc4.UInt64(Global.round)
        pending.pnet_output = arc4.UInt64(confirmed_output)
        pending.quote_minimum = arc4.UInt64(swap_minimum)
        pending.swap_tx_id = arc4.DynamicBytes(Txn.tx_id)
        self.pending[Txn.sender] = pending.copy()
        self.reserved_pnet.value = self.reserved_pnet.value + confirmed_output
        arc4.emit(PnetEscrowed(arc4.Address(Txn.sender), arc4.UInt64(asset_id), arc4.UInt64(confirmed_output)))
        return confirmed_output

    @arc4.abimethod
    def provide_finalize_resources(self, asset_id: UInt64, pool_token_id: UInt64) -> None:
        """Carry shared AVM resources for the following finalization call.

        AVM v11 limits the traditional account/application/asset/box arrays to
        eight entries per application call.  A separate, side-effect-free call
        in the same atomic group carries ARC-54, the LP asset, and two record
        boxes so the final call remains within that limit.
        """
        assert Global.group_size == UInt64(4), "Finalize group must contain four transactions"
        assert Txn.group_index == UInt64(2), "Resource carrier must be third"
        assert Txn.fee == Global.min_txn_fee, "Wrong resource carrier fee"
        assert Txn.rekey_to == algopy.Account(), "No resource carrier rekey"
        assert Txn.sender in self.pending, "Unknown launch"
        pending = self.pending[Txn.sender].copy()
        assert pending.asset_id.as_uint64() == asset_id, "Asset mismatch"
        assert pending.status.as_uint64() == UInt64(STATUS_PNET_ESCROWED), "PNET escrow required"
        assert pool_token_id > UInt64(0), "Pool token required"

    @arc4.abimethod
    def finalize_launch(
        self,
        creator_lp_opt_in: gtxn.AssetTransferTransaction,
        launch_funding: gtxn.PaymentTransaction,
        asset_id: UInt64,
        pool_address: algopy.Account,
        pool_token_id: UInt64,
    ) -> None:
        """Atomically seed Tinyman, burn 80%, and split remaining LP 50/50.

        ARC-54 may already be opted into the LP ASA because its public method
        accepts donated MBR.  The launch therefore never depends on a duplicate
        outer opt-in call: the creator funds the app with 100k for its own LP
        holding plus 100k only when ARC-54 still needs an LP holding, and this
        method performs the ARC-54 funding/call as a nested atomic group.
        """
        assert Global.group_size == UInt64(4), "Finalize group must contain four transactions"
        assert creator_lp_opt_in.group_index == UInt64(0), "Creator LP opt-in must be first"
        assert launch_funding.group_index == UInt64(1), "Launch funding must be second"
        assert Txn.group_index == UInt64(3), "Finalize call must be last"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert Txn.sender in self.pending, "Unknown launch"
        pending = self.pending[Txn.sender].copy()
        assert pending.asset_id.as_uint64() == asset_id, "Asset mismatch"
        assert pending.status.as_uint64() == UInt64(STATUS_PNET_ESCROWED), "PNET escrow required"
        assert pool_token_id > UInt64(0), "Pool token required"

        assert creator_lp_opt_in.sender == Txn.sender, "Creator opt-in sender mismatch"
        assert creator_lp_opt_in.asset_receiver == Txn.sender, "Creator must opt into LP"
        assert creator_lp_opt_in.xfer_asset.id == pool_token_id, "Wrong creator LP asset"
        assert creator_lp_opt_in.asset_amount == UInt64(0), "LP opt-in amount must be zero"
        assert creator_lp_opt_in.asset_close_to == algopy.Account(), "No LP close"
        assert creator_lp_opt_in.asset_sender == algopy.Account(), "No clawback sender"
        assert creator_lp_opt_in.rekey_to == algopy.Account(), "No LP opt-in rekey"
        assert creator_lp_opt_in.fee == Global.min_txn_fee, "Wrong creator opt-in fee"

        assert launch_funding.sender == Txn.sender, "Launch funding sender mismatch"
        assert launch_funding.receiver == Global.current_application_address, "Wrong launch funding receiver"
        assert launch_funding.fee == Global.min_txn_fee, "Wrong launch funding fee"
        assert launch_funding.close_remainder_to == algopy.Account(), "No launch funding close"
        assert launch_funding.rekey_to == algopy.Account(), "No launch funding rekey"

        tinyman = algopy.Application(self.tinyman_app_id.value)
        asset_1, has_a1 = op.AppLocal.get_ex_uint64(pool_address, tinyman, b"asset_1_id")
        asset_2, has_a2 = op.AppLocal.get_ex_uint64(pool_address, tinyman, b"asset_2_id")
        lp_id, has_lp = op.AppLocal.get_ex_uint64(pool_address, tinyman, b"pool_token_asset_id")
        issued_before, has_issued = op.AppLocal.get_ex_uint64(pool_address, tinyman, b"issued_pool_tokens")
        assert has_a1 and has_a2 and has_lp and has_issued, "Invalid Tinyman pool"
        # Tinyman orders pool assets descending by asset id. MainNet launch
        # assets are necessarily newer than PNET, and the inner deposit group
        # below follows asset-1 then asset-2 order.
        assert asset_id > self.pnet_asset_id.value, "Launch ASA must be newer than PNET"
        assert asset_1 == asset_id and asset_2 == self.pnet_asset_id.value, "Wrong Tinyman pair/order"
        assert lp_id == pool_token_id, "Pool token mismatch"
        assert issued_before == UInt64(0), "Pool already has liquidity"

        app_token_balance, app_holds_token = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, asset_id
        )
        app_pnet_balance, app_holds_pnet = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, self.pnet_asset_id.value
        )
        app_lp_balance_before, app_holds_lp = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, pool_token_id
        )
        creator_lp_balance, creator_holds_lp = op.AssetHoldingGet.asset_balance(Txn.sender, pool_token_id)
        burn_lp_balance, burn_holds_lp = op.AssetHoldingGet.asset_balance(
            self.burn_account.value, pool_token_id
        )
        assert app_holds_token and app_token_balance == pending.total_raw.as_uint64(), "App must hold full supply"
        assert app_holds_pnet and app_pnet_balance >= self.reserved_pnet.value, "Escrowed PNET invariant failed"
        assert not app_holds_lp, "App already opted into LP"
        assert creator_holds_lp and creator_lp_balance == UInt64(0), "Creator LP state invalid"

        if burn_holds_lp:
            assert launch_funding.amount == UInt64(LP_HOLDING_MBR), "Wrong pre-opted launch funding"
            assert Txn.fee == UInt64(FINALIZE_APP_FEE_ARC54_READY), "Wrong pre-opted finalize fee"
        else:
            assert launch_funding.amount == UInt64(
                LP_HOLDING_MBR + ARC54_LP_HOLDING_MBR
            ), "Wrong launch and ARC-54 funding"
            assert Txn.fee == UInt64(FINALIZE_APP_FEE_ARC54_NEEDED), "Wrong finalize fee"
            itxn.submit_txns(
                itxn.Payment(
                    receiver=self.burn_account.value,
                    amount=UInt64(ARC54_LP_HOLDING_MBR),
                    fee=UInt64(0),
                    note=b"PNET Launchpad v2 ARC-54 LP MBR",
                ),
                itxn.ApplicationCall(
                    app_id=algopy.Application(self.arc54_app_id.value),
                    app_args=(arc4.arc4_signature("arc54_optIntoASA(asset)void"), b"\x00"),
                    assets=(algopy.Asset(pool_token_id),),
                    fee=UInt64(0),
                    note=b"PNET Launchpad v2 ARC-54 LP opt-in",
                ),
            )
            _burn_balance, burn_holds_lp = op.AssetHoldingGet.asset_balance(
                self.burn_account.value, pool_token_id
            )
            assert burn_holds_lp, "ARC-54 LP opt-in failed"

        itxn.AssetTransfer(
            xfer_asset=pool_token_id, asset_receiver=Global.current_application_address,
            asset_amount=UInt64(0), fee=UInt64(0),
        ).submit()
        itxn.submit_txns(
            itxn.AssetTransfer(
                xfer_asset=asset_id, asset_receiver=pool_address,
                asset_amount=pending.total_raw.as_uint64(), fee=UInt64(0),
            ),
            itxn.AssetTransfer(
                xfer_asset=self.pnet_asset_id.value, asset_receiver=pool_address,
                asset_amount=pending.pnet_output.as_uint64(), fee=UInt64(0),
            ),
            itxn.ApplicationCall(
                app_id=tinyman, app_args=(b"add_initial_liquidity",), accounts=(pool_address,),
                assets=(algopy.Asset(pool_token_id),), fee=UInt64(0),
                note=b"PNET Launchpad v2 initial liquidity",
            ),
        )

        reserve_1, has_r1 = op.AppLocal.get_ex_uint64(pool_address, tinyman, b"asset_1_reserves")
        reserve_2, has_r2 = op.AppLocal.get_ex_uint64(pool_address, tinyman, b"asset_2_reserves")
        issued_after, has_issued_after = op.AppLocal.get_ex_uint64(pool_address, tinyman, b"issued_pool_tokens")
        assert has_r1 and has_r2 and has_issued_after, "Tinyman did not update pool state"
        assert reserve_1 == pending.total_raw.as_uint64(), "Wrong token reserve"
        assert reserve_2 == pending.pnet_output.as_uint64(), "Wrong PNET reserve"

        received_lp, app_lp_opted = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, pool_token_id
        )
        assert app_lp_opted and received_lp > UInt64(0), "No LP received"
        assert issued_after == received_lp + UInt64(LOCKED_TINYMAN_POOL_TOKENS), "LP issuance mismatch"
        burned_lp = ((received_lp // UInt64(BPS_DENOMINATOR)) * UInt64(BURN_BPS)
                     + ((received_lp % UInt64(BPS_DENOMINATOR)) * UInt64(BURN_BPS))
                     // UInt64(BPS_DENOMINATOR))
        distributable_lp = received_lp - burned_lp
        creator_lp = distributable_lp // UInt64(2)
        platform_lp = distributable_lp - creator_lp
        assert burned_lp > UInt64(0) and creator_lp > UInt64(0) and platform_lp > UInt64(0), "Liquidity too small"

        itxn.AssetTransfer(
            xfer_asset=pool_token_id, asset_receiver=self.burn_account.value,
            asset_amount=burned_lp, fee=UInt64(0), note=b"PNET Launchpad v2 ARC-54 LP burn",
        ).submit()
        itxn.AssetTransfer(
            xfer_asset=pool_token_id, asset_receiver=Txn.sender,
            asset_amount=creator_lp, fee=UInt64(0), note=b"PNET Launchpad v2 creator LP",
        ).submit()

        self.reserved_pnet.value = self.reserved_pnet.value - pending.pnet_output.as_uint64()
        self.platform_allocations[pool_token_id] = PlatformAllocation(
            arc4.UInt64(asset_id), arc4.UInt64(pool_token_id), arc4.UInt64(platform_lp),
            arc4.UInt64(UInt64(ALLOCATION_PLATFORM_LP)),
        ).copy()
        self.launches[asset_id] = LaunchRecord(
            launcher=arc4.Address(Txn.sender), asset_id=arc4.UInt64(asset_id), total_raw=pending.total_raw,
            status=arc4.UInt64(UInt64(STATUS_COMPLETE)), created_round=pending.created_round,
            swap_round=pending.swap_round, terminal_round=arc4.UInt64(Global.round),
            pool_address=arc4.Address(pool_address), pool_token_id=arc4.UInt64(pool_token_id),
            pnet_seed=pending.pnet_output, burned_lp=arc4.UInt64(burned_lp),
            creator_lp=arc4.UInt64(creator_lp), platform_lp=arc4.UInt64(platform_lp),
            cancel_creator_token=arc4.UInt64(UInt64(0)), cancel_platform_token=arc4.UInt64(UInt64(0)),
            cancel_creator_pnet=arc4.UInt64(UInt64(0)), cancel_platform_pnet=arc4.UInt64(UInt64(0)),
            cancel_platform_pnet_remaining=arc4.UInt64(UInt64(0)),
            vestige_granted=arc4.UInt64(UInt64(0)), vestige_funding=arc4.UInt64(UInt64(0)),
            create_tx_id=pending.create_tx_id.copy(), swap_tx_id=pending.swap_tx_id.copy(),
            terminal_tx_id=arc4.DynamicBytes(Txn.tx_id), vestige_tx_id=arc4.DynamicBytes(ZERO_TX_ID),
            release_tx_id=arc4.DynamicBytes(ZERO_TX_ID),
        ).copy()
        self.launch_index[self.total_records.value] = asset_id
        self.total_records.value = self.total_records.value + UInt64(1)
        del self.pending[Txn.sender]
        arc4.emit(LaunchFinalized(
            arc4.Address(Txn.sender), arc4.UInt64(asset_id), arc4.UInt64(pool_token_id),
            arc4.UInt64(burned_lp), arc4.UInt64(creator_lp), arc4.UInt64(platform_lp),
        ))

    @arc4.abimethod
    def cancel_created(self, asset_id: UInt64) -> None:
        """Return an un-swapped ASA after the recovery delay and free the wallet slot."""
        assert Global.group_size == UInt64(1), "Created cancellation must be standalone"
        assert Txn.fee == Global.min_txn_fee * UInt64(3), "Wrong created cancellation fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert Txn.sender in self.pending, "Unknown launch"
        pending = self.pending[Txn.sender].copy()
        assert pending.asset_id.as_uint64() == asset_id, "Asset mismatch"
        assert pending.status.as_uint64() == UInt64(STATUS_CREATED), "PNET already escrowed"
        assert Global.round >= pending.created_round.as_uint64(), "Invalid creation round"
        assert Global.round - pending.created_round.as_uint64() >= UInt64(CANCEL_DELAY_ROUNDS), "Cancellation delay active"

        creator_balance, creator_opted = op.AssetHoldingGet.asset_balance(Txn.sender, asset_id)
        assert creator_opted and creator_balance == UInt64(0), "Creator ASA recovery opt-in missing"
        itxn.AssetTransfer(
            xfer_asset=asset_id, asset_receiver=Txn.sender,
            asset_amount=pending.total_raw.as_uint64(), fee=UInt64(0),
            note=b"PNET Launchpad v2 un-swapped ASA recovery",
        ).submit()
        # This launch never creates a platform-allocation box, so return the
        # exact MBR amount that was prepaid for it.
        itxn.Payment(
            receiver=Txn.sender, amount=UInt64(PLATFORM_ALLOCATION_MBR), fee=UInt64(0),
            note=b"PNET Launchpad v2 unused allocation-box MBR refund",
        ).submit()

        self.launches[asset_id] = LaunchRecord(
            launcher=arc4.Address(Txn.sender), asset_id=arc4.UInt64(asset_id), total_raw=pending.total_raw,
            status=arc4.UInt64(UInt64(STATUS_CANCELLED)), created_round=pending.created_round,
            swap_round=arc4.UInt64(UInt64(0)), terminal_round=arc4.UInt64(Global.round),
            pool_address=arc4.Address(algopy.Account()), pool_token_id=arc4.UInt64(UInt64(0)),
            pnet_seed=arc4.UInt64(UInt64(0)), burned_lp=arc4.UInt64(UInt64(0)),
            creator_lp=arc4.UInt64(UInt64(0)), platform_lp=arc4.UInt64(UInt64(0)),
            cancel_creator_token=pending.total_raw, cancel_platform_token=arc4.UInt64(UInt64(0)),
            cancel_creator_pnet=arc4.UInt64(UInt64(0)), cancel_platform_pnet=arc4.UInt64(UInt64(0)),
            cancel_platform_pnet_remaining=arc4.UInt64(UInt64(0)),
            vestige_granted=arc4.UInt64(UInt64(0)), vestige_funding=arc4.UInt64(UInt64(0)),
            create_tx_id=pending.create_tx_id.copy(), swap_tx_id=pending.swap_tx_id.copy(),
            terminal_tx_id=arc4.DynamicBytes(Txn.tx_id), vestige_tx_id=arc4.DynamicBytes(ZERO_TX_ID),
            release_tx_id=arc4.DynamicBytes(ZERO_TX_ID),
        ).copy()
        self.launch_index[self.total_records.value] = asset_id
        self.total_records.value = self.total_records.value + UInt64(1)
        del self.pending[Txn.sender]
        arc4.emit(LaunchCancelled(
            arc4.Address(Txn.sender), arc4.UInt64(asset_id), pending.total_raw, arc4.UInt64(UInt64(0)),
        ))

    @arc4.abimethod
    def cancel_launch(self, asset_id: UInt64) -> None:
        """Resolve an escrowed launch after the immutable 20,000-round delay."""
        assert Global.group_size == UInt64(1), "Cancel must be standalone"
        assert Txn.fee == Global.min_txn_fee * UInt64(4), "Wrong cancel fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert Txn.sender in self.pending, "Unknown launch"
        pending = self.pending[Txn.sender].copy()
        assert pending.asset_id.as_uint64() == asset_id, "Asset mismatch"
        assert pending.status.as_uint64() == UInt64(STATUS_PNET_ESCROWED), "Nothing escrowed"
        assert Global.round >= pending.swap_round.as_uint64(), "Invalid swap round"
        assert Global.round - pending.swap_round.as_uint64() >= UInt64(CANCEL_DELAY_ROUNDS), "Cancellation delay active"

        app_pnet_balance, app_pnet_opted = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, self.pnet_asset_id.value
        )
        assert app_pnet_opted, "Launchpad PNET holding missing"
        assert app_pnet_balance >= self.reserved_pnet.value + self.platform_pnet.value, "Escrowed PNET invariant failed"

        creator_token_balance, creator_token_opted = op.AssetHoldingGet.asset_balance(Txn.sender, asset_id)
        creator_pnet_balance, creator_pnet_opted = op.AssetHoldingGet.asset_balance(
            Txn.sender, self.pnet_asset_id.value
        )
        platform_pnet_balance, platform_pnet_opted = op.AssetHoldingGet.asset_balance(
            algopy.Account(PLATFORM_WALLET_ADDRESS), self.pnet_asset_id.value
        )
        assert creator_token_opted and creator_pnet_opted, "Creator recovery opt-ins missing"

        creator_token = pending.total_raw.as_uint64() // UInt64(2)
        platform_token = pending.total_raw.as_uint64() - creator_token
        creator_pnet = pending.pnet_output.as_uint64() // UInt64(2)
        platform_pnet = pending.pnet_output.as_uint64() - creator_pnet
        itxn.AssetTransfer(
            xfer_asset=asset_id, asset_receiver=Txn.sender, asset_amount=creator_token,
            fee=UInt64(0), note=b"PNET Launchpad v2 cancellation token refund",
        ).submit()
        itxn.AssetTransfer(
            xfer_asset=self.pnet_asset_id.value, asset_receiver=Txn.sender, asset_amount=creator_pnet,
            fee=UInt64(0), note=b"PNET Launchpad v2 cancellation PNET refund",
        ).submit()
        platform_pnet_remaining = UInt64(0)
        if platform_pnet_opted:
            itxn.AssetTransfer(
                xfer_asset=self.pnet_asset_id.value, asset_receiver=algopy.Account(PLATFORM_WALLET_ADDRESS),
                asset_amount=platform_pnet, fee=UInt64(0), note=b"PNET Launchpad v2 cancelled platform PNET",
            ).submit()
        else:
            platform_pnet_remaining = platform_pnet
            self.platform_pnet.value = self.platform_pnet.value + platform_pnet

        self.reserved_pnet.value = self.reserved_pnet.value - pending.pnet_output.as_uint64()
        self.platform_allocations[asset_id] = PlatformAllocation(
            arc4.UInt64(asset_id), arc4.UInt64(asset_id), arc4.UInt64(platform_token),
            arc4.UInt64(UInt64(ALLOCATION_CANCELLED_ASA)),
        ).copy()
        self.launches[asset_id] = LaunchRecord(
            launcher=arc4.Address(Txn.sender), asset_id=arc4.UInt64(asset_id), total_raw=pending.total_raw,
            status=arc4.UInt64(UInt64(STATUS_CANCELLED)), created_round=pending.created_round,
            swap_round=pending.swap_round, terminal_round=arc4.UInt64(Global.round),
            pool_address=arc4.Address(algopy.Account()), pool_token_id=arc4.UInt64(UInt64(0)),
            pnet_seed=pending.pnet_output, burned_lp=arc4.UInt64(UInt64(0)),
            creator_lp=arc4.UInt64(UInt64(0)), platform_lp=arc4.UInt64(UInt64(0)),
            cancel_creator_token=arc4.UInt64(creator_token), cancel_platform_token=arc4.UInt64(platform_token),
            cancel_creator_pnet=arc4.UInt64(creator_pnet), cancel_platform_pnet=arc4.UInt64(platform_pnet),
            cancel_platform_pnet_remaining=arc4.UInt64(platform_pnet_remaining),
            vestige_granted=arc4.UInt64(UInt64(0)), vestige_funding=arc4.UInt64(UInt64(0)),
            create_tx_id=pending.create_tx_id.copy(), swap_tx_id=pending.swap_tx_id.copy(),
            terminal_tx_id=arc4.DynamicBytes(Txn.tx_id), vestige_tx_id=arc4.DynamicBytes(ZERO_TX_ID),
            release_tx_id=arc4.DynamicBytes(ZERO_TX_ID),
        ).copy()
        self.launch_index[self.total_records.value] = asset_id
        self.total_records.value = self.total_records.value + UInt64(1)
        del self.pending[Txn.sender]
        arc4.emit(LaunchCancelled(
            arc4.Address(Txn.sender), arc4.UInt64(asset_id), arc4.UInt64(creator_token), arc4.UInt64(creator_pnet),
        ))

    @arc4.abimethod
    def release_cancelled_pnet(self, asset_id: UInt64) -> UInt64:
        """Release deferred cancellation PNET only to the hardcoded platform wallet."""
        assert Txn.sender == algopy.Account(PLATFORM_WALLET_ADDRESS), "Platform authority required"
        assert Global.group_size == UInt64(1), "PNET release must be standalone"
        assert Txn.fee == Global.min_txn_fee * UInt64(2), "Wrong PNET release fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert asset_id in self.launches, "Unknown launch"
        record = self.launches[asset_id].copy()
        assert record.status.as_uint64() == UInt64(STATUS_CANCELLED), "Launch is not cancelled"
        remaining = record.cancel_platform_pnet_remaining.as_uint64()
        assert remaining > UInt64(0), "No deferred platform PNET"
        platform_balance, platform_opted = op.AssetHoldingGet.asset_balance(
            algopy.Account(PLATFORM_WALLET_ADDRESS), self.pnet_asset_id.value
        )
        app_balance, app_opted = op.AssetHoldingGet.asset_balance(
            Global.current_application_address, self.pnet_asset_id.value
        )
        assert platform_opted, "Platform must opt into PNET"
        assert app_opted and app_balance >= self.reserved_pnet.value + self.platform_pnet.value, "PNET custody invariant failed"
        assert self.platform_pnet.value >= remaining, "Tracked PNET allocation mismatch"
        itxn.AssetTransfer(
            xfer_asset=self.pnet_asset_id.value,
            asset_receiver=algopy.Account(PLATFORM_WALLET_ADDRESS),
            asset_amount=remaining, fee=UInt64(0),
            note=b"PNET Launchpad v2 deferred cancellation PNET",
        ).submit()
        self.platform_pnet.value = self.platform_pnet.value - remaining
        record.cancel_platform_pnet_remaining = arc4.UInt64(UInt64(0))
        record.release_tx_id = arc4.DynamicBytes(Txn.tx_id)
        self.launches[asset_id] = record.copy()
        return remaining

    @arc4.abimethod
    def grant_vestige_access(
        self, vestige_funding: gtxn.PaymentTransaction, asset_id: UInt64,
    ) -> None:
        """Grant creator metadata access after completion; safe to retry if unconfirmed."""
        assert Global.group_size == UInt64(2), "Vestige requires funding and app call"
        assert vestige_funding.group_index + UInt64(1) == Txn.group_index, "Funding must precede call"
        assert vestige_funding.sender == Txn.sender, "Vestige funding sender mismatch"
        assert asset_id in self.launches, "Unknown launch"
        record = self.launches[asset_id].copy()
        assert record.status.as_uint64() == UInt64(STATUS_COMPLETE), "Launch must be complete"
        assert record.launcher.native == Txn.sender, "Only launcher may grant access"
        assert record.vestige_granted.as_uint64() == UInt64(0), "Vestige already granted"

        vestige = algopy.Application(self.vestige_app_id.value)
        assert vestige_funding.receiver == vestige.address, "Wrong Vestige receiver"
        assert vestige_funding.amount == UInt64(VESTIGE_FUNDING), "Wrong Vestige MBR"
        assert vestige_funding.fee == Global.min_txn_fee, "Wrong Vestige funding fee"
        assert vestige_funding.close_remainder_to == algopy.Account(), "No Vestige close"
        assert vestige_funding.rekey_to == algopy.Account(), "No Vestige rekey"
        assert Txn.fee == Global.min_txn_fee * UInt64(2), "Wrong Vestige app fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"

        arc4.abi_call(
            "add_asset_metadata_manager(asset,address)void", algopy.Asset(asset_id), arc4.Address(Txn.sender),
            app_id=vestige, fee=UInt64(0), note=b"PNET Launchpad v2 Vestige delegation",
        )
        record.vestige_granted = arc4.UInt64(UInt64(1))
        record.vestige_funding = arc4.UInt64(UInt64(VESTIGE_FUNDING))
        record.vestige_tx_id = arc4.DynamicBytes(Txn.tx_id)
        self.launches[asset_id] = record.copy()
        arc4.emit(VestigeAccessGranted(arc4.Address(Txn.sender), arc4.UInt64(asset_id)))

    @arc4.abimethod
    def release_platform_allocation(
        self, holding_asset_id: UInt64, receiver: algopy.Account, amount: UInt64,
    ) -> UInt64:
        """Release only a recorded platform allocation under hardcoded authority."""
        assert Txn.sender == algopy.Account(PLATFORM_WALLET_ADDRESS), "Platform authority required"
        assert Global.group_size == UInt64(1), "Release must be standalone"
        assert Txn.fee == Global.min_txn_fee * UInt64(2), "Wrong release fee"
        assert Txn.rekey_to == algopy.Account(), "No app-call rekey"
        assert holding_asset_id in self.platform_allocations, "Unknown platform allocation"
        assert receiver != algopy.Account(), "Receiver required"
        assert amount > UInt64(0), "Release amount required"
        allocation = self.platform_allocations[holding_asset_id].copy()
        assert allocation.holding_asset_id.as_uint64() == holding_asset_id, "Allocation asset mismatch"
        assert amount <= allocation.remaining.as_uint64(), "Release exceeds platform allocation"
        receiver_balance, receiver_opted = op.AssetHoldingGet.asset_balance(receiver, holding_asset_id)
        assert receiver_opted, "Receiver must opt into asset"

        itxn.AssetTransfer(
            xfer_asset=holding_asset_id, asset_receiver=receiver, asset_amount=amount,
            fee=UInt64(0), note=b"PNET Launchpad v2 platform allocation",
        ).submit()
        remaining = allocation.remaining.as_uint64() - amount
        launch_asset_id = allocation.launch_asset_id.as_uint64()
        record = self.launches[launch_asset_id].copy()
        record.release_tx_id = arc4.DynamicBytes(Txn.tx_id)
        self.launches[launch_asset_id] = record.copy()
        if remaining == UInt64(0):
            del self.platform_allocations[holding_asset_id]
        else:
            allocation.remaining = arc4.UInt64(remaining)
            self.platform_allocations[holding_asset_id] = allocation.copy()
        arc4.emit(PlatformAllocationReleased(
            arc4.UInt64(holding_asset_id), arc4.Address(receiver), arc4.UInt64(amount), arc4.UInt64(remaining),
        ))
        return remaining

    @arc4.abimethod(readonly=True)
    def get_pending(self, launcher: algopy.Account) -> PendingLaunch:
        assert launcher in self.pending, "Unknown pending launch"
        return self.pending[launcher].copy()

    @arc4.abimethod(readonly=True)
    def get_launch(self, asset_id: UInt64) -> LaunchRecord:
        assert asset_id in self.launches, "Unknown launch"
        return self.launches[asset_id].copy()

    @arc4.abimethod(readonly=True)
    def get_asset_at(self, index: UInt64) -> UInt64:
        assert index < self.total_records.value, "Index out of range"
        return self.launch_index[index]

    @arc4.abimethod(readonly=True)
    def get_platform_allocation(self, holding_asset_id: UInt64) -> PlatformAllocation:
        assert holding_asset_id in self.platform_allocations, "Unknown platform allocation"
        return self.platform_allocations[holding_asset_id].copy()

    @arc4.abimethod(readonly=True)
    def get_config(self) -> arc4.Tuple[
        arc4.Address, arc4.Address, arc4.Address, arc4.UInt64, arc4.UInt64,
        arc4.UInt64, arc4.UInt64, arc4.UInt64, arc4.UInt64, arc4.UInt64,
    ]:
        return arc4.Tuple((
            arc4.Address(algopy.Account(PLATFORM_WALLET_ADDRESS)), arc4.Address(self.burn_account.value),
            arc4.Address(self.source_pool.value), arc4.UInt64(self.pnet_asset_id.value),
            arc4.UInt64(self.tinyman_app_id.value), arc4.UInt64(self.vestige_app_id.value),
            arc4.UInt64(self.arc54_app_id.value), arc4.UInt64(self.total_records.value),
            arc4.UInt64(self.initialized.value), arc4.UInt64(self.reserved_pnet.value),
        ))
