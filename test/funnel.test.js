import test from "node:test";
import assert from "node:assert/strict";
import { ROUNDS_PER_DAY, summarizeFunnel } from "../src/launchpad/funnel.js";

const ROUND = 1_000_000n;
const record = (launcher, status, createdAgo, gap = 10n) => ({
  launcher, status, createdRound: ROUND - BigInt(createdAgo), swapRound: ROUND - BigInt(createdAgo), terminalRound: ROUND - BigInt(createdAgo) + gap,
});
const waiting = (launcher, ago) => ({ launcher, createdRound: ROUND - BigInt(ago), swapRound: ROUND - BigInt(ago) });

test("counts what started, finished, cancelled, is waiting and has stalled", () => {
  const funnel = summarizeFunnel({
    round: ROUND,
    launches: [record("A", 2n, 100), record("B", 2n, 200), record("C", 3n, 300)],
    pending: [waiting("D", 100), waiting("E", 5_000)], // D is within the cancel delay, E is past it
  });
  assert.deepEqual([funnel.started, funnel.finished, funnel.cancelled, funnel.waiting, funnel.stalled], [5, 2, 1, 1, 1]);
  assert.equal(funnel.completionRate, 2 / 4, "2 finished out of 4 that reached an outcome (the one still within its delay is not counted yet)");
});

test("counts wallets and the ones that came back", () => {
  const funnel = summarizeFunnel({
    round: ROUND,
    launches: [record("A", 2n, 10), record("A", 3n, 20), record("B", 2n, 30)],
    pending: [waiting("C", 5), waiting("C", 6)],
  });
  assert.equal(funnel.launchers, 3);
  assert.equal(funnel.repeatLaunchers, 2, "A and C each launched twice");
});

test("the typical gap between the two approvals is a median in seconds, ignoring unfinished launches", () => {
  const funnel = summarizeFunnel({
    round: ROUND,
    launches: [record("A", 2n, 10, 10n), record("B", 2n, 10, 20n), record("C", 2n, 10, 1000n), record("D", 3n, 10, 5000n)],
    pending: [],
  });
  assert.equal(funnel.medianSecondsBetweenApprovals, 20 * 2.8);
  assert.equal(summarizeFunnel({ round: ROUND, launches: [], pending: [] }).medianSecondsBetweenApprovals, null);
});

test("launches are bucketed per day, newest first, and old ones fall outside the window", () => {
  const day = BigInt(ROUNDS_PER_DAY);
  const funnel = summarizeFunnel({
    round: ROUND,
    launches: [record("A", 2n, 10), record("B", 2n, day + 5n), record("C", 2n, day * 3n), record("D", 2n, day * 30n)],
    pending: [waiting("E", 20)],
  });
  assert.deepEqual(funnel.perDay.map((d) => d.started), [2, 1, 0, 1, 0, 0, 0]);
  assert.equal(funnel.perDay.length, 7);
});

test("an empty launchpad has no rate and no division by zero", () => {
  const funnel = summarizeFunnel({ round: ROUND, launches: [], pending: [] });
  assert.equal(funnel.completionRate, null);
  assert.deepEqual([funnel.started, funnel.launchers, funnel.repeatLaunchers], [0, 0, 0]);
});
