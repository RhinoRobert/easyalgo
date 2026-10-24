"""Everything the contract must refuse, each for exactly the assertion that is supposed to stop it."""

import pytest
from algosdk import transaction as tx

from devkit import selector
from lp import C, Launchpad, Protocol

TOTAL = 1_000_000 * 10**6
STANDARD_FINISH = C["LP_HOLDING_MBR"] + C["ARC54_LP_HOLDING_MBR"] + C["VESTIGE_FUNDING"]


def test_name_unit_url_and_supply_bounds(lp, user):
    sk, addr = user
    lp.refused(lambda: lp.start(addr, sk, name="", total_raw=TOTAL), "Invalid name length")
    lp.refused(lambda: lp.start(addr, sk, name="N" * 33, total_raw=TOTAL), "Invalid name length")
    lp.refused(lambda: lp.start(addr, sk, unit="U" * 9, total_raw=TOTAL), "Invalid unit length")
    lp.refused(lambda: lp.start(addr, sk, url="u" * 97, total_raw=TOTAL), "URL exceeds 96 bytes")
    lp.refused(lambda: lp.start(addr, sk, total_raw=1_999), "Supply too small")
    lp.start(addr, sk, name="N" * 32, unit="U" * 8, url="u" * 96, total_raw=TOTAL)  # the exact upper bounds work


def test_start_wrong_funding_rejected(lp, user):
    sk, addr = user
    for amount in (C["LAUNCH_START_FUNDING"] - 1, C["LAUNCH_START_FUNDING"] + 1):
        lp.refused(lambda amount=amount: lp.start(addr, sk, total_raw=TOTAL, funding=amount), "Wrong launch funding")


def test_start_stale_future_and_over_limit_quotes(lp, user, dev):
    sk, addr = user
    lp.refused(lambda: lp.start(addr, sk, total_raw=TOTAL, quote_round=dev.round() - 61), "Quote expired")
    lp.refused(lambda: lp.start(addr, sk, total_raw=TOTAL, quote_round=dev.round() + 50), "Quote round is in the future")
    lp.refused(lambda: lp.start(addr, sk, total_raw=TOTAL, minimum_pnet=10**15), "Quoted output is no longer available")
    lp.start(addr, sk, total_raw=TOTAL, quote_round=dev.round() - 30)  # a half-minute-old quote is fine


def test_second_start_while_pending_rejected(lp, user):
    sk, addr = user
    lp.start(addr, sk, total_raw=TOTAL)
    lp.refused(lambda: lp.start(addr, sk, name="Again", total_raw=TOTAL), "Finish current launch first")


def test_finish_requires_the_launcher_and_a_pending_launch(lp, user, dev, proto):
    sk, addr = user
    osk, other = dev.new_account()
    proto.fund_user_pnet(other, osk)
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    lp.refused(lambda: lp.finish(other, osk, asset_id), "Unknown launch")
    lp.finish(addr, sk, asset_id)
    lp.refused(lambda: lp.finish(addr, sk, asset_id, with_bootstrap=False), "Unknown launch")


def test_finish_wrong_funding_and_wrong_pool(lp, user, dev, proto):
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    for amount in (STANDARD_FINISH - 1, STANDARD_FINISH + 1):
        lp.refused(lambda amount=amount: lp.finish(addr, sk, asset_id, funding=amount), "Wrong launch funding")
    # a real pool for a different pair must be refused
    osk, other = dev.new_account()
    foreign = dev.create_asset(osk, other, "FOREIGN")
    proto.tm.bootstrap(osk, other, foreign, proto.pnet)
    foreign_pool = proto.tm.pool_address(foreign, proto.pnet)
    lp.refused(
        lambda: lp.finish(addr, sk, asset_id, with_bootstrap=False, pool_override=foreign_pool), "Wrong Tinyman pair/order",
    )
    lp.finish(addr, sk, asset_id)  # the honest group still works after the refused attempts


def test_tinyman_itself_refuses_a_non_canonical_pool_bootstrap(lp, user, dev, proto):
    """The contract also hashes the canonical pool address itself, but Tinyman's validator already refuses look-alike pools:
    an attacker's own LogicSig cannot get Tinyman state for the pair, so no look-alike pool can ever be offered to the launch."""
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    osk, other = dev.new_account()
    fake = tx.LogicSigAccount(dev.compile("#pragma version 6\nint 1"))
    a1, a2 = max(asset_id, proto.pnet), min(asset_id, proto.pnet)
    fund = tx.PaymentTxn(other, dev.params(), fake.address(), 1_049_000)
    boot = tx.ApplicationOptInTxn(
        fake.address(), dev.params(7_000), proto.tm.app_id, app_args=[b"bootstrap"], foreign_assets=[a1, a2],
        rekey_to=proto.tm.app_address,
    )
    with pytest.raises(Exception):
        dev.send([fund, boot], [osk, fake])

def test_claim_rules(lp, user, dev, proto):
    sk, addr = user
    osk, other = dev.new_account()
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    lp.refused(lambda: lp._run(lp.claim_group(addr, sk, asset_id, proto.pnet)), "Unknown launch")  # not finished: no launch record yet
    lp.finish(addr, sk, asset_id)
    lp_id = int(dev.algod.account_info(lp.address)["assets"][-1]["asset-id"])
    lp.refused(lambda: lp._run(lp.claim_group(other, osk, asset_id, lp_id)), "Only the launcher may claim")
    lp._run(lp.claim_group(addr, sk, asset_id, lp_id))
    lp.refused(lambda: lp._run(lp.claim_group(addr, sk, asset_id, lp_id)), "Creator LP already claimed")


def test_create_and_initialize_guards(proto, platform):
    with pytest.raises(Exception):
        Launchpad.deploy(proto, cancel_delay=5, platform=platform)  # below the minimum delay
    ok = Launchpad.deploy(proto, cancel_delay=40, platform=platform)
    with pytest.raises(Exception):
        ok.initialize()  # second initialize


def test_arc54_already_opted_into_lp_lowers_the_funding(lp, user, proto, dev):
    """ARC-54 accepts donated MBR, so its LP holding may already exist: the launcher then funds 0.1 ALGO less."""
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
    lp.refused(lambda: lp.finish(addr, sk, asset_id, with_bootstrap=False), "Wrong launch funding")
    lp.finish(addr, sk, asset_id, with_bootstrap=False, funding=C["LP_HOLDING_MBR"] + C["VESTIGE_FUNDING"], fee=11_000)
    assert proto.tm.pool_state(asset_id, proto.pnet)["asset_1_reserves"] == TOTAL


def test_thin_source_pool_price_impact_is_refused(dev, platform):
    """A source pool so small that one ALGO moves its price by more than five percent must be refused at start."""
    thin = Protocol.deploy(dev, pool_pnet=100_000 * 10**6, pool_algo=5 * 10**6)
    lp2 = Launchpad.deploy(thin, cancel_delay=40, platform=platform)
    sk, addr = dev.new_account()
    thin.fund_user_pnet(addr, sk)
    lp2.refused(lambda: lp2.start(addr, sk, total_raw=TOTAL), "Price impact exceeds five percent")
