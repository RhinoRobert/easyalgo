import test from "node:test";
import assert from "node:assert/strict";
import { confirmStep, createLaunchSession, loadSession, nextPendingStep, saveSession } from "../src/launchpad/session.js";

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

test("confirmed steps are idempotent and recovery advances", () => {
  const session = createLaunchSession({ network: "testnet", wallet: "WALLET", form: {}, quote: {} });
  assert.equal(nextPendingStep(session), "asset_create");
  const next = confirmStep(session, "asset_create", { txId: "TX", confirmedRound: 9 });
  assert.equal(nextPendingStep(next), "pnet_swap");
  assert.strictEqual(confirmStep(next, "asset_create", { txId: "OTHER", confirmedRound: 10 }), next);
});

