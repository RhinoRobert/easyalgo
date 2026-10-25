import {
  ARC54_LP_HOLDING_MBR,
  EXACT_ALGO_INPUT,
  LAUNCH_START_FUNDING,
  LP_HOLDING_MBR,
  MIN_SUPPLY_RAW,
  QUOTE_MAX_AGE_MS,
  QUOTE_MAX_ROUNDS,
  SAFETY_RESERVE,
  VESTIGE_FUNDING,
} from "./config.js";
import { integerSqrt, splitTokenSupply, splitUserLp } from "./amounts.js";
import { FINISH_BASE_FEE, START_FEE } from "./launchpadClient.js";

export const BPS = 10_000n;
export const MAX_IMPACT_BPS = 500n;
export const SLIPPAGE_BPS = 100n;

// Everything the wallet must hold for the two approvals, apart from the 1 ALGO swap and the Tinyman pool bootstrap
// (which the quote adds from the Tinyman helper). Deposits are prepaid so a launch never draws on the app's own balance;
// 0.0669 ALGO of the first deposit comes straight back when the launch completes.
export const FIXED_COSTS = {
  tokenAndRecordDeposits: LAUNCH_START_FUNDING - EXACT_ALGO_INPUT,
  lpHoldingDeposit: LP_HOLDING_MBR,
  arc54LpDeposit: ARC54_LP_HOLDING_MBR,
  vestigeDeposit: VESTIGE_FUNDING,
  startGroupFees: 1_000n + START_FEE,
  finishGroupFees: 2_000n + FINISH_BASE_FEE + 3_000n + 2_000n + 1_000n,
  safetyReserve: SAFETY_RESERVE,
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
  if (BigInt(totalRaw) < MIN_SUPPLY_RAW) throw new Error("Supply must be at least 1 whole token: Tinyman cannot take a smaller first deposit");
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
