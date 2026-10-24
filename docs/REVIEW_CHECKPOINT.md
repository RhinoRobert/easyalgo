# PNET Instant Launchpad v2 — human review checkpoint

Checkpoint date: 2026-10-04

This is an isolated successor workspace copied from `D:\Web3\conservation-fund`.
It has no Git remote, has not deployed an Algorand application, and does not
modify the production checkout or MainNet App ID `3609729732`.

## Saved checkpoints

- `edbe035` — rebuild launchpad v2 around Tinyman custody.
- `eecf3c0` — replace mnemonic deployment with unsigned Pera/Ledger packages.
- `cb35f83` — complete the Tinyman launch wizard and harden finalization.

## What is implemented

- Immutable app-created six-decimal ASA with full supply kept in app custody.
- Exact one-ALGO Tinyman v2 PNET purchase using a pinned, chain-verified source
  pool and app-measured output.
- Separate deterministic Tinyman bootstrap, then atomic full-supply liquidity,
  exact reserve verification, ARC-54 burn, and 80/10/10 LP distribution.
- ARC-54 pre-opt-in grief resistance and exact conditional MBR funding.
- 20,000-round cancellation with split refunds and bounded platform allocation.
- Hardcoded platform authority, box-backed directory, and retryable post-launch
  Vestige authorization.
- Resumable Pera launch wizard with pre-sign simulation and chain-authoritative
  recovery instead of trusting local storage.
- Local-only unsigned Pera/Ledger deployment console and post-confirmation
  on-chain manifest verification. No mnemonic or private key input exists.

## Verified locally

- 33 focused contract/artifact tests pass.
- 20 frontend Node tests pass.
- PuyaPy 5.10.1 compilation succeeds and artifact hashes are recorded.
- The production Vite build succeeds.
- Production dependency audit has zero high/critical findings.
- Read-only MainNet protocol/source-pool preflight succeeds; nothing was signed
  or submitted.

## Not represented as complete

- No funded TestNet full lifecycle or timed-cancellation lifecycle has run.
- No independent security reviewer has signed off on source, TEAL, or transaction
  composition.
- No v2 App ID exists and no MainNet canary has run.
- Production GitHub/frontend remain unchanged.

Start human review with `contracts/launchpad_v2/contract.py`, then compare the
generated ARC-56/TEAL and `build-manifest.json`. Review
`docs/CONTRACT_DEPLOYMENT_READINESS.md` and
`docs/MAINNET_ROLLOUT_CHECKLIST.md` before preparing any unsigned deployment.
