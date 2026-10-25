import test from "node:test";
import assert from "node:assert/strict";
import { ROUNDS_PER_DAY } from "../src/launchpad/funnel.js";
import { biggestPools, biggestThisWeek, creatorSummary, topCreators } from "../src/launchpad/leaders.js";

const ROUND = 5_000_000n;
const launch = (assetId, launcher, tvl, { status = 2n, agoDays = 0, pool = true } = {}) => ({
  assetId: BigInt(assetId), launcher, status, tvlMicroAlgo: BigInt(tvl), pool: pool ? {} : null, terminalRound: ROUND - BigInt(Math.round(agoDays * ROUNDS_PER_DAY)),
});
const items = [
  launch(1, "A", 3_000_000), launch(2, "A", 5_000_000, { agoDays: 10 }), launch(3, "B", 9_000_000, { agoDays: 2 }),
  launch(4, "B", 0, { status: 3n }), launch(5, "C", 4_000_000, { agoDays: 1 }), launch(6, "C", 1_000_000, { pool: false }),
];

test("biggest pools: finished launches with a pool, biggest first", () => {
  assert.deepEqual(biggestPools(items).map((i) => i.assetId), [3n, 2n, 5n, 1n]);
  assert.equal(biggestPools(items, 2).length, 2);
});

test("this week: only launches that went live in the window", () => {
  assert.deepEqual(biggestThisWeek(items, ROUND).map((i) => i.assetId), [3n, 5n, 1n], "launch 2 is ten days old");
  assert.deepEqual(biggestThisWeek(items, ROUND, 30).map((i) => i.assetId), [3n, 2n, 5n, 1n]);
});

test("top creators: most launches first, then the biggest combined pools; cancelled and pool-less launches do not count", () => {
  const top = topCreators(items);
  assert.deepEqual(top.map((c) => [c.address, c.launched]), [["A", 2], ["B", 1], ["C", 1]]);
  assert.equal(top[0].totalPool, 8_000_000n);
  assert.equal(top[0].best.assetId, 2n);
  assert.deepEqual(top.slice(1).map((c) => c.address), ["B", "C"], "ties are broken by the combined pool");
});

test("a creator's summary lists their live tokens newest first and counts cancellations", () => {
  const b = creatorSummary(items, "B");
  assert.deepEqual([b.launched, b.cancelled, b.totalPool], [1, 1, 9_000_000n]);
  assert.equal(b.best.assetId, 3n);
  const a = creatorSummary(items, "A");
  assert.deepEqual(a.live.map((i) => i.assetId), [2n, 1n]);
  const nobody = creatorSummary(items, "Z");
  assert.deepEqual([nobody.launched, nobody.cancelled, nobody.totalPool, nobody.best], [0, 0, 0n, null]);
});
