import test from "node:test";
import assert from "node:assert/strict";
import { reconcileBooks } from "../src/launchpad/reconcile.js";

const PNET = 100n;
// One launch still waiting for its second approval, one finished, one cancelled: the books of a healthy contract.
const healthy = () => ({
  pnetAssetId: PNET,
  holdings: new Map([[PNET, 57n], [10n, 1000n], [20n, 0n], [21n, 60n], [30n, 500n]]),
  algo: { amount: 1_000_000n, minBalance: 500_000n },
  globals: { reserved: 50n, platpnet: 7n },
  pending: [{ assetId: 10n, totalRaw: 1000n, pnetOutput: 50n }],
  launches: [
    { assetId: 20n, status: 2n, lpAssetId: 21n, creatorLp: 30n, creatorLpClaimed: 0n, platformLp: 30n, cancelPlatformPnetRemaining: 0n },
    { assetId: 30n, status: 3n, lpAssetId: 0n, creatorLp: 0n, creatorLpClaimed: 0n, platformLp: 0n, cancelPlatformPnetRemaining: 7n },
  ],
  allocations: [
    { launchAssetId: 20n, holdingAssetId: 21n, remaining: 30n, kind: 2n },
    { launchAssetId: 30n, holdingAssetId: 30n, remaining: 500n, kind: 1n },
  ],
});
const failedIds = (books) => reconcileBooks(books).failing.map((entry) => entry.id);

test("healthy books reconcile with nothing failing", () => {
  const result = reconcileBooks(healthy());
  assert.equal(result.ok, true);
  assert.deepEqual(result.failing, []);
  assert.equal(result.rows.length, 10);
  assert.ok(result.rows.every((entry) => entry.status === "pass"));
});

test("holding more than the records need (donations) is fine and is reported as a surplus", () => {
  const books = healthy();
  books.holdings.set(PNET, 5_057n);
  books.holdings.set(21n, 60n + 1_000n);
  const result = reconcileBooks(books);
  assert.equal(result.ok, true);
  assert.match(result.rows.find((entry) => entry.id === "pnet-held").detail, /5000 more than owed/);
});

test("PNET missing from the contract is caught, as are counters that disagree with the records", () => {
  const short = healthy();
  short.holdings.set(PNET, 56n);
  assert.deepEqual(failedIds(short), ["pnet-held"]);
  const counter = healthy();
  counter.globals.reserved = 49n;
  assert.ok(failedIds(counter).includes("escrow-counter"));
  const deferred = healthy();
  deferred.globals.platpnet = 8n;
  assert.ok(failedIds(deferred).includes("deferred-counter"));
});

test("supply taken out of an in-progress launch, or left behind by a finished one, is caught", () => {
  const taken = healthy();
  taken.holdings.set(10n, 999n);
  assert.deepEqual(failedIds(taken), ["pending-tokens"]);
  const left = healthy();
  left.holdings.set(20n, 1n);
  assert.deepEqual(failedIds(left), ["finished-tokens"]);
});

test("a cancelled launch may hold only the platform's recorded half", () => {
  const less = healthy();
  less.holdings.set(30n, 499n);
  assert.deepEqual(failedIds(less), ["cancelled-tokens"]);
  const more = healthy();
  more.holdings.set(30n, 501n);
  assert.deepEqual(failedIds(more), ["cancelled-tokens"]);
  const released = healthy(); // the platform released everything: allocation gone, nothing held
  released.holdings.set(30n, 0n);
  released.allocations = released.allocations.filter((entry) => entry.launchAssetId !== 30n);
  assert.equal(reconcileBooks(released).ok, true);
});

test("liquidity tokens: the creator's unclaimed share and the platform's share must both be there", () => {
  const short = healthy();
  short.holdings.set(21n, 59n);
  assert.deepEqual(failedIds(short), ["liquidity-tokens"]);
  const claimed = healthy(); // creator claimed: only the platform's 30 is owed now
  claimed.launches[0].creatorLpClaimed = 1n;
  claimed.holdings.set(21n, 30n);
  assert.equal(reconcileBooks(claimed).ok, true);
  claimed.holdings.set(21n, 29n);
  assert.deepEqual(failedIds(claimed), ["liquidity-tokens"]);
});

test("allocations without a launch record, an ALGO shortfall and unexplained assets are caught", () => {
  const orphan = healthy();
  orphan.allocations.push({ launchAssetId: 99n, holdingAssetId: 99n, remaining: 5n, kind: 1n });
  assert.deepEqual(failedIds(orphan), ["allocations"]);
  const broke = healthy();
  broke.algo = { amount: 400_000n, minBalance: 500_000n };
  assert.deepEqual(failedIds(broke), ["algo"]);
  const stranger = healthy();
  stranger.holdings.set(777n, 1n);
  const result = reconcileBooks(stranger);
  assert.deepEqual(result.failing.map((entry) => entry.id), ["unknown-assets"]);
  assert.match(result.failing[0].detail, /777/);
  const zero = healthy(); // an opt-in with nothing in it is not a holding
  zero.holdings.set(777n, 0n);
  assert.equal(reconcileBooks(zero).ok, true);
});

test("an empty launchpad reconciles", () => {
  const result = reconcileBooks({
    pnetAssetId: PNET, holdings: new Map([[PNET, 0n]]), algo: { amount: 500_000n, minBalance: 200_000n },
    globals: {}, pending: [], launches: [], allocations: [],
  });
  assert.equal(result.ok, true);
});
