# PNET LaunchLab (standalone)

LaunchLab as its own app: one asset, one Tinyman v2 pool, verifiable liquidity, **two wallet approvals**. Your Pera wallet funds an immutable six-decimal ASA and
exactly one ALGO of PNET; the **PNET Instant Launchpad v3** contract pools the whole supply plus the measured PNET, sends 80% of the LP to ARC-54 (burn), records 10%
for you to claim and keeps 10% as a tracked platform allocation.

1. **Approval 1** creates your token and buys the PNET (one application call).
2. **Approval 2** creates the Tinyman pool, adds the liquidity, splits the LP and grants Vestige access, in one atomic group.

Each approval is simulated on chain before Pera opens, so a launch that could not complete is refused before you sign. Your 10% of the LP is claimed later with one more
approval, only if you want to withdraw liquidity. A launch that cannot finish can be cancelled after 3,000 rounds (about 2.3 hours) in one approval.

It was split out of the Profitnet app (`rebuild/apps/evidence-agent`, route `launchlab`). There is no backend and no stored secret: the browser prepares the
transaction groups, simulates them, and Pera signs each one. The app never sees a mnemonic or a private key.

## Run it

```powershell
npm install        # first time only
npm run dev        # http://127.0.0.1:5180   (or double-click Start-PnetLauncher.cmd)
npm test           # node tests (incl. the devnet flow when its fixture exists) + page tests
npm run build      # dist/
```

Contract tests (private devnet, never MainNet) are described in `contracts/launchpad_v3/README.md`.

## Why it says "Signing disabled" until you configure it

The page refuses to build a launch until it knows three on-chain facts, and it is right to refuse: they do not exist until the contract is deployed.

| Setting | What it is | Where it comes from |
|---|---|---|
| `VITE_LAUNCHPAD_APP_ID` | the deployed launchpad application | the deployment below (any network) |
| `VITE_LAUNCHPAD_PNET_ID` | the six-decimal PNET asset | **TestNet:** a test asset you create. **MainNet:** pinned in the app (`3169177585`), nothing to set |
| `VITE_TINYMAN_SOURCE_POOL` | the Tinyman v2 ALGO/PNET pool it buys PNET from | **TestNet:** a pool you bootstrap. **MainNet:** pinned in the app, nothing to set |

On MainNet the only missing value is the application ID, plus the controlled-canary gate (`VITE_ENABLE_MAINNET_LAUNCHPAD`). Copy `.env.example` to `.env.local`,
fill the values in, restart `npm run dev`. The app refuses the legacy launchpad (3609729732) and the unfinishable v2 launchpad (3753482671).

## Deploying the contract (the step that needs your wallet)

`contracts/launchpad_v3/` holds the reviewed source, the compiled artifacts and `deploy.py`. The contract can only be created and initialized by the hardcoded
platform authority account `CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E`; `deploy.py` refuses any other deployer and the verifier checks the on-chain
creator. `deploy.py` never signs and never submits: it writes an unsigned package that you sign in Pera or on a Ledger. See `docs/MAINNET_DEPLOY_RUNBOOK.md`.

## What is where

- `src/pages/LaunchLabPage.jsx` the page; `src/launchpad/` quotes, transaction groups, simulation, session recovery, attestation, Tinyman helpers, trusted build hashes
- `src/hooks/` Pera wallet and Algorand client
- `contracts/launchpad_v3/` contract source, ARC-56, TEAL, build manifest, deployment tooling (Python, PuyaPy 5.10.1 in `contracts/.venv-v2`)
- `contracts/tests/` end-to-end tests against unchanged copies of the real MainNet Tinyman v2, ARC-54 and Vestige programs on a private devnet
- `contracts/launchpad_v2/` the earlier contract, kept only as an audit reference. It can never finish a launch; do not deploy or use it
- `docs/` readiness notes and checklists inherited from the original project (parts describe v2), and the MainNet deployment runbook for v3
- `test/` node tests (amounts, quotes, sessions, simulation, Tinyman helpers, deployment-package validation, builders, devnet flow)
