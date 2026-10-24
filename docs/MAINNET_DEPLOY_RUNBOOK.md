# MainNet deployment runbook: PNET Instant Launchpad v2

Authority account (the only account the contract and `deploy.py` accept): `CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E`.
Nothing here signs for you: `deploy.py` only writes unsigned packages, and Pera or a Ledger signs them in the app's console. Re-run
`npm run preflight:mainnet` after every step; it reads the chain and tells you the next action.

## What it costs (all paid by the authority account; spendable ALGO needed in total: 1.933)

| Step | Cost | Where it goes |
|---|---|---|
| Opt in to PNET | 0.100 + 0.001 fee | the PNET holding's minimum balance (stays in the account) |
| Create the app | 0.628 + 0.001 fee | the account's minimum balance for 8 uints, 2 byte slices, 2 extra pages. The contract has no delete route, so this is locked for good |
| Initialize (pay the app) | 1.200 + 0.003 fees | goes INTO the contract (its minimum balance plus a 1 ALGO safety cushion). There is no withdrawal route |

The account currently has 0 spendable ALGO. Send it at least 1.933 ALGO (2.5 leaves a fee buffer). About 1.83 ALGO of that is committed to the contract permanently.

## Steps, in order

1. **Fund the authority.** Send 2.5 ALGO to `CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E` from any wallet. Check: `npm run preflight:mainnet`.
2. **Opt the authority in to PNET (you sign, in Pera).** With the CIVTUU account selected: Add asset, `3169177585` (PNET), confirm. Check: preflight shows `✔ opted in`.
3. **Prepare the create package (read-only, no signing):**
   ```powershell
   cd C:\Users\rober\OneDrive\Desktop\pnetlauncher\contracts
   $env:PYTHONPATH = (Get-Location).Path
   $env:ALLOW_LAUNCHPAD_V2_DEPLOY = 'MAINNET'
   $env:CONFIRM_NEW_MAINNET_APP = '3609729732-REMAINS-UNTOUCHED'
   .\.venv\Scripts\python.exe -m launchpad_v2.deploy prepare-create mainnet CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E
   ```
   It writes `contracts\launchpad_v2\deployment-mainnet-create.unsigned.local.json`.
4. **Sign the create (you sign, in the app's console).** Put these two lines in `.env.local`, then `npm run dev`:
   ```
   VITE_NETWORK=mainnet
   VITE_SHOW_DEPLOYMENT_CONSOLE=LOCAL_ONLY
   ```
   Open http://127.0.0.1:5180, press Connect Pera and pick the CIVTUU account. In the "Pera / Ledger unsigned package console" choose the create package, check the
   authority matches, press "Simulate, inspect in Pera, and sign" and approve ONE transaction in Pera. The console prints the new **App ID**.
5. **Prepare the initialize package** (replace APP_ID; same two variables as step 3):
   ```powershell
   .\.venv\Scripts\python.exe -m launchpad_v2.deploy prepare-initialize mainnet CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E APP_ID
   ```
6. **Sign the initialize (you sign, same console).** Load `deployment-mainnet-initialize.unsigned.local.json` and sign: two transactions in one group (the 1.2 ALGO payment to the app, then the call).
7. **Verify on chain (read-only):**
   ```powershell
   .\.venv\Scripts\python.exe -m launchpad_v2.deploy verify-record mainnet APP_ID CREATE_TXID INITIALIZE_TXID
   ```
   It checks the on-chain programs against the reviewed artifacts, the schema, the pinned configuration and the cushion, then writes `deployment-mainnet.local.json`.
8. **Switch the app on.** Replace `.env.local` with:
   ```
   VITE_NETWORK=mainnet
   VITE_LAUNCHPAD_V2_APP_ID=APP_ID
   VITE_ENABLE_MAINNET_LAUNCHPAD=I_ACCEPT_CONTROLLED_MAINNET_CANARY
   ```
   (no deployment-console line) and restart `npm run dev`. The "Signing disabled" warning is gone. Make the first launch a small canary.

## Before you do it

The readiness notes in this folder list the gates the contract's authors set: a funded TestNet success run, a TestNet timed-cancellation run, a trace review and an independent
security review. None of them is recorded as done, and launches hold other people's funds (the ASA supply and 1 ALGO of PNET) until completion. Going straight to MainNet skips those gates.
