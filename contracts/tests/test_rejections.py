"""Everything the contract must refuse."""

import pytest

from devkit import ALGO
from lp import TxFailed, C, MIN_FEE

TOTAL = 1_000_000 * 10**6


def test_name_unit_url_and_supply_bounds(lp, user):
    sk, addr = user
    with pytest.raises(TxFailed):
        lp.start(addr, sk, name="", total_raw=TOTAL)
    with pytest.raises(TxFailed):
        lp.start(addr, sk, name="N" * 33, total_raw=TOTAL)
    with pytest.raises(TxFailed):
        lp.start(addr, sk, unit="U" * 9, total_raw=TOTAL)
    with pytest.raises(TxFailed):
        lp.start(addr, sk, url="u" * 97, total_raw=TOTAL)
    with pytest.raises(TxFailed):
        lp.start(addr, sk, total_raw=1_999)
    # exact upper bounds are accepted
    lp.start(addr, sk, name="N" * 32, unit="U" * 8, url="u" * 96, total_raw=TOTAL)


def test_start_wrong_funding_rejected(lp, user):
    sk, addr = user
    for amount in (C["LAUNCH_START_FUNDING"] - 1, C["LAUNCH_START_FUNDING"] + 1):
        with pytest.raises(TxFailed):
            lp.start(addr, sk, total_raw=TOTAL, funding=amount)


def test_start_stale_future_and_over_limit_quotes(lp, user, dev):
    sk, addr = user
    with pytest.raises(TxFailed):
        lp.start(addr, sk, total_raw=TOTAL, quote_round=dev.round() - 11)
    with pytest.raises(TxFailed):
        lp.start(addr, sk, total_raw=TOTAL, quote_round=dev.round() + 50)
    with pytest.raises(TxFailed):  # asks for more PNET than the pool can give
        lp.start(addr, sk, total_raw=TOTAL, minimum_pnet=10**15)


def test_second_start_while_pending_rejected(lp, user):
    sk, addr = user
    lp.start(addr, sk, total_raw=TOTAL)
    with pytest.raises(TxFailed):
        lp.start(addr, sk, name="Again", total_raw=TOTAL)


def test_finish_requires_the_launcher_and_a_pending_launch(lp, user, dev, proto):
    sk, addr = user
    osk, other = dev.new_account()
    proto.fund_user_pnet(other, osk)
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    with pytest.raises(TxFailed):  # another wallet cannot finish someone else's launch
        lp.finish(other, osk, asset_id)
    lp.finish(addr, sk, asset_id)
    with pytest.raises(TxFailed):  # a finished launch cannot be finished again
        lp.finish(addr, sk, asset_id, with_bootstrap=False)


def test_finish_wrong_funding_and_wrong_pool(lp, user, dev, proto):
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    standard = C["LP_HOLDING_MBR"] + C["ARC54_LP_HOLDING_MBR"] + C["VESTIGE_FUNDING"]
    for amount in (standard - 1, standard + 1):
        with pytest.raises(TxFailed):
            lp.finish(addr, sk, asset_id, funding=amount)
    # a pool for a different pair must be refused
    osk, other = dev.new_account()
    foreign = dev.create_asset(osk, other, "FOREIGN")
    proto.tm.bootstrap(osk, other, foreign, proto.pnet)
    with pytest.raises(TxFailed):
        lp.finish(addr, sk, asset_id, with_bootstrap=False, pool_override=proto.tm.pool_address(foreign, proto.pnet))
    lp.finish(addr, sk, asset_id)  # the honest group still works after the refused attempts


def test_claim_rules(lp, user, dev):
    sk, addr = user
    osk, other = dev.new_account()
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    with pytest.raises(TxFailed):  # nothing to claim before the launch completes
        lp._run(lp.claim_group(addr, sk, asset_id, 1))
    lp.finish(addr, sk, asset_id)
    lp_id = int(dev.algod.account_info(lp.address)["assets"][-1]["asset-id"])
    with pytest.raises(TxFailed):  # only the launcher may claim
        lp._run(lp.claim_group(other, osk, asset_id, lp_id))


def test_create_and_initialize_guards(proto, platform):
    from lp import Launchpad
    with pytest.raises(Exception):
        Launchpad.deploy(proto, cancel_delay=5, platform=platform)  # below the minimum delay
    ok = Launchpad.deploy(proto, cancel_delay=40, platform=platform)
    with pytest.raises(Exception):
        ok.initialize()  # second initialize


def test_arc54_already_opted_into_lp_lowers_the_funding(lp, user, proto, dev):
    """ARC-54 accepts donated MBR, so its LP holding may already exist: the launcher then funds 0.1 ALGO less."""
    from algosdk import transaction as tx
    from devkit import selector
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    osk, other = dev.new_account()
    proto.tm.bootstrap(osk, other, asset_id, proto.pnet)
    lp_id = int(proto.tm.pool_state(asset_id, proto.pnet)["pool_token_asset_id"])
    donate = tx.PaymentTxn(other, dev.params(), proto.burn, 100_000)
    opt_in = tx.ApplicationNoOpTxn(
        other, dev.params(2_000), proto.arc54, app_args=[selector("arc54_optIntoASA(asset)void"), b"\x00"], foreign_assets=[lp_id],
    )
    dev.send([donate, opt_in], [osk, osk])
    assert dev.holds(proto.burn, lp_id)
    with pytest.raises(TxFailed):  # the standard funding is now too high
        lp.finish(addr, sk, asset_id, with_bootstrap=False)
    lp.finish(addr, sk, asset_id, with_bootstrap=False, funding=C["LP_HOLDING_MBR"] + C["VESTIGE_FUNDING"], fee=11_000)
    assert proto.tm.pool_state(asset_id, proto.pnet)["asset_1_reserves"] == TOTAL


def test_thin_source_pool_price_impact_is_refused(dev, platform):
    """A source pool so small that one ALGO moves its price by more than five percent must be refused at start."""
    from lp import Launchpad, Protocol
    thin = Protocol.deploy(dev, pool_pnet=100_000 * 10**6, pool_algo=5 * 10**6)
    lp2 = Launchpad.deploy(thin, cancel_delay=40, platform=platform)
    sk, addr = dev.new_account()
    thin.fund_user_pnet(addr, sk)
    with pytest.raises(TxFailed):
        lp2.start(addr, sk, total_raw=TOTAL)