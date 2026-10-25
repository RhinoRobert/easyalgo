# PNET Instant Launchpad v3

Immutable Tinyman-backed launch escrow. The application is the creator and custody account of every launch it makes; it has no update or delete route.

## The launch (two approvals)

| | Group | What the contract does |
|---|---|---|
| 1 | `[funding payment, launch_start]` | Creates the immutable six-decimal ASA (clean name, unit name and URL), swaps exactly 1 ALGO into PNET through the pinned Tinyman source pool, records the pending launch |
| 2 | `[bootstrap payment, pool bootstrap (Tinyman LogicSig), resource carrier, funding payment, launch_finish]` | Requires the **canonical** Tinyman pool for the pair, seeds it with 100% of the supply and the measured PNET, burns 80% of the LP through ARC-54, records 10% as the launcher's claimable LP and 10% as a platform allocation, optionally grants Vestige access, refunds the pending-record deposit |
| later | `[LP opt-in, claim_creator_lp]` | Pays the launcher's recorded 10% LP, once |
| escape | `[opt-ins, cancel_launch]` | After `cancel_delay` rounds (MainNet: 3,000, pinned in bytecode) returns half the ASA and PNET to the launcher; the other half becomes a platform allocation |

Transaction arguments are the transactions directly before the call (ARC-4); they are never application args. The bootstrap pair is omitted when the pool already exists.
Everything a launch stores is prepaid by the launcher, so the app's free balance is exactly unchanged after a complete launch (tested).

## Build

```powershell
cd contracts
.\.venv-v2\Scripts\python.exe launchpad_v3\compile.py     # puyapy 5.10.1, deterministic; writes artifacts/ and build-manifest.json
```

## Tests (private devnet only)

Needs the Algorand node tools (`goal`, `algod`) on Linux or WSL. The kit creates an isolated network (own data directory under `$HOME/launchpad-devnet`, random local ports, no real network, never touches
another node) and writes the connection details to `contracts/tests/devnet.local.json` (git-ignored, throwaway keys):

```bash
bash contracts/tests/devnet/start.sh
cd contracts && python -m pytest tests                  # 35 tests: happy path, attack attempts, exact accounting, every refusal with its own assertion text, cancel, frontend parity
python tests/js_fixture.py && cd .. && node --test test/devnetFlow.test.js     # the UI's exact groups, simulated, signed and submitted
bash contracts/tests/devnet/stop.sh
```

`tests/fetch_fixtures.py` copies the real MainNet Tinyman v2, ARC-54 and Vestige programs (read-only HTTP) into `tests/fixtures`; the suite deploys them unchanged.
The devnet suite swaps the pinned platform wallet for a test wallet in the compiled TEAL; the real artifact is never modified. See `../../REVIEW.md` for the full review guide.
## Deployment

`deploy.py` (unsigned packages only, never signs): `prepare-create`, `prepare-initialize`, `verify-record`. See `../../docs/MAINNET_DEPLOY_RUNBOOK.md`.
