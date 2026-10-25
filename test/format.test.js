import test from "node:test";
import assert from "node:assert/strict";
import { mapLimit, poolTvlMicroAlgo, roundsAgo, safeText, shortAddress } from "../src/launchpad/format.js";

test("safeText removes control, zero-width and bidi-override characters and caps the length", () => {
  assert.equal(safeText("Hello\u202EWorld\u200B\u0000  x\ny"), "HelloWorld xy");
  assert.equal(safeText("A".repeat(80), 10), "AAAAAAAAA…");
  assert.equal(safeText(null), "");
  assert.equal(safeText("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>", "markup is left as text; React renders it inert");
});

test("pool value counts both sides at the source pool price", () => {
  // 20,000 PNET in the pool; the source pool prices 1 ALGO = 20,000 PNET, so each side is worth 1 ALGO.
  assert.equal(poolTvlMicroAlgo({ pnetReserve: 20_000_000_000n, sourceAlgoReserve: 1_000_000n, sourcePnetReserve: 20_000_000_000n }), 2_000_000n);
  assert.equal(poolTvlMicroAlgo({ pnetReserve: 1n, sourceAlgoReserve: 1n, sourcePnetReserve: 0n }), 0n);
});

test("round differences read as plain ages", () => {
  assert.equal(roundsAgo(1_000, 1_000), "just now");
  assert.equal(roundsAgo(1_000 + 1_286, 1_000), "60 min ago");
  assert.equal(roundsAgo(1_000 + 25_714, 1_000), "20 h ago");
  assert.equal(roundsAgo(1_000 + 200_000, 1_000), "6 days ago");
  assert.equal(shortAddress("ABCDEFGHIJKLMNOP"), "ABCDE…LMNOP");
});

test("mapLimit keeps order and never exceeds the concurrency limit", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3);
});