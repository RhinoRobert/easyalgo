# PNET LaunchLab (standalone)

LaunchLab as its own app: one asset, one Tinyman v2 pool, verifiable liquidity. Your Pera wallet funds an immutable six-decimal ASA and exactly one ALGO of PNET;
the **PNET Instant Launchpad v2** contract pools the whole supply plus the measured PNET, sends 80% of the LP to ARC-54 (burn), 10% to you and keeps 10% as a
tracked platform allocation.

It was split out of the Profitnet app (`rebuild/apps/evidence-agent`, route `launchlab`). There is no backend and no stored secret: the browser prepares the
transaction groups, simulates them, and Pera signs each one. The app never sees a mnemonic or a private key.

## Run it

```powershell
npm install        # first time only
npm run dev        # http://127.0.0.1:5180   (or double-click Start-PnetLauncher.cmd)
npm test           # 21 node tests + 2 page tests
npm run build      # dist/
```

## Why it says "Signing disabled" until you configure it

The page refuses to build a launch until it knows three on-chain facts, and it is right to refuse: they do not exist until the contract is deployed.

| Setting | What it is | Where it comes from |
|---|---|---|
| `VITE_LAUNCHPAD_V2_APP_ID` | the deployed launchpad application | the deployment below (any network) |
| `VITE_LAUNCHPAD_V2_PNET_ID` | the six-decimal PNET asset | **TestNet:** a test asset you create. **MainNet:** pinned in the app (`3169177585`), nothing to set |
| `VITE_TINYMAN_SOURCE_POOL` | the Tinyman v2 ALGO/PNET pool it buys PNET from | **TestNet:** a pool you bootstrap. **MainNet:** pinned in the app, nothing to set |

On MainNet the only missing value is the application ID, plus the controlled-canary gate (`VITE_ENABLE_MAINNET_LAUNCHPAD`). Copy `.env.example` to `.env.local`,
fill the values in, restart `npm run dev`.

## Deploying the contract (the step that needs your wallet)

`contracts/launchpad_v2/` holds the reviewed source, the compiled artifacts and `deploy.py`. The contract can only be created and initialized by the hardcoded
platform authority account `CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E`; `deploy.py` refuses any other deployer and the verifier checks the on-chain
creator. `deploy.py` never signs and never submits: it writes an unsigned package that you sign in Pera or on a Ledger. See
`contracts/launchpad_v2/README.md` and `docs/MAINNET_ROLLOUT_CHECKLIST.md`. The reviewed order is TestNet first (success path, then timed cancellation), an
independent review, then one small MainNet canary.

## What is where

- `src/pages/LaunchLabPage.jsx` the page; `src/launchpad/` quotes, transaction groups, simulation, session recovery, attestation, Tinyman adapter, trusted build hashes
- `src/hooks/` Pera wallet and Algorand client; `src/shims/nodeCrypto.js` the one Node primitive Tinyman needs, as noble SHA-256
- `contracts/launchpad_v2/` contract source, ARC-56, TEAL, typed client, deployment tooling (Python, AlgoKit/PuyaPy)
- `docs/` readiness notes, review checkpoint and the MainNet rollout checklist, kept from the original project for provenance
- `test/` node tests carried over from the original project (amounts, quotes, sessions, simulation, Tinyman adapter, deployment-package validation)

Provenance: the code is the LaunchLab integration from Profitnet (adapted from the `AlgoFlow-PNET-Launchpad-Lab` prototype); the contract artifacts are byte-identical to
the original project's (approval TEAL sha256 `65d5f737…`). The docs there are readiness references, not proof of a deployment or an independent review.
