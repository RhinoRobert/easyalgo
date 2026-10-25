"""Attack-style tests: someone hostile tries to move funds or state the way real launchpad exploits do (rug.ninja, March 2026: fake look-alike
assets sold back to a shared treasury). Every attempt must be refused for exactly the assertion that is supposed to stop it, and an honest
user's launch must still be intact and finishable afterwards."""

import pytest
from algosdk import transaction as tx
from algosdk.atomic_transaction_composer import AccountTransactionSigner, AtomicTransactionComposer, TransactionWithSigner

from devkit import ALGO, MIN_FEE
from lp import M_CLAIM, Launchpad, Protocol, TxFailed, allocation_box, launch_box, pending_box

TOTAL = 1_000_000 * 10**6
ZERO_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"


def lp_asset(proto, asset_id):
    return int(proto.tm.pool_state(asset_id, proto.pnet)["pool_token_asset_id"])


def finished(lp, user, proto):
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    lp.finish(addr, sk, asset_id)
    return asset_id, lp_asset(proto, asset_id)


def allocation_remaining(dev, lp, asset_id):
    box = dev.box(lp.app_id, allocation_box(asset_id))
    return None if box is None else int.from_bytes(box[16:24], "big")  # launch asset, holding asset, remaining, kind


def stranger(dev, proto, pnet=True):
    sk, addr = dev.new_account()
    if pnet:
        proto.fund_user_pnet(addr, sk)
    return sk, addr


# -- who may touch the platform's money ---------------------------------------------------------------------------------------------
def test_only_the_platform_wallet_can_release_platform_funds(lp, user, dev, proto):
    """The platform's recorded allocations and deferred PNET can be released by one wallet only: not the launcher, not a stranger."""
    sk, addr = user
    asset_id, lp_id = finished(lp, user, proto)
    osk, other = stranger(dev, proto)
    dev.opt_in(osk, other, lp_id)
    for who in ((osk, other), (sk, addr)):
        lp.refused(lambda who=who: lp._run(lp.release_platform_group(asset_id, lp_id, who[1], 1, sender=who)), "Platform authority required")
        lp.refused(lambda who=who: lp._run(lp.release_pnet_group(asset_id, sender=who)), "Platform authority required")
    assert allocation_remaining(dev, lp, asset_id) is not None, "nothing was released"


def test_platform_release_is_capped_and_never_reaches_the_creators_liquidity_tokens(lp, user, dev, proto):
    sk, addr = user
    asset_id, lp_id = finished(lp, user, proto)
    app_lp_before = dev.balance(lp.address, lp_id)
    platform_lp = allocation_remaining(dev, lp, asset_id)
    creator_lp = app_lp_before - platform_lp
    assert platform_lp > 0 and creator_lp > 0
    dev.opt_in(lp.admin_sk, lp.admin, lp_id)
    osk, other = stranger(dev, proto, pnet=False)

    def release(amount, receiver=None, launch=None):
        return lambda: lp._run(lp.release_platform_group(launch or asset_id, lp_id, receiver or lp.admin, amount))

    lp.refused(release(0), "Release amount required")
    lp.refused(release(platform_lp + 1), "Release exceeds platform allocation")
    lp.refused(release(app_lp_before), "Release exceeds platform allocation")  # asking for the creator's share too
    lp.refused(release(1, launch=asset_id + 12345), "Unknown platform allocation")
    lp.refused(release(1, receiver=ZERO_ADDRESS), "Receiver required")
    lp.refused(release(1, receiver=other), "Receiver must opt into asset")

    release(platform_lp - 1)()
    lp.refused(release(2), "Release exceeds platform allocation")  # only one unit is left
    release(1)()
    assert allocation_remaining(dev, lp, asset_id) is None, "a fully released allocation is gone"
    lp.refused(release(1), "Unknown platform allocation")

    assert dev.balance(lp.address, lp_id) == creator_lp, "the creator's share was never touched"
    lp._run(lp.claim_group(addr, sk, asset_id, lp_id))
    assert dev.balance(addr, lp_id) == creator_lp
    assert dev.balance(lp.address, lp_id) == 0


# -- spoofed assets and other people's launches ---------------------------------------------------------------------------------------
def test_a_look_alike_or_borrowed_asset_cannot_stand_in_for_your_launch(lp, user, dev, proto):
    """The rug.ninja pattern: present a different asset (a fake with the same name, or someone else's real one) as if it were yours."""
    sk, addr = user
    victim_asset = lp.start(addr, sk, name="Canary", unit="CNRY", total_raw=TOTAL)
    osk, other = stranger(dev, proto)
    own = lp.start(other, osk, name="Mine", unit="MINE", total_raw=TOTAL)
    fake = dev.create_asset(osk, other, "Canary")  # same name and ticker as the victim's, but created by the attacker

    lp.refused(lambda: lp.finish(other, osk, fake), "Asset mismatch")
    lp.refused(lambda: lp.finish(other, osk, victim_asset), "Asset mismatch")
    dev.advance(lp.cancel_delay + 1)
    lp.refused(lambda: lp._run(lp.cancel_group(other, osk, victim_asset, with_opt_ins=True)), "Asset mismatch")
    lp.refused(lambda: lp._run(lp.cancel_group(other, osk, fake, with_opt_ins=True)), "Asset mismatch")

    # nothing about the victim's launch changed: it still finishes, and so does the attacker's own honest one
    assert lp.global_state().get("reserved", 0) > 0
    lp.finish(addr, sk, victim_asset)
    lp.finish(other, osk, own)
    assert lp.global_state().get("reserved", 0) == 0


def test_nobody_can_cancel_or_finish_for_someone_else_or_resolve_twice(lp, user, dev, proto):
    sk, addr = user
    osk, other = stranger(dev, proto)
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    dev.advance(lp.cancel_delay + 1)
    lp.refused(lambda: lp._run(lp.cancel_group(other, osk, asset_id, with_opt_ins=True)), "Unknown launch")
    lp.refused(lambda: lp.finish(other, osk, asset_id), "Unknown launch")
    lp.finish(addr, sk, asset_id)
    lp.refused(lambda: lp._run(lp.cancel_group(addr, sk, asset_id, with_opt_ins=True)), "Unknown launch")  # a finished launch cannot be cancelled


def test_creator_liquidity_tokens_can_only_be_claimed_by_the_creator_with_their_own_opt_in(lp, user, dev, proto):
    sk, addr = user
    asset_id, lp_id = finished(lp, user, proto)
    osk, other = stranger(dev, proto)
    lp.refused(lambda: lp._run(lp.claim_group(addr, sk, asset_id, proto.pnet)), "Wrong LP asset")
    dev.opt_in(osk, other, lp_id)
    lp.refused(lambda: lp._run(lp.claim_group(other, osk, asset_id, lp_id)), "Only the launcher may claim")  # a stranger claiming the creator's share

    def claim(opt_in_txn, opt_in_sk):
        atc = AtomicTransactionComposer()
        lp._composer_call(atc, M_CLAIM, addr, sk, [TransactionWithSigner(opt_in_txn, AccountTransactionSigner(opt_in_sk)), asset_id],
                          2 * MIN_FEE, [launch_box(asset_id)], assets=[lp_id])
        return lp._run(atc)

    lp.refused(lambda: claim(tx.AssetTransferTxn(other, dev.params(), other, 0, lp_id), osk), "LP opt-in sender mismatch")
    lp.refused(lambda: claim(tx.AssetTransferTxn(addr, dev.params(), other, 0, lp_id), sk), "LP opt-in receiver mismatch")
    assert dev.balance(other, lp_id) == 0
    lp._run(lp.claim_group(addr, sk, asset_id, lp_id))  # the honest claim still works, once
    lp.refused(lambda: lp._run(lp.claim_group(addr, sk, asset_id, lp_id)), "Creator LP already claimed")


def test_vestige_access_is_for_the_launcher_and_only_once(lp, user, dev, proto):
    sk, addr = user
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    lp.finish(addr, sk, asset_id, grant_vestige=0)
    osk, other = stranger(dev, proto)
    lp.refused(lambda: lp._run(lp.vestige_group(other, osk, asset_id)), "Only launcher may grant access")
    lp._run(lp.vestige_group(addr, sk, asset_id))
    lp.refused(lambda: lp._run(lp.vestige_group(addr, sk, asset_id)), "Vestige already granted")


# -- forged funding and group tricks ----------------------------------------------------------------------------------------------------
def test_forged_funding_and_extra_transactions_are_refused_at_start(lp, user, dev, proto):
    sk, addr = user
    osk, other = stranger(dev, proto)
    contract_balance = dev.balance(lp.address)

    def start(**kw):
        return lambda: lp._run(lp.start_group(addr, sk, "Canary", "CNRY", TOTAL, **kw))

    lp.refused(start(funding_receiver=other), "Wrong funding receiver")  # the money goes to the attacker, not the contract
    lp.refused(start(funding_payer=(osk, other)), "Funding sender mismatch")  # someone else's payment used for your call
    # A funding payment that also closes the payer's account out to the attacker, or rekeys it to them. Algorand stops both before the contract's
    # own check can run (an account holding assets cannot be closed, an ALGO-only one is emptied so the app call can no longer pay its fee, and a
    # rekeyed account's next transaction is no longer accepted with the old key), so the contract's "No close remainder" and "No funding rekey"
    # assertions are second locks. What matters is that each attempt fails and leaves nothing behind.
    csk, caller = stranger(dev, proto, pnet=False)
    for payer in ((csk, caller), (sk, addr)):
        for forged in ({"funding_close_to": other}, {"funding_rekey_to": other}):
            with pytest.raises(TxFailed):
                lp._run(lp.start_group(payer[1], payer[0], "Canary", "CNRY", TOTAL, **forged))
            assert dev.box(lp.app_id, pending_box(payer[1])) is None, "no launch was recorded"
    assert dev.balance(lp.address) == contract_balance, "the contract received nothing from the failed attempts"
    lp.refused(start(call_rekey_to=other), "No app-call rekey")

    def with_extra_transaction():
        atc = lp.start_group(addr, sk, "Canary", "CNRY", TOTAL)
        lp._composer_call(atc, "budget()void", addr, sk, [], MIN_FEE, [])
        return lp._run(atc)

    lp.refused(with_extra_transaction, "Start requires funding and app call")
    assert lp.start(addr, sk, total_raw=TOTAL)  # none of the attempts left anything behind: the honest start works


# -- there is no admin back door ---------------------------------------------------------------------------------------------------------
def test_the_contract_cannot_be_updated_deleted_opted_into_or_rekeyed(lp, user, dev, proto):
    from lp import _load_programs

    sk, addr = user
    before = dev.algod.application_info(lp.app_id)["params"]
    approval, clear = _load_programs(dev)
    attempts = [
        ("update by the creator", [tx.ApplicationUpdateTxn(lp.admin, dev.params(), lp.app_id, approval, clear)], lp.admin_sk),
        ("delete by the creator", [tx.ApplicationDeleteTxn(lp.admin, dev.params(), lp.app_id)], lp.admin_sk),
        ("update by anyone", [tx.ApplicationUpdateTxn(addr, dev.params(), lp.app_id, approval, clear)], sk),
        ("delete by anyone", [tx.ApplicationDeleteTxn(addr, dev.params(), lp.app_id)], sk),
        ("opt in", [tx.ApplicationOptInTxn(addr, dev.params(), lp.app_id)], sk),
    ]
    for label, txns, signer in attempts:
        with pytest.raises(Exception):
            dev.send(txns, [signer])
        after = dev.algod.application_info(lp.app_id)["params"]
        assert after["approval-program"] == before["approval-program"], f"{label} changed the program"
    account = dev.algod.account_info(lp.address)
    assert "auth-addr" not in account, "the contract's account was rekeyed"
    asset_id = lp.start(addr, sk, total_raw=TOTAL)  # still fully working
    lp.finish(addr, sk, asset_id)


# -- griefing and manipulation -----------------------------------------------------------------------------------------------------------
def test_donations_cannot_break_or_be_drained_from_a_launch(lp, user, dev, proto):
    """Anyone can send PNET or ALGO to the contract. It must neither break a launch nor ever pay the donation out to anybody."""
    sk, addr = user
    osk, other = stranger(dev, proto)
    asset_id = lp.start(addr, sk, total_raw=TOTAL)
    dev.transfer(osk, other, lp.address, proto.pnet, 5_000)
    dev.send([tx.PaymentTxn(other, dev.params(), lp.address, 1_000_000)], [osk])
    lp.finish(addr, sk, asset_id)
    assert dev.balance(lp.address, proto.pnet) == 5_000, "the donated PNET just sits there; the launch used only its own"
    assert lp.global_state().get("reserved", 0) == 0


def test_moving_the_source_pool_price_cannot_cheat_a_launcher_who_set_a_floor(dev, platform):
    """A hostile swap that worsens the PNET price between a launcher's quote and their start is refused by the launcher's own minimum."""
    own = Protocol.deploy(dev)  # its own source pool, so the shared one used by other tests is never moved
    contract = Launchpad.deploy(own, cancel_delay=40, platform=platform)
    state = own.tm.pool_state(own.pnet, ALGO)
    r_pnet, r_algo, fee = int(state["asset_1_reserves"]), int(state["asset_2_reserves"]), int(state["total_fee_share"])
    swap_in = 1_000_000 - (1_000_000 * fee) // 10_000
    expected = r_pnet - (r_pnet * r_algo) // (r_algo + swap_in) - 1
    floor = expected * 995 // 1000  # the launcher accepts at most half a percent worse than the quote

    first_sk, first = dev.new_account()
    own.fund_user_pnet(first, first_sk)
    contract.start(first, first_sk, total_raw=TOTAL, minimum_pnet=floor)  # before the attack the quote is honoured

    osk, attacker = dev.new_account()
    own.fund_user_pnet(attacker, osk, amount=1)
    own.tm.swap_fixed_input(osk, attacker, ALGO, own.pnet, 10_000_000)  # buys PNET with 10 ALGO: PNET gets dearer for the next launcher

    second_sk, second = dev.new_account()
    own.fund_user_pnet(second, second_sk)
    contract.refused(lambda: contract.start(second, second_sk, total_raw=TOTAL, minimum_pnet=floor), "Quoted output is no longer available")
    assert contract.start(second, second_sk, total_raw=TOTAL, minimum_pnet=floor * 8 // 10), "a freshly re-quoted launch still goes through"
