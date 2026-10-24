# PNET Instant Launchpad v2 — MainNet rollout checklist

No item in this file authorizes deployment. MainNet remains a separate explicit
approval gate, and legacy App ID `3609729732` must remain untouched.

## 1. Reproducible release candidate

- [ ] Clean local Git status and no configured remote.
- [ ] Compile with PuyaPy 5.10.1; review source, ARC-56, approval/clear TEAL,
      schema, extra pages, method selectors, and `build-manifest.json` hashes.
- [ ] Run 33 contract/artifact tests and 20 frontend tests from a clean install.
- [ ] Build the frontend reproducibly.
- [ ] Production audit has zero unresolved high/critical advisories; disposition
      every lower-severity production advisory.
- [ ] Secret scan finds no `.env`, mnemonic, seed, private key, deployment
      package, or credential in tracked files or the review snapshot.
- [ ] Independent reviewer signs off on source, TEAL, platform-release authority,
      inner transaction fee/resource budgets, and browser group composition.

## 2. Funded TestNet acceptance

- [ ] Deploy a new app with unsigned package -> Pera/Ledger signing only.
- [ ] Initialize once; verify PNET opt-in and one-ALGO spendable cushion.
- [ ] Simulate every group with traces before submission.
- [ ] Complete create -> exact one-ALGO swap -> bootstrap -> finalize -> Vestige.
- [ ] Verify immutable ASA authorities and launchpad creator on-chain.
- [ ] Verify 100% ASA supply and measured PNET are pool reserves.
- [ ] Verify 80% user-received LP at ARC-54, 10% creator LP, and exact retained
      platform rounding allocation in both account balance and allocation box.
- [ ] Verify directory/record fields and transaction IDs against confirmed data.
- [ ] Exercise wallet rejection, reload/reconnect, stale quote, node timeout,
      pre-opted ARC-54, and safe resume without replay.
- [ ] Run a second launch through the 20,000-round cancellation path; verify
      creator refunds, direct platform PNET receipt, and bounded ASA release.

## 3. MainNet creation gate

- [ ] Re-run read-only preflight immediately before package generation.
- [ ] Confirm the hardcoded platform wallet controls the connected Pera/Ledger
      account and is opted into MainNet PNET.
- [ ] Set `ALLOW_LAUNCHPAD_V3_DEPLOY=MAINNET` and
      `CONFIRM_NEW_MAINNET_APP=3609729732-REMAINS-UNTOUCHED` only for package
      generation.
- [ ] Compare displayed transaction IDs and artifact hashes on an independent
      machine before signing.
- [ ] Sign app creation with Pera/Ledger; record the new App ID.
- [ ] Generate, simulate, review, and sign the separate initialize group.
- [ ] Run `verify-record` and archive the non-secret verified manifest.
- [ ] Confirm update/delete are impossible and the legacy app is unchanged.

## 4. Controlled canary and publication

- [ ] Keep public frontend disabled.
- [ ] Execute one controlled exact-one-ALGO launch.
- [ ] Manually verify ASA, pool reserves, LP issuance, 80/10/10 balances,
      directory record, Vestige status, explorer links, and app cushion.
- [ ] Have the independent reviewer compare canary state to the manifest.
- [ ] Point a non-production frontend build at the new App ID and repeat recovery.
- [ ] Obtain separate approval before changing production GitHub or publishing
      the frontend.

Stop immediately on any hash mismatch, unexpected resource/fee request, failed
simulation, reserve mismatch, unaccounted LP/PNET/ASA unit, or wallet identity
mismatch. Do not "fix forward" on MainNet; investigate from the isolated lab.
