# PNET Instant Launchpad v2 contract

This is the isolated, undeployed successor to the bonding-curve launchpad. It
does not reuse MainNet App ID `3609729732` and has no update or delete route.

## Enforced lifecycle

1. `initialize(pay)` opts the app into PNET and requires exactly `1,200,000`
   microALGO: app base MBR, PNET holding MBR, and a one-ALGO spendable cushion.
2. `create_asset(pay,string,string,uint64,string)` creates an immutable,
   six-decimal ASA from the application account. The app retains 100% of supply.
   Exact launch storage funding is `289,500` microALGO.
3. `swap_pnet(pay,uint64,uint64,uint64)` receives exactly one ALGO, recomputes
   the fixed-input quote from the pinned Tinyman v2 PNET/ALGO pool, enforces 1%
   slippage, at most 5% price impact, and a ten-round quote lifetime, executes
   the swap with inner transactions, and records the measured PNET increase.
4. Tinyman pool bootstrap is a separate confirmed wallet operation.
5. `provide_finalize_resources(uint64,uint64)` carries ARC-54/LP/box references
   for AVM v11 group-resource sharing without changing state.
6. `finalize_launch(axfer,pay,uint64,address,uint64)` atomically opts the app and,
   when needed, ARC-54 into the LP ASA; supplies the complete ASA supply and all
   measured PNET; adds initial liquidity; verifies pool reserves and issuance;
   sends 80% of received LP to ARC-54, 10% to the creator, and retains the
   rounding remainder as a tracked platform allocation.
7. `grant_vestige_access(pay,uint64)` is post-completion and retryable until it
   succeeds. It does not block liquidity.

An un-swapped or escrowed launch can be canceled only after 20,000 rounds. An
un-swapped cancellation returns the entire ASA and unused allocation-box MBR.
An escrowed cancellation sends half the ASA and half the PNET to the creator,
sends the other PNET half directly to the hardcoded platform wallet when it is
opted in, and otherwise retains that PNET as a tracked, deferred allocation.
The retained ASA half remains a releasable platform allocation. Only
`CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E` can call
`release_platform_allocation` or `release_cancelled_pnet`; the latter always
sends deferred PNET to that same hardcoded address.

On MainNet, bytecode pins PNET `3169177585`, Tinyman validator `1002541853`,
Vestige `3129810607`, ARC-54 `1257620981`, and source pool
`ANESQRCMZ5KWZFKDGESLJEWQLRCVUZU725FJL7NO3BMKJEYMAB3TR56R3E`.

## Reproduce compilation and tests

```powershell
$env:PYTHONPATH=(Resolve-Path -LiteralPath '.\contracts').Path
& '.\contracts\.venv-v2\Scripts\python.exe' '.\contracts\launchpad_v2\compile.py'
& '.\contracts\.venv-v2\Scripts\python.exe' -m pytest `
  '.\contracts\tests\test_launchpad_v2.py' `
  '.\contracts\tests\test_launchpad_v2_artifacts.py' -q
```

Compilation regenerates ARC-56, TEAL, the typed Python client, and
`build-manifest.json`. Deployment tooling refuses artifact drift.

## Unsigned deployment workflow

`deploy.py` never accepts a mnemonic, never signs, and never submits. It emits
unsigned local JSON packages for review and Pera/Ledger signing, then separately
verifies confirmed programs, state, MBR, and the one-ALGO cushion before writing
a non-secret manifest.

```powershell
$env:ALLOW_LAUNCHPAD_V2_DEPLOY='TESTNET'
$env:LAUNCHPAD_V2_PNET_ASSET_ID='<mock-pnet-id>'
$env:LAUNCHPAD_V2_SOURCE_POOL='<testnet-pool-address>'
& '.\contracts\.venv-v2\Scripts\python.exe' -m launchpad_v2.deploy `
  prepare-create testnet '<platform-authority-address>'
```

MainNet preparation additionally requires
`CONFIRM_NEW_MAINNET_APP=3609729732-REMAINS-UNTOUCHED`. Generating an unsigned
package is not authorization to deploy. See
`docs/MAINNET_ROLLOUT_CHECKLIST.md` for the remaining gates.
