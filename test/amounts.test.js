import test from "node:test";
import assert from "node:assert/strict";
import { integerSqrt, parseDisplaySupply, splitTokenSupply, splitUserLp, UINT64_MAX } from "../src/launchpad/amounts.js";

test("display supply converts to exact six-decimal raw units", () => {
  assert.equal(parseDisplaySupply("123.456789"), 123_456_789n);
  assert.throws(() => parseDisplaySupply("1.0000001"), /six decimal/i);
});

test("supply rejects uint64 overflow", () => {
  assert.equal(parseDisplaySupply("18446744073709.551615"), UINT64_MAX);
  assert.throws(() => parseDisplaySupply("18446744073709.551616"), /uint64/i);
});

test("token and LP splits preserve rounding remainder", () => {
  assert.deepEqual(splitTokenSupply(11n), { tokenSeed: 11n, creatorTokens: 0n });
  assert.deepEqual(splitUserLp(11n), { burnedLp: 8n, creatorLp: 1n, platformLp: 2n });
  assert.equal(integerSqrt(100_003_300_003n), 316_232n);
});

