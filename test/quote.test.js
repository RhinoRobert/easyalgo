import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunchQuote, estimatedLaunchCost, quoteFixedInput, quoteIsExpired } from "../src/launchpad/quote.js";

const sourcePoolState = {
  algoReserve: 844_474_148n,
  pnetReserve: 14_660_119_130_454n,
  totalFeeShare: 36n,
};

test("Tinyman fixed-input quote matches contract integer arithmetic", () => {
  const quote = quoteFixedInput({
    inputAmount: 1_000_000n,
    inputReserve: sourcePoolState.algoReserve,
    outputReserve: sourcePoolState.pnetReserve,
    totalFeeShare: sourcePoolState.totalFeeShare,
  });
  assert.equal(quote.expectedPnet, 17_277_175_102n);
  assert.equal(quote.minimumPnet, 17_104_403_350n);
  assert.equal(quote.priceImpactBps, 48n);
});

test("launch quote uses full supply and conserves estimated LP", () => {
  const quote = buildLaunchQuote({
    currentRound: 100,
    totalRaw: 1_000_001n,
    sourcePoolState,
    tinymanBootstrapCost: 1_050_000n,
    now: 1_000,
  });
  assert.equal(quote.tokenSeed, 1_000_001n);
  const split = quote.estimatedLpSplit;
  assert.equal(split.burnedLp + split.creatorLp + split.platformLp, quote.estimatedReceivedLp);
  assert.equal(split.platformLp - split.creatorLp <= 1n, true);
  assert.equal(quoteIsExpired(quote, 140, 109_999), false);
  assert.equal(quoteIsExpired(quote, 141, 109_999), true);
  assert.equal(quoteIsExpired(quote, 100, 111_000), true);
});

test("quote blocks source pools above five percent impact", () => {
  assert.throws(() => buildLaunchQuote({
    currentRound: 1,
    totalRaw: 1_000_000n,
    sourcePoolState: { algoReserve: 2_000_000n, pnetReserve: 10_000_000n, totalFeeShare: 30n },
    tinymanBootstrapCost: 1n,
  }), /exceeds 5%/);
});

test("supplies below one whole token are refused before anything is built", () => {
  assert.throws(() => buildLaunchQuote({ currentRound: 1, totalRaw: 999_999n, sourcePoolState, tinymanBootstrapCost: 1n }), /at least 1 whole token/);
});

test("the cost shown next to the Launch button is the real quote's total minus its cushion", () => {
  const quote = buildLaunchQuote({
    currentRound: 100, totalRaw: 1_000_000_000_000n, sourcePoolState, tinymanBootstrapCost: 1_057_000n, now: 1_000,
  });
  const cost = estimatedLaunchCost();
  assert.equal(cost.keepAvailable, quote.requiredWalletBalance);
  assert.equal(cost.spent, quote.requiredWalletBalance - quote.itemizedAlgo.safetyReserve);
  assert.ok(cost.spent > 2_500_000n && cost.spent < 3_000_000n, `about 2.7 ALGO, got ${cost.spent}`);
});