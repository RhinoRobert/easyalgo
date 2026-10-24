"""The timed cancellation: the only way out when a launch cannot finish."""

import pytest

from lp import TxFailed

TOTAL = 1_000_000 * 10**6


def started(lp, user, proto, dev):
    sk, addr = user
    pnet_before = dev.balance(addr, proto.pnet)
    free_before = lp.free_balance()
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    pnet_seed = dev.balance(lp.address, proto.pnet)
    dev.opt_in(sk, addr, asset_id)  # recovery opt-in the UI performs for the launcher
    return sk, addr, asset_id, pnet_seed, pnet_before, free_before


def test_cancel_before_delay_is_refused(lp, user, proto, dev):
    sk, addr, asset_id, *_ = started(lp, user, proto, dev)
    lp.refused(lambda: lp._run(lp.cancel_group(addr, sk, asset_id)), "Cancellation delay active")


def test_cancel_after_delay_with_platform_opted_in(lp, user, proto, dev):
    sk, addr, asset_id, pnet_seed, pnet_before, free_before = started(lp, user, proto, dev)
    psk, paddr = lp.admin_sk, lp.admin
    dev.opt_in(psk, paddr, proto.pnet)  # platform can receive its PNET half straight away
    dev.advance(lp.cancel_delay + 1)
    token_before = dev.balance(addr, asset_id)
    platform_pnet_before = dev.balance(paddr, proto.pnet)

    lp._run(lp.cancel_group(addr, sk, asset_id))

    assert dev.balance(addr, asset_id) - token_before == TOTAL // 2
    assert dev.balance(addr, proto.pnet) - pnet_before == pnet_seed // 2
    assert dev.balance(paddr, proto.pnet) - platform_pnet_before == pnet_seed - pnet_seed // 2
    assert dev.balance(lp.address, proto.pnet) == 0
    assert dev.balance(lp.address, asset_id) == TOTAL - TOTAL // 2  # the platform's token half stays as a recorded allocation
    assert lp.free_balance() == free_before, "cancel returns the pending deposit and consumes the prepaid records: net zero"

    # the platform releases its recorded token half to itself
    dev.opt_in(psk, paddr, asset_id)
    lp._run(lp.release_platform_group(asset_id, asset_id, paddr, TOTAL - TOTAL // 2))
    assert dev.balance(paddr, asset_id) == TOTAL - TOTAL // 2
    # a cancelled launch cannot be cancelled or finished again
    lp.refused(lambda: lp._run(lp.cancel_group(addr, sk, asset_id)), "Unknown launch")


def test_cancel_with_platform_not_opted_in_defers_pnet(lp, user, proto, dev):
    sk, addr, asset_id, pnet_seed, pnet_before, free_before = started(lp, user, proto, dev)
    psk, paddr = lp.admin_sk, lp.admin
    dev.advance(lp.cancel_delay + 1)
    lp._run(lp.cancel_group(addr, sk, asset_id))
    deferred = pnet_seed - pnet_seed // 2
    assert dev.balance(lp.address, proto.pnet) == deferred
    # not releasable until the platform opts in; then it receives exactly the deferred amount
    lp.refused(lambda: lp._run(lp.release_pnet_group(asset_id)), "Platform must opt into PNET")
    dev.opt_in(psk, paddr, proto.pnet)
    lp._run(lp.release_pnet_group(asset_id))
    assert dev.balance(paddr, proto.pnet) == deferred
    assert dev.balance(lp.address, proto.pnet) == 0
    lp.refused(lambda: lp._run(lp.release_pnet_group(asset_id)), "No deferred platform PNET")  # nothing left to release


def test_cancel_needs_recovery_opt_ins(lp, user, proto, dev):
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)  # launcher has NOT opted into the new asset
    dev.advance(lp.cancel_delay + 1)
    lp.refused(lambda: lp._run(lp.cancel_group(addr, sk, asset_id)), "Creator recovery opt-ins missing")


def test_cancel_with_recovery_opt_ins_in_the_same_group(lp, user, proto, dev):
    """One approval: the ASA opt-in, the PNET opt-in and the cancel call travel in one atomic group."""
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    dev.advance(lp.cancel_delay + 1)
    assert not dev.holds(addr, asset_id)
    lp._run(lp.cancel_group(addr, sk, asset_id, with_opt_ins=True))
    assert dev.balance(addr, asset_id) == TOTAL // 2