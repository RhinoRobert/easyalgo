"""Full launch on the private devnet against the unchanged MainNet Tinyman / ARC-54 / Vestige programs."""

import pytest

from devkit import ALGO
from lp import TxFailed, launch_box, pending_box, C

TOTAL = 1_000_000 * 10**6


def split(received: int) -> tuple[int, int, int]:
    """The contract's integer math: 80% burn (floored per 10,000 block + remainder), the rest 50/50 creator / platform."""
    burned = received // 10_000 * 8_000 + (received % 10_000) * 8_000 // 10_000
    distributable = received - burned
    creator = distributable // 2
    return burned, creator, distributable - creator


def test_start_creates_clean_immutable_asset_and_buys_pnet(lp, user, proto, dev):
    sk, addr = user
    free_before = lp.free_balance()
    pnet_before = dev.balance(lp.address, proto.pnet)

    asset_id = lp.start(addr, sk, name="Canary Test", unit="CNRY", total_raw=TOTAL, url="https://example.org/x")

    info = dev.algod.asset_info(asset_id)["params"]
    assert info["name"] == "Canary Test" and info["unit-name"] == "CNRY" and info["url"] == "https://example.org/x"
    assert info["creator"] == lp.address and info["total"] == TOTAL and info["decimals"] == 6
    assert not info.get("default-frozen")
    for role in ("manager", "reserve", "freeze", "clawback"):
        assert role not in info, f"{role} must be empty (immutable asset)"
    # byte-exact: no ARC-4 length prefix leaks into the ASA fields (the v2 defect)
    assert info["name-b64"] == "Q2FuYXJ5IFRlc3Q=" and info["unit-name-b64"] == "Q05SWQ=="
    assert dev.balance(lp.address, asset_id) == TOTAL
    assert dev.balance(lp.address, proto.pnet) - pnet_before > 15_000 * 10**6  # about 20k PNET per ALGO; earlier tests move the shared pool price
    assert dev.box(lp.app_id, pending_box(addr)) is not None
    assert lp.free_balance() == free_before + 192_700  # launch record + index + allocation deposits, prepaid by the launcher


def test_full_launch_two_groups_exact_accounting(lp, user, proto, dev):
    sk, addr = user
    free_start = lp.free_balance()
    asset_id = lp.start(addr, sk, name="Canary Test", unit="CNRY", total_raw=TOTAL)
    pnet_seed = dev.balance(lp.address, proto.pnet)

    lp.finish(addr, sk, asset_id)

    state = proto.tm.pool_state(asset_id, proto.pnet)
    assert state["asset_1_reserves"] == TOTAL and state["asset_2_reserves"] == pnet_seed
    lp_id = int(state["pool_token_asset_id"])
    received = int(state["issued_pool_tokens"]) - 1_000
    burned, creator, platform_share = split(received)
    assert dev.balance(proto.burn, lp_id) == burned
    assert dev.balance(lp.address, lp_id) == creator + platform_share
    assert dev.box(lp.app_id, launch_box(asset_id)) is not None and dev.box(lp.app_id, pending_box(addr)) is None
    assert dev.balance(lp.address, asset_id) == 0 and dev.balance(lp.address, proto.pnet) == 0
    assert lp.global_state()["reserved"] == 0 if "reserved" in lp.global_state() else True
    assert lp.free_balance() == free_start, "a complete launch must leave the app's free balance exactly unchanged"

    lp._run(lp.claim_group(addr, sk, asset_id, lp_id))
    assert dev.balance(addr, lp_id) == creator
    lp.refused(lambda: lp._run(lp.claim_group(addr, sk, asset_id, lp_id)), "Creator LP already claimed")

    # the platform's share is released only by the platform authority
    psk, paddr = lp.admin_sk, lp.admin
    dev.opt_in(psk, paddr, lp_id)
    lp.refused(lambda: lp._run(lp.release_platform_group(asset_id, lp_id, addr, platform_share, sender=(sk, addr))), "Platform authority required")
    lp._run(lp.release_platform_group(asset_id, lp_id, paddr, platform_share))
    assert dev.balance(paddr, lp_id) == platform_share
    assert dev.balance(lp.address, lp_id) == 0


def test_finish_without_vestige_then_grant_later(lp, user, proto, dev):
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    lp.finish(addr, sk, asset_id, grant_vestige=0)
    lp._run(lp.vestige_group(addr, sk, asset_id))
    lp.refused(lambda: lp._run(lp.vestige_group(addr, sk, asset_id)), "Vestige already granted")  # already granted


def test_finish_when_pool_already_bootstrapped(lp, user, proto, dev):
    """If anyone already created the (empty) pool, the group simply omits the bootstrap pair."""
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    osk, other = dev.new_account()
    proto.tm.bootstrap(osk, other, asset_id, proto.pnet)
    lp.finish(addr, sk, asset_id, with_bootstrap=False)
    assert proto.tm.pool_state(asset_id, proto.pnet)["asset_1_reserves"] == TOTAL


def test_second_launch_reuses_arc54_lp_holding_flow(lp, user, proto, dev):
    """Two launches in a row, each by a different launcher, leave the app's free balance unchanged and keep both records."""
    free = lp.free_balance()
    sk1, a1 = user
    sk2, a2 = dev.new_account()
    proto.fund_user_pnet(a2, sk2)
    asset1 = lp.start(a1, sk1, name="One", unit="ONE", total_raw=TOTAL)
    asset2 = lp.start(a2, sk2, name="Two", unit="TWO", total_raw=2 * TOTAL)
    lp.finish(a1, sk1, asset1)
    lp.finish(a2, sk2, asset2)  # built after launch 1 finished, so it carries the right index box
    assert lp.total_records() == 2
    assert lp.free_balance() == free
