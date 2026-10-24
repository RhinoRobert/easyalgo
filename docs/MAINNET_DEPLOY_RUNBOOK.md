# MainNet deployment runbook: PNET Instant Launchpad v3

Authority account (the only account the contract and `deploy.py` accept): `CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E`.
Nothing here signs for you: `deploy.py` only writes unsigned packages, and Pera or a Ledger signs them in the app's console. Re-run
`npm run preflight:mainnet` after every step; it reads the chain and tells you the next action.

App 3753482671 is the earlier **v2** contract. It can never finish a launch (its finalize step is self-contradictory and its ASA names carry two junk bytes), and
the app and `deploy.py` both refuse it. v3 is a new application; v2's ~1.8 ALGO of locked deposits is not recoverable.

## What v3 costs the authority account

| Step | Cost | Where it goes |
|---|---|---|
| Create the app | 0.6565 + 0.001 fee | the account's minimum balance for 9 uints, 2 byte slices, 2 extra pages. No delete route: locked for good |
| Initialize (pay the app) | 0.500 + 0.003 fees | INTO the contract: its PNET holding minimum balance plus a 0.3 ALGO cushion. No withdrawal route |

About 1.16 ALGO in total, about 1.16 of it committed to the contract permanently. (PNET opt-in already exists on the authority account.)

## Before this runbook: the gates that were run

* `contracts/tests` (pytest): 24 end-to-end tests on a private devnet against unchanged copies of the real MainNet Tinyman v2, ARC-54 and Vestige programs.
* `test/devnetFlow.test.js`: the exact groups the UI builds are simulated, signed and submitted on the same devnet (full launch, claim, Vestige retry, cancel).
* `contracts/tests/test_frontend_parity.py`: the pinned hashes and money constants in the app equal the compiled contract's.

## Steps, in order

1. **Check readiness (read-only):** `npm run preflight:mainnet`. It must report the pinned dependencies and the source pool as ready, and enough spendable ALGO.
2. **Prepare the create package (read-only, no signing):**
   ```powershell
   cd C:\Users\rober\OneDrive\Desktop\pnetlauncher\contracts
   $env:PYTHONPATH = (Get-Location).Path
   $env:ALLOW_LAUNCHPAD_V3_DEPLOY = 'MAINNET'
   $env:CONFIRM_NEW_MAINNET_APP = '3609729732-REMAINS-UNTOUCHED'
   .\.venv\Scripts\python.exe -m launchpad_v3.deploy prepare-create mainnet CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E
   ```
   It writes `contracts\launchpad_v3\deployment-mainnet-create.unsigned.local.json` (valid for about 45 minutes).
3. **Sign the create (you sign, in the app's console).** Put these two lines in `.env.local`, then `npm run dev`:
   ```
   VITE_NETWORK=mainnet
   VITE_SHOW_DEPLOYMENT_CONSOLE=LOCAL_ONLY
   ```
   Open http://127.0.0.1:5180, connect Pera as the CIVTUU account, choose the create package in the console, press "Simulate, inspect in Pera, and sign" and approve ONE transaction.
   The console prints the new **App ID**.
4. **Prepare the initialize package** (replace APP_ID; same variables as step 2):
   ```powershell
   .\.venv\Scripts\python.exe -m launchpad_v3.deploy prepare-initialize mainnet CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E APP_ID
   ```
5. **Sign the initialize (you sign, same console).** Two transactions in one group: the 0.5 ALGO payment to the app, then the call.
6. **Verify on chain (read-only):**
   ```powershell
   .\.venv\Scripts\python.exe -m launchpad_v3.deploy verify-record mainnet APP_ID CREATE_TXID INITIALIZE_TXID
   ```
   It checks the on-chain programs against the reviewed artifacts, the schema, the pinned configuration (including the 3,000-round cancel delay) and the cushion, then writes `deployment-mainnet.local.json`.
7. **Switch the app on.** Replace `.env.local` with:
   ```
   VITE_NETWORK=mainnet
   VITE_LAUNCHPAD_APP_ID=APP_ID
   VITE_ENABLE_MAINNET_LAUNCHPAD=I_ACCEPT_CONTROLLED_MAINNET_CANARY
   ```
   (no deployment-console line) and restart `npm run dev`. Make the first launch a small canary: two Pera approvals.

## Recovering the earlier v2 canary

App 3753482671 still holds the canary's escrow (ASA 3753489997 and 20,526.259976 PNET). Its timed cancellation opens at round 66321647 and needs one signed call from the launcher wallet; see the v2 notes in `contracts/launchpad_v2`. It is not part of v3.