import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmStep,
  createLaunchSession,
  clearSession,
  loadSession,
  nextPendingStep,
  reconcileSessionFromChain,
  saveSession,
} from "../src/launchpad/session.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("versioned launch session round-trips bigint quote fields", () => {
  const storage = memoryStorage();
  const session = createLaunchSession({ network: "testnet", wallet: "WALLET", form: {}, quote: { minimumPnet: 7n } });
  saveSession(session, storage);
  assert.equal(loadSession("testnet", "WALLET", storage).quote.minimumPnet, 7n);
});

test("two approvals: confirmed steps are idempotent and recovery advances", () => {
  const session = createLaunchSession({ network: "testnet", wallet: "WALLET", form: {}, quote: {} });
  assert.equal(nextPendingStep(session), "start");
  const next = confirmStep(session, "start", { txId: "TX", confirmedRound: 9 });
  assert.equal(nextPendingStep(next), "finish");
  assert.strictEqual(confirmStep(next, "start", { txId: "OTHER", confirmedRound: 10 }), next);
  assert.equal(nextPendingStep(confirmStep(next, "finish", { txId: "T2", confirmedRound: 12 })), null);
});

test("chain state alone reconstructs the session (no local storage needed)", () => {
  const blank = createLaunchSession({ network: "testnet", wallet: "WALLET", form: {}, quote: {} });
  const afterStart = reconcileSessionFromChain(blank, {
    pending: { assetId: 5n, pnetOutput: 9n, createTxId: "S", createdRound: 3n },
  });
  assert.equal(nextPendingStep(afterStart), "finish");
  assert.equal(afterStart.assetId, 5n);
  const complete = reconcileSessionFromChain(blank, {
    launch: {
      assetId: 5n, status: 2n, pnetSeed: 9n, poolAddress: "POOL", lpAssetId: 6n, burnedLp: 8n, creatorLp: 1n,
      platformLp: 1n, createTxId: "S", createdRound: 3n, terminalTxId: "F", terminalRound: 4n,
    },
  });
  assert.equal(nextPendingStep(complete), null);
  assert.equal(complete.terminalStatus, "complete");
  const cancelled = reconcileSessionFromChain(blank, {
    launch: { assetId: 5n, status: 3n, pnetSeed: 9n, createTxId: "S", createdRound: 3n, lpAssetId: 0n },
  });
  assert.equal(cancelled.terminalStatus, "cancelled");
  assert.equal(nextPendingStep(cancelled), null);
});

test("a new launch never adopts a finished launch of the same wallet (the 'Prepare another launch' bug)", () => {
  const next = { ...createLaunchSession({ network: "testnet", wallet: "WALLET", form: {}, quote: {} }), assetId: 7n };
  const oldLaunch = { assetId: 5n, status: 2n, pnetSeed: 9n, poolAddress: "POOL", lpAssetId: 6n, createTxId: "S", createdRound: 3n, terminalTxId: "F", terminalRound: 4n };
  const out = reconcileSessionFromChain(next, { launch: oldLaunch, pending: { assetId: 5n, pnetOutput: 1n, createTxId: "S", createdRound: 3n } });
  assert.equal(out.terminalStatus, null);
  assert.equal(nextPendingStep(out), "start");
  assert.equal(out.assetId, 7n);
});

test("clearSession forgets only that wallet's saved launch", () => {
  const storage = { data: new Map(), getItem(k) { return this.data.get(k) ?? null; }, setItem(k, v) { this.data.set(k, v); }, removeItem(k) { this.data.delete(k); } };
  saveSession(createLaunchSession({ network: "testnet", wallet: "A", form: {}, quote: {} }), storage);
  saveSession(createLaunchSession({ network: "testnet", wallet: "B", form: {}, quote: {} }), storage);
  clearSession("testnet", "A", storage);
  assert.equal(loadSession("testnet", "A", storage), null);
  assert.ok(loadSession("testnet", "B", storage));
});