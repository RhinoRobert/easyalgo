export const UINT64_MAX = 18_446_744_073_709_551_615n;
export const ASA_SCALE = 1_000_000n;
export const BPS = 10_000n;

export function parseDisplaySupply(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) {
    throw new Error("Supply must be a positive number with at most six decimal places");
  }
  const [whole, fraction = ""] = text.split(".");
  const raw = BigInt(whole) * ASA_SCALE + BigInt((fraction + "000000").slice(0, 6));
  if (raw < 2_000n) throw new Error("Supply is too small for Tinyman initial liquidity");
  if (raw > UINT64_MAX) throw new Error("Supply exceeds Algorand uint64 limits");
  return raw;
}

export function parseAlgo(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) {
    throw new Error("ALGO amount must have at most six decimal places");
  }
  const [whole, fraction = ""] = text.split(".");
  const microAlgos = BigInt(whole) * ASA_SCALE + BigInt((fraction + "000000").slice(0, 6));
  if (microAlgos < ASA_SCALE) throw new Error("At least 1 ALGO is required");
  if (microAlgos > UINT64_MAX) throw new Error("ALGO amount exceeds uint64 limits");
  return microAlgos;
}

export function splitTokenSupply(totalRaw) {
  return { tokenSeed: BigInt(totalRaw), creatorTokens: 0n };
}

export function splitUserLp(userReceivedLp) {
  const received = BigInt(userReceivedLp);
  const burnedLp = received * 8_000n / BPS;
  const remainder = received - burnedLp;
  const creatorLp = remainder / 2n;
  return { burnedLp, creatorLp, platformLp: remainder - creatorLp };
}

export function integerSqrt(value) {
  const n = BigInt(value);
  if (n < 0n) throw new Error("Cannot take square root of a negative integer");
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length) + 1n >> 1n);
  let next = (x + n / x) >> 1n;
  while (next < x) { x = next; next = (x + n / x) >> 1n; }
  return x;
}

export function formatUnits(raw, decimals = 6) {
  const value = BigInt(raw ?? 0);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

