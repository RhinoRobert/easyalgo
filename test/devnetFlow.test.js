// End to end on the private devnet (real Tinyman / ARC-54 / Vestige programs): the exact groups the UI builds are simulated,
// signed and submitted. Needs the devnet and `contracts/tests/js_fixture.py`; skipped when the fixture is absent.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import algosdk from "algosdk";
import {
  assetIdFromCreateConfirmation,
  buildCancelGroup,
  buildClaimLpGroup,
  buildLaunchFinishGroup,
  buildLaunchStartGroup,
  buildOptInGroup,
  buildReleaseAllocationGroup,
  buildReleaseCancelledPnetGroup,
  buildVestigeGroup,
  readLaunchSnapshot,
  verifyCompletedLaunch,
} from "../src/launchpad/launchpadClient.js";
import { buildLaunchQuote } from "../src/launchpad/quote.js";
import { simulateSignerGroup } from "../src/launchpad/simulation.js";
import { readPool, readTinymanPoolState, readTinymanSourcePool } from "../src/launchpad/tinymanAdapter.js";

const fixtureUrl = new URL("../contracts/tests/js-fixture.local.json", import.meta.url);
let skip = !existsSync(fixtureUrl) && "devnet fixture missing (run contracts/tests/js_fixture.py)";
const fx = skip ? null : JSON.parse(readFileSync(fixtureUrl, "utf8"));
if (!skip) {
  // A fixture from an earlier session points at a devnet that may no longer be running: skip, do not fail.
  const alive = await fetch(`${fx.algod}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
  if (!alive) skip = "devnet not running (start it with contracts/tests/devnet/start.sh, then run contracts/tests/js_fixture.py)";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function context() {
  const url = new URL(fx.algod);
  const algod = new algosdk.Algodv2(fx.token, `${url.protocol}//${url.hostname}`, Number(url.port));
  const config = {
    launchpadAppId: BigInt(fx.launchpadAppId), tinymanAppId: BigInt(fx.tinymanAppId), vestigeAppId: BigInt(fx.vestigeAppId),
    arc54AppId: BigInt(fx.arc54AppId), pnetAssetId: BigInt(fx.pnetAssetId), sourcePool: fx.sourcePool, arc54Address: fx.arc54Address,
    platformWallet: fx.platform.address, // the devnet program is patched with a test platform wallet
  };
  const account = (entry) => ({ address: entry.address, sk: algosdk.mnemonicToSecretKey(entry.mnemonic).sk });
  return { algod, config, account };
}

async function waitFor(algod, txId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const info = await algod.pendingTransactionInformation(txId).do();
    if ((info.confirmedRound ?? 0n) > 0n) return info;
    await sleep(50);
  }
  throw new Error(`transaction ${txId} was not confirmed`);
}

/** Simulate exactly as the UI does, then sign wallet entries with the throwaway key and submit. */
async function run(algod, entries, presigned, account) {
  const simulation = await simulateSignerGroup(algod, entries, presigned);
  assert.ok(simulation.transactionCount >= entries.length);
  const blobs = entries.map(({ txn, signers }, index) => (
    presigned[index] ?? (signers.length ? algosdk.signTransaction(txn, account.sk).blob : null)
  ));
  assert.ok(blobs.every(Boolean), "every transaction is signed by the wallet or by the pool LogicSig");
  await algod.sendRawTransaction(blobs).do();
  return waitFor(algod, entries.at(-1).txn.txID());
}

async function advance(algod, funder, rounds) {
  for (let i = 0; i < rounds; i += 1) {
    const params = await algod.getTransactionParams().do();
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: funder.address, receiver: funder.address, amount: 0n, suggestedParams: params, note: Uint8Array.of(i % 256, i >> 8),
    });
    await algod.sendRawTransaction(algosdk.signTransaction(txn, funder.sk).blob).do();
    await waitFor(algod, txn.txID());
  }
}

async function quoteFor(algod, config, totalRaw) {
  const status = await algod.status().do();
  const source = await readTinymanSourcePool({
    algodClient: algod, sourcePool: config.sourcePool, tinymanAppId: config.tinymanAppId, pnetAssetId: config.pnetAssetId,
  });
  return buildLaunchQuote({
    currentRound: status.lastRound ?? status["last-round"], totalRaw, sourcePoolState: source, tinymanBootstrapCost: 1_057_000n,
  });
}

const form = { name: "Canary Test", unitName: "CNRY", totalRaw: 1_000_000_000_000n, url: "" };

test("two approvals launch a token end to end, then claim the creator LP", { skip }, async () => {
  const { algod, config, account } = context();
  const user = account(fx.users[0]);
  const quote = await quoteFor(algod, config, form.totalRaw);

  // approval 1
  const startGroup = await buildLaunchStartGroup({ algodClient: algod, config, wallet: user.address, form, quote });
  const startConfirmation = await run(algod, startGroup, {}, user);
  const assetId = assetIdFromCreateConfirmation(startConfirmation);
  const info = (await algod.getAssetByID(Number(assetId)).do()).params;
  assert.equal(info.name, "Canary Test");
  assert.equal(info.unitName, "CNRY");
  assert.equal(info.creator.toString(), algosdk.getApplicationAddress(Number(config.launchpadAppId)).toString());

  // approval 2: bootstrap pair + funding + finish in one atomic group
  const pool = await readPool({ algodClient: algod, validatorAppId: config.tinymanAppId, assetA: assetId, assetB: config.pnetAssetId });
  assert.equal(pool.exists, false);
  const finish = await buildLaunchFinishGroup({ algodClient: algod, config, wallet: user.address, assetId, pool, grantVestige: true });
  assert.equal(finish.entries.length, 5);
  await run(algod, finish.entries, finish.presigned, user);

  const snapshot = await readLaunchSnapshot({ algodClient: algod, config, wallet: user.address, assetId });
  assert.equal(snapshot.pending, null);
  assert.equal(snapshot.launch.status, 2n);
  assert.equal(snapshot.launch.vestigeGranted, 1n);
  assert.equal(snapshot.launch.creatorLpClaimed, 0n);
  const poolState = await readTinymanPoolState({ algodClient: algod, poolAddress: finish.poolAddress, tinymanAppId: config.tinymanAppId });
  await verifyCompletedLaunch({ algodClient: algod, config, wallet: user.address, snapshot, poolState });

  // claim later (opt-in + claim, one approval)
  const claim = await buildClaimLpGroup({ algodClient: algod, config, wallet: user.address, assetId, lpAssetId: snapshot.launch.lpAssetId });
  await run(algod, claim, {}, user);
  const after = await readLaunchSnapshot({ algodClient: algod, config, wallet: user.address, assetId });
  assert.equal(after.launch.creatorLpClaimed, 1n);
  await verifyCompletedLaunch({ algodClient: algod, config, wallet: user.address, snapshot: after, poolState });
});

test("finish without the Vestige grant, then the retry group grants it", { skip }, async () => {
  const { algod, config, account } = context();
  const user = account(fx.users[1]);
  const quote = await quoteFor(algod, config, form.totalRaw);
  const assetId = assetIdFromCreateConfirmation(await run(
    algod, await buildLaunchStartGroup({ algodClient: algod, config, wallet: user.address, form: { ...form, name: "No Vestige", unitName: "NOV" }, quote }), {}, user,
  ));
  const pool = await readPool({ algodClient: algod, validatorAppId: config.tinymanAppId, assetA: assetId, assetB: config.pnetAssetId });
  const finish = await buildLaunchFinishGroup({ algodClient: algod, config, wallet: user.address, assetId, pool, grantVestige: false });
  await run(algod, finish.entries, finish.presigned, user);
  const mid = await readLaunchSnapshot({ algodClient: algod, config, wallet: user.address, assetId });
  assert.equal(mid.launch.vestigeGranted, 0n);
  await run(algod, await buildVestigeGroup({ algodClient: algod, config, wallet: user.address, assetId }), {}, user);
  const done = await readLaunchSnapshot({ algodClient: algod, config, wallet: user.address, assetId });
  assert.equal(done.launch.vestigeGranted, 1n);
});

test("a launch that cannot finish is cancelled in one approval after the delay", { skip }, async () => {
  const { algod, config, account } = context();
  const user = account(fx.users[2]);
  const platform = account(fx.platform);
  const quote = await quoteFor(algod, config, form.totalRaw);
  const assetId = assetIdFromCreateConfirmation(await run(
    algod, await buildLaunchStartGroup({ algodClient: algod, config, wallet: user.address, form: { ...form, name: "Cancelled", unitName: "CAN" }, quote }), {}, user,
  ));
  await advance(algod, platform, fx.cancelDelay + 2);
  const cancel = await buildCancelGroup({ algodClient: algod, config, wallet: user.address, assetId });
  assert.equal(cancel.length, 2, "ASA opt-in + cancel call (the wallet already holds PNET)");
  await run(algod, cancel, {}, user);
  const snapshot = await readLaunchSnapshot({ algodClient: algod, config, wallet: user.address, assetId });
  assert.equal(snapshot.pending, null);
  assert.equal(snapshot.launch.status, 3n);
  const holdings = (await algod.accountInformation(user.address).do()).assets;
  const held = holdings.find((h) => BigInt(h.assetId) === assetId);
  assert.equal(held.amount, form.totalRaw / 2n);
});

test("the platform releases its LP allocation and deferred PNET with the app's builders; nobody else can", { skip }, async () => {
  const { algod, config, account } = context();
  const user = account(fx.users[3]);
  const platform = account(fx.platform);
  const quote = await quoteFor(algod, config, form.totalRaw);
  const assetId = assetIdFromCreateConfirmation(await run(
    algod, await buildLaunchStartGroup({ algodClient: algod, config, wallet: user.address, form: { ...form, name: "Platform", unitName: "PLT" }, quote }), {}, user,
  ));
  const pool = await readPool({ algodClient: algod, validatorAppId: config.tinymanAppId, assetA: assetId, assetB: config.pnetAssetId });
  const finish = await buildLaunchFinishGroup({ algodClient: algod, config, wallet: user.address, assetId, pool, grantVestige: true });
  await run(algod, finish.entries, finish.presigned, user);
  const record = (await readLaunchSnapshot({ algodClient: algod, config, wallet: user.address, assetId })).launch;

  // someone who is not the platform authority is refused by the contract (the page's disabled buttons are only a convenience)
  await assert.rejects(
    simulateSignerGroup(algod, await buildReleaseAllocationGroup({
      algodClient: algod, config, wallet: user.address, launchAssetId: assetId, holdingAssetId: record.lpAssetId, receiver: user.address, amount: record.platformLp,
    })),
    /assert failed/, // the contract's own check (the bytecode carries no message text; the Python suite asserts the exact reason)
  );

  await run(algod, await buildOptInGroup({ algodClient: algod, wallet: platform.address, assetId: record.lpAssetId }), {}, platform);
  await run(algod, await buildReleaseAllocationGroup({
    algodClient: algod, config, wallet: platform.address, launchAssetId: assetId, holdingAssetId: record.lpAssetId, receiver: platform.address, amount: record.platformLp,
  }), {}, platform);
  const held = (await algod.accountInformation(platform.address).do()).assets.find((h) => BigInt(h.assetId) === BigInt(record.lpAssetId));
  assert.equal(held.amount, record.platformLp);
  await assert.rejects(simulateSignerGroup(algod, await buildReleaseCancelledPnetGroup({ algodClient: algod, config, wallet: platform.address, launchAssetId: assetId })), /assert failed/);
});