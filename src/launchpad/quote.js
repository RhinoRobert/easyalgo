import {
  CREATE_FUNDING,
  EXACT_ALGO_INPUT,
  QUOTE_MAX_AGE_MS,
  QUOTE_MAX_ROUNDS,
} from "./config.js";
import { integerSqrt, splitTokenSupply, splitUserLp } from "./amounts.js";

export const BPS = 10_000n;
export const MAX_IMPACT_BPS = 500n;
export const SLIPPAGE_BPS = 100n;

export const FIXED_COSTS = {
  assetAndDirectoryMbr: CREATE_FUNDING,
  creatorLpOptInMbr: 100_000n,
  launchpadLpOptInMbr: 100_000n,
  arc54LpOptInMbr: 100_000n,
  vestigeMbr: 100_000n,
  createGroupFees: 3_000n,
  swapGroupFees: 5_000n,
  finalizeGroupFees: 14_000n,
  vestigeGroupFees: 3_000n,
  safetyReserve: 250_000n,
};

function ceilDiv(value, divisor) {
  return (value + divisor - 1n) / divisor;
}

export function quoteFixedInput({ inputAmount, inputReserve, outputReserve, totalFeeShare }) {
  const input = BigInt(inputAmount);
  const reserveIn = BigInt(inputReserve);
  const reserveOut = BigInt(outputReserve);
  const feeShare = BigInt(totalFeeShare);
  if (input <= 0n || reserveIn <= 0n || reserveOut <= 0n) throw new Error("Tinyman source pool has no executable reserves");
  if (feeShare < 0n || feeShare >= BPS) throw new Error("Tinyman source pool fee is invalid");
  const feeAmount = input * feeShare / BPS;
  const effectiveInput = input - feeAmount;
  const remainingOutput = reserveIn * reserveOut / (reserveIn + effectiveInput);
  const expectedPnet = reserveOut - remainingOutput - 1n;
  if (expectedPnet <= 0n) throw new Error("Tinyman source pool returned no executable output");
  const minimumPnet = expectedPnet * (BPS - SLIPPAGE_BPS) / BPS;
  const idealNumerator = reserveOut * input;
  const actualNumerator = expectedPnet * reserveIn;
  const impactNumerator = idealNumerator > actualNumerator ? idealNumerator - actualNumerator : 0n;
  const priceImpactBps = ceilDiv(impactNumerator * BPS, idealNumerator);
  return { feeAmount, effectiveInput, expectedPnet, minimumPnet, priceImpactBps };
}

export function buildLaunchQuote({
  currentRound,
  totalRaw,
  sourcePoolState,
  tinymanBootstrapCost,
  now = Date.now(),
  costs = FIXED_COSTS,
}) {
  const swap = quoteFixedInput({
    inputAmount: EXACT_ALGO_INPUT,
    inputReserve: sourcePoolState.algoReserve,
    outputReserve: sourcePoolState.pnetReserve,
    totalFeeShare: sourcePoolState.totalFeeShare,
  });
  if (swap.priceImpactBps > MAX_IMPACT_BPS) {
    throw new Error("Tinyman source-pool price impact exceeds 5%");
  }
  const { tokenSeed } = splitTokenSupply(totalRaw);
  const issuedLp = integerSqrt(tokenSeed * swap.minimumPnet);
  const estimatedReceivedLp = issuedLp > 1_000n ? issuedLp - 1_000n : 0n;
  if (estimatedReceivedLp <= 0n) throw new Error("Initial liquidity would mint no usable LP units");
  const estimatedLpSplit = splitUserLp(estimatedReceivedLp);
  const itemizedAlgo = {
    pnetInput: EXACT_ALGO_INPUT,
    tinymanBootstrap: BigInt(tinymanBootstrapCost),
    ...costs,
  };
  const requiredWalletBalance = Object.values(itemizedAlgo).reduce(
    (sum, value) => sum + BigInt(value),
    0n,
  );
  return {
    createdAt: now,
    expiresAt: now + QUOTE_MAX_AGE_MS,
    createdRound: Number(currentRound),
    expiresRound: Number(currentRound) + QUOTE_MAX_ROUNDS,
    algoInput: EXACT_ALGO_INPUT,
    expectedPnet: swap.expectedPnet,
    minimumPnet: swap.minimumPnet,
    swapFeePnetBasis: swap.feeAmount,
    priceImpactBps: swap.priceImpactBps,
    priceImpactPct: Number(swap.priceImpactBps) / 100,
    tokenSeed,
    estimatedReceivedLp,
    estimatedLpSplit,
    itemizedAlgo,
    requiredWalletBalance,
  };
}

export function quoteIsExpired(quote, currentRound, now = Date.now()) {
  return !quote || now >= quote.expiresAt || Number(currentRound) > quote.expiresRound;
}
