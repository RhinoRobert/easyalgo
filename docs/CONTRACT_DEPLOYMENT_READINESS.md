# PNET Instant Launchpad v2 — Contract deployment readiness

Updated: 2026-10-04

## Current decision

The implementation is at a reproducible **funded TestNet candidate** checkpoint.
The core contract and browser transaction engine are implemented. MainNet is
still gated on a real TestNet success lifecycle, a real timed-cancellation
lifecycle, trace review, and independent security review. Those are validation
gates, not missing Pact or liquidity methods.

No v2 deployment has been performed. Existing MainNet App ID `3609729732`, the
production checkout, and production GitHub remain untouched.

## Contract invariants

- The app creates immutable six-decimal ASAs and retains the full supply until
  completion or cancellation.
- States are `CREATED -> PNET_ESCROWED -> COMPLETE | CANCELLED`; Vestige status
  is independent and can only be granted after completion.
- The swap input is exactly one ALGO. The contract derives the Tinyman quote
  from live pool state with wide arithmetic, enforces 1% slippage, no more than
  5% price impact, and a ten-round deadline, then measures actual PNET received.
- MainNet protocol IDs and the PNET/ALGO source-pool address are pinned in
  bytecode. App creation also verifies PNET decimals, protocol apps, ARC-54's
  derived address, source pair, and source LP asset presence.
- Finalization rejects the wrong pool, wrong asset ordering, any pre-seeded
  pool, wrong LP ID, incorrect full-supply/PNET reserves, or unexpected LP
  issuance.
- The app sends `floor(received LP * 80 / 100)` to ARC-54, gives the creator
  half the remainder, retains the rounding remainder, and records the retained
  balance in a separately bounded allocation box.
- ARC-54 pre-opt-in cannot grief finalization. If ARC-54 already holds the LP
  ASA the group funds only the launchpad holding; otherwise the contract funds
  ARC-54 and calls its official opt-in method in a nested atomic group.
- Only the hardcoded platform authority can release recorded retained LP or
  canceled-ASA allocations. Pending funds, creator LP, and burned LP are not
  addressable by that method.
- Cancellation is launcher-only after 20,000 rounds and requires the creator's
  ASA and PNET opt-ins. Deployment preflight also requires the hardcoded
  platform wallet to be opted into PNET so cancellation cannot strand funds.
- Clear state always approves because the application has no local state;
  update and delete dispatch paths do not exist.

## Verification completed

- PuyaPy 5.10.1 compilation to AVM 11 succeeds and regenerates ARC-56, approval
  and clear TEAL, source maps, and the typed client.
- `build-manifest.json` pins SHA-256 hashes of source, ARC-56, TEAL, and typed
  client. Unsigned deployment preparation fails if any reviewed artifact drifts.
- ARC-56 exposes 13 methods, a 7-integer/2-byte global schema, and no local
  schema. Artifact tests inspect routing and confirm there are no update/delete
  entry points.
- 33 focused Python tests cover state transitions, uint64 and rounding edges,
  exact funding and fees, quote arithmetic/expiry, rekey/close rejection,
  authorization, pool spoofing and pre-seeding, reserve/issuance verification,
  ARC-54 branches, cancellation, Vestige, allocation conservation, directory
  boxes, replay rejection, and compiled artifacts.
- 20 Node tests cover amount bounds, quote policy, transaction composition,
  signer selection, unsigned deployment-package validation, simulation failure
  handling, and chain-authoritative session recovery.
- The production Vite build succeeds with Pact and the nested Algorand SDK v2
  path removed. The production dependency audit has zero high or critical
  advisories. The single unreachable moderate UUID finding is documented in
  `docs/DEPENDENCY_AUDIT.md` without an unsupported major-version override.
- Read-only MainNet preflight at round `65665154` verified PNET decimals, all
  protocol applications, the pinned source pair and LP ID, platform PNET opt-in,
  and nonzero source reserves. A one-ALGO quote produced approximately
  `17,550.631012` PNET expected, `17,375.124701` minimum, and 0.8% calculated
  impact at that snapshot. No transaction was signed or submitted.
- The frontend simulates every unsigned launchpad group before wallet signing
  and simulates the fully signed mixed wallet/LogicSig bootstrap group before
  submission. It requests execution traces, refuses unnamed extra resources,
  and does not grant extra opcode budget.

## Exact funding constants

- One-time initialization: `1,200,000` microALGO.
- Per-launch asset/record/index/allocation funding: `286,300` microALGO.
- Creator LP opt-in: `100,000` microALGO wallet MBR.
- Finalize funding to app: `100,000` microALGO if ARC-54 is already opted in,
  otherwise `200,000` microALGO.
- Vestige funding: exactly `100,000` microALGO.
- Network and application-call fees are itemized separately by the quote.

## Remaining chain gates

Local tests and mocks cannot establish the behavior of deployed Tinyman,
ARC-54, Vestige, wallet software, node resource discovery, or a particular
network round. Before MainNet, perform both funded TestNet paths and inspect
algod simulation traces plus chain state:

1. success: initialize, create, exact swap, bootstrap, finalize, 80/10/10 LP
   distribution, directory record, and a retryable Vestige grant;
2. recovery: create, swap, wait 20,000 rounds, cancellation, creator refunds,
   platform PNET receipt, and bounded canceled-ASA allocation/release.

MainNet acceptance additionally requires an independent source/TEAL/composer
review and one deliberately small controlled canary with the public frontend
still disabled.
