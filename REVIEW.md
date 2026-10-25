# Review guide: PNET Instant Launchpad v3

This is the brief for an independent security review of the smart contract in `contracts/launchpad_v3/contract.py` (about 740 lines of Algorand Python / PuyaPy,
compiled to AVM 11 TEAL) and, secondarily, the transaction builders that talk to it. **The contract cannot be changed once deployed** (no update, no delete): a finding
means a new application, so please be demanding.

## 1. What it does, in one paragraph

A launcher pays the contract. In one call the contract creates an immutable six-decimal ASA with the whole supply, buys PNET with exactly 1 ALGO through one pinned Tinyman v2 pool,
and stores a "pending launch". In a second atomic group (Tinyman pool bootstrap if the pool is missing, then funding, then one call) the contract seeds the Tinyman v2 pool for
(new ASA, PNET) with 100% of the supply plus the bought PNET, sends 80% of the LP tokens to the ARC-54 burn address, records 10% as claimable by the launcher and 10% as a
platform allocation, and optionally gives the launcher Vestige metadata access. If a launch cannot finish, the launcher can cancel after a fixed delay and gets half of the ASA and
half of the PNET back (the other half belongs to the platform wallet).

## 2. The deployed instance

| | |
|---|---|
| Network | Algorand MainNet |
| Application | **3753531793**, address `KPKA4OF4BREWGLS4RR2EK3PZUN6FVSVRKJ3RQRR5VHWF5CMAGY7QP3SK6A` |
| Creator (the platform authority) | `CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E` |
| Created / initialized | round 66302908 (`YCCXRFM63YPWOGHIWPHW4QZALEIQQKR5HGMNFP6EM7TKTMSYBDKQ`) / round 66302925 (`RRYFILGNTA7Y6VHEGCQ6QTQHEFDUK7VTFX5KUZHW3DOB24QJNL2Q`) |
| Approval program SHA-256 | `23fc93380267d6421d21d00ca4d6203eab6d8d4086983b6ba4e28554121ae500` |
| Clear program SHA-256 | `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7` (`#pragma version 11`, `return 1`) |
| Source SHA-256 (`contract.py`) | `3e7d24037407b16fb44904704db8311faa264a0038b362b45e53564461f58bcb` |
| Compiler | puyapy 5.10.1 (deterministic; see `contracts/launchpad_v3/build-manifest.json`) |
| Schema | 9 global uints, 2 global byte slices, no local state, 2 extra program pages, box storage |
| Pinned dependencies (enforced in bytecode on MainNet) | PNET asset 3169177585, Tinyman v2 validator 1002541853, ARC-54 1257620981, Vestige 3129810607, PNET/ALGO source pool `ANESQRCMZ5KWZFKDGESLJEWQLRCVUZU725FJL7NO3BMKJEYMAB3TR56R3E`, cancel delay 3,000 rounds |
| One real launch so far | ASA 3753533790, pool `7VGZHV5AYKQSP34R2R5QM2M32VCTXJ6VXXPCWCOPOPKI744X4YRPPOIQWQ`, LP asset 3753533886 (the creator-LP claim also ran). The **cancel path has not been run on MainNet yet** |

## 3. Scope

**In scope (please focus here):** `contracts/launchpad_v3/contract.py`, and how it uses Tinyman v2, ARC-54 and Vestige.

**Secondary:** the group builders `src/launchpad/launchpadClient.js`, `src/launchpad/tinymanAdapter.js`, the unsigned deployment tooling `contracts/launchpad_v3/deploy.py`,
and the build and hosting pipeline (`.github/workflows/pages.yml`, `docs/CLOUDFLARE_SETUP.md`).

**Out of scope:** Tinyman, ARC-54, Vestige and Pera Wallet themselves (we only rely on them); the legacy contract 3609729732; `contracts/launchpad_v2/` (an earlier version kept only as a
reference, see section 9).

## 4. Roles, state and methods

**Roles.** *Launcher*: any account. *Platform authority*: the hardcoded address above; it created the app, funded it, and is the only account that may call the two `release_*`
methods. It cannot move a launcher's escrow; it can only collect allocations the contract recorded for it (section 5).

**Global state:** `burn`, `source`, `pnet`, `tinyman`, `vestige`, `arc54`, `delay` (set once in `create`), `total` (launch count), `init`, and two accounting counters,
`reserved` (PNET escrowed for pending launches) and `platpnet` (PNET owed to the platform after a cancel). **Boxes:** `p`+launcher (pending launch), `l`+asset id (launch record),
`i`+index (directory), `a`+asset id (platform allocation). Every box deposit is prepaid by the launcher.

| Method | Caller | Effect |
|---|---|---|
| `create(...)` | platform | Stores the pinned configuration. On MainNet (genesis hash check) every value must equal the pinned constants |
| `initialize(pay)` | platform | One time: app opts into PNET (inner txn) and receives 0.5 ALGO (0.1 account base, 0.1 PNET holding, 0.3 cushion) |
| `launch_start(pay, name, unit, total, url, quote_round, min_pnet)` | launcher | Creates the ASA (all roles empty), swaps exactly 1 ALGO into PNET at the source pool with a price-impact cap (5%) and a minimum-output floor, writes the pending box |
| `launch_finish(pay, asset_id, pool, grant_vestige)` | the same launcher | Requires the **canonical** Tinyman pool for (asset, PNET) (account address recomputed from the pool LogicSig template), seeds it, burns 80% of the LP at ARC-54, records creator and platform shares, optionally calls Vestige, refunds the pending-box deposit, writes the launch record and directory entry, deletes the pending box |
| `claim_creator_lp(axfer, asset_id)` | the launcher | Pays the recorded creator LP once (the zero-amount LP opt-in is the previous transaction) |
| `cancel_launch(asset_id)` | the launcher | After `delay` rounds from the swap: half of ASA and PNET to the launcher, half of PNET to the platform wallet (or deferred if it is not opted in), half of the ASA recorded as a platform allocation |
| `release_cancelled_pnet(asset_id)` / `release_platform_allocation(asset_id, receiver, amount)` | platform | Pay out deferred PNET / a recorded allocation, never more than recorded |
| `grant_vestige_access(pay, asset_id)` | the launcher | Retry of the Vestige step for a finished launch |
| `budget()` | anyone | No-op that only adds opcode budget and carries shared references |
| `get_*` | anyone | Read-only getters |

Transaction arguments (`pay`, `axfer`) follow ARC-4: they are the transaction immediately before the call. **Version 2 of this contract broke exactly here** (section 9), so please check every
group-position assumption.

## 5. Properties we believe hold (please try to break them)

1. **Only the launcher's own funds move at launch.** `launch_start` costs the launcher exactly `LAUNCH_START_FUNDING` (1.3596 ALGO: the 1 ALGO swap plus prepaid deposits); a complete launch leaves the
   app's free balance exactly unchanged (the 0.3 ALGO cushion); a cancelled launch likewise. (Tests assert the exact balance.)
2. **The supply never leaves the contract except into the canonical Tinyman pool, back to the launcher or platform on cancel, or to the burn address as LP.** The ASA's manager, reserve, freeze and
   clawback are empty at creation, so it is immutable.
3. **A launch can be finished only by the wallet that started it, only once, and only with the canonical pool** for its own (asset, PNET) pair and an empty pool (`issued == 0`).
4. **LP conservation:** `burned + creator + platform == received`, where `received == issued - 1000` (Tinyman locks 1000), and `burned = 80%` computed without overflow.
5. **Platform power is bounded.** `release_platform_allocation` can pay at most `remaining` of a recorded allocation; `release_cancelled_pnet` at most the recorded deferred amount.
   Neither can reach another launch's escrow. `reserved_pnet + platform_pnet` is checked against the app's PNET balance on cancel.
6. **A pending launch can always be cancelled by its launcher after `delay` rounds** provided the launcher opts into the ASA and PNET (the builder puts those opt-ins in the same group).
7. **Price protection on the swap:** the call fails if the pool's price impact exceeds 5%, if the output is below the launcher's `min_pnet`, or below a fresh 1% floor computed from current reserves.

## 6. Trust assumptions

* **Tinyman v2** behaves as documented: pool local state keys (`asset_1_id`, `asset_2_id`, `pool_token_asset_id`, `issued_pool_tokens`, reserves, `total_fee_share`), `swap` (fixed-input) and `add_initial_liquidity`.
* **ARC-54** really makes the LP tokens unrecoverable at its address, and accepts `arc54_optIntoASA`.
* **Vestige** `add_asset_metadata_manager` only grants metadata rights.
* **Pinned PNET/ALGO source pool** has enough depth that 1 ALGO stays under the 5% impact cap; if it drains, launches fail safe (refused), not unsafe.
* **The platform wallet** is held securely and stays opted into PNET (otherwise its cancel share is deferred, not lost).

## 7. Where we would look hardest

1. Group-position and txn-type checks in `launch_finish`, `claim_creator_lp`, `launch_start` (every `group_index`, receiver, amount, `close_remainder_to`, `rekey_to`). The group size is **not** fixed in `launch_finish`; is that safe?
2. `launch_finish`: ordering of inner transactions, the ARC-54 funding branch (`burn_holds_lp`), the exact-funding equality, and what happens if Tinyman state changes between simulation and execution.
3. The canonical-pool check: `sha512_256("Program" + prefix + validator_id + asset_1 + asset_2 + suffix)` against Tinyman's v2 pool LogicSig template (constants `POOL_LOGICSIG_PREFIX`/`SUFFIX` come from tinyman-js-sdk 5.1.4). Is the template and the byte layout right? (`test/tinymanAdapter.test.js` checks two real MainNet pool addresses.)
4. Arithmetic: `mulw`/`divw` in the quote, the 80/10/10 split rounding, the 5% and 1% bounds; any path where an `UInt64` can overflow or a division can round in the launcher's disfavour.
5. Box accounting: constants `PENDING_BOX_MBR`, `LAUNCH_RECORD_MBR`, `LAUNCH_INDEX_MBR`, `PLATFORM_ALLOCATION_MBR` must equal the real minimum-balance cost of each box (tests confirm exactness for the current struct sizes).
6. Griefing: someone bootstrapping the launch's pool first (handled: the builder omits its own bootstrap), someone front-running `launch_finish`, or making Tinyman state unusable. The launch token exists only inside the app, so nobody else can add liquidity before it, but please check that claim.
7. `cancel_launch` when the platform wallet is not opted in, when PNET was donated to the app, and the `reserved`/`platpnet` bookkeeping.
8. Rounding and dust in `release_*`; whether any allocation can be released twice.

## 8. Known limitations (we know about these)

* **No content rules on names.** `launch_start` checks only lengths (name ≤ 32, unit ≤ 8, URL ≤ 96 bytes), not character sets. Anyone can launch a token called "USDC". The website shows the contract's data; there is no moderation.
* **One source pool.** PNET is bought from one pinned pool. Thin liquidity makes launches fail (refused, no loss).
* **Sandwiching** of the 1 ALGO swap is possible within the 1% slippage floor (about 0.01 ALGO).
* **Locked deposits:** the 0.5 ALGO funding of the app and the 0.6565 ALGO app minimum balance can never be withdrawn.
* **Platform shares are trusted:** the platform decides when to collect them and to whom to send them (but only what was recorded).
* **Vestige funding (0.1 ALGO) goes to Vestige's account** and is not refundable by us.
* **The cancel path is untested on MainNet** (tested on a private devnet). One cancel on MainNet is planned before opening to the public.
* **Hosting:** GitHub Pages plus Cloudflare headers (not a hardened server). A compromised GitHub, domain or Cloudflare account could serve a malicious page; the page checks the contract's bytecode hash before signing.

## 9. History: why version 3 exists

Version 2 (application 3753482671, **do not use**) was deployed on 2026-10-24 and found unusable during its first launch: its `finalize_launch` required its transaction arguments at group
positions that ARC-4 routing and its own assertions placed in contradiction (no group could satisfy both), and its ASA fields kept the 2-byte ARC-4 length header (names with junk bytes).
Neither had been caught because the contract had never been run end to end. Version 3 was written together with an end-to-end test suite that runs against **unchanged copies of the
real MainNet Tinyman v2, ARC-54 and Vestige programs** on a private devnet, and the launch flow was reduced from five wallet approvals to two.

## 10. Reproduce everything

Toolchain (pinned in `contracts/requirements.txt`): Python 3.12, puyapy 5.10.1, py-algorand-sdk 2.12.0, pytest; Node 22 for the JavaScript tests.

```bash
cd contracts
python -m venv .venv-v2 && .venv-v2/bin/pip install -r requirements.txt   # Windows: .venv-v2\Scripts\...
.venv-v2/bin/python launchpad_v3/compile.py                                 # must leave launchpad_v3/build-manifest.json unchanged
```

Confirm the chain runs the reviewed bytecode (read-only; or the SHA-256 of `approval-program` from any algod/indexer):

```bash
npm ci && npm run verify:deployed      # OK  app 3753531793 matches the reviewed build
```

Run the tests on a private devnet (needs `goal`/`algod` on Linux or WSL; the script creates an isolated network under `$HOME/launchpad-devnet`, never touching other nodes):

```bash
bash contracts/tests/devnet/start.sh            # writes contracts/tests/devnet.local.json (git-ignored, throwaway keys)
cd contracts && .venv-v2/bin/python -m pytest tests     # 24 tests
.venv-v2/bin/python tests/js_fixture.py && cd .. && node --test test/devnetFlow.test.js   # the app's exact groups, signed and submitted
bash contracts/tests/devnet/stop.sh
```

`contracts/tests/fetch_fixtures.py` re-downloads the real Tinyman/ARC-54/Vestige programs from MainNet (read-only) into `contracts/tests/fixtures`. The tests deploy them unchanged, and replace the
pinned platform address in the compiled TEAL with a test wallet (the shipped artifact is never modified).

What the tests cover: a complete launch with exact accounting, claim, Vestige on/off and retry, a pre-bootstrapped pool, ARC-54 already opted in, two launches in a row, cancel before and after the
delay with and without the platform opted in, release flows, and 27 refusals each asserted against the contract's own assertion text. What they do not cover: adversarial fuzzing,
formal verification, or MainNet conditions such as a live price race.

## 11. Reporting

Please send findings with: severity, the method and line, a concrete failing scenario (ideally as a pytest case using `contracts/tests/lp.py`), and a suggested fix.
Findings that change the contract mean a new deployment; we will not deploy again until the review is complete.
