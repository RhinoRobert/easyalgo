// Prices, candles and logos from Vestige's public API (MainNet only). This is optional decoration: every call can fail or time out and the pages work
// without it. Anything it returns is untrusted: numbers are checked, and a logo is used only if it is an https link on one of the hosts Vestige serves
// token images from (a token's creator controls that link, so it is never used as-is).
import { safeText } from "./format.js";

export const VESTIGE_API = "https://api.vestigelabs.org";
const LOGO_HOSTS = new Set(["ipfs.vestigelabs.org", "algorand-wallet-mainnet.b-cdn.net"]);
const BATCH = 50;
const TIMEOUT_MS = 8_000;

/** The logo link if it is safe to load, otherwise an empty string. */
export function safeLogoUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !LOGO_HOSTS.has(url.hostname) || url.href.length > 300) return "";
    return url.href;
  } catch {
    return "";
  }
}

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One asset row from `/assets/list`, reduced to what the site shows. */
export function parseAsset(row) {
  const price = finite(row?.price);
  const price1d = finite(row?.price1d);
  return {
    name: safeText(row?.name, 40),
    ticker: safeText(row?.ticker, 12),
    image: safeLogoUrl(row?.image),
    price,
    change1d: price !== null && price1d !== null && price1d > 0 ? (price / price1d - 1) * 100 : null,
    volume1d: finite(row?.volume1d), // in ALGO
    swaps1d: finite(row?.swaps1d),
  };
}

async function getJson(path, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${VESTIGE_API}${path}`, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`Vestige answered ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Market data and logos for several assets at once: a Map from asset id (string) to the parsed row. Never throws; a failure gives an empty Map. */
export async function fetchVestigeAssets(assetIds, fetchImpl = globalThis.fetch) {
  const result = new Map();
  if (typeof fetchImpl !== "function") return result;
  const ids = [...new Set(assetIds.map((id) => BigInt(id).toString()))];
  for (let index = 0; index < ids.length; index += BATCH) {
    const chunk = ids.slice(index, index + BATCH);
    try {
      const body = await getJson(`/assets/list?asset_ids=${chunk.join(",")}&limit=${BATCH}`, fetchImpl);
      for (const row of body?.results ?? []) {
        if (Number.isSafeInteger(row?.id)) result.set(String(row.id), parseAsset(row));
      }
    } catch { /* Vestige is optional */ }
  }
  return result;
}

/** Swap and liquidity rows of one asset since a time (unix seconds), newest first, with values in ALGO. Throws when Vestige cannot be reached. */
export async function fetchSwaps({ assetId, since, limit = 50, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("No network access");
  const body = await getJson(`/swaps?asset_id=${BigInt(assetId)}&start=${Math.max(0, Math.floor(since))}&limit=${limit}&denominating_asset_id=0`, fetchImpl);
  return Array.isArray(body?.results) ? body.results : [];
}

// Intervals are seconds; these are the ones the API accepts. "ALL" picks one from the token's age so a chart never has more than about 200 points.
export const CHART_RANGES = {
  "1D": { seconds: 86_400, interval: 900 },
  "7D": { seconds: 604_800, interval: 3_600 },
  "30D": { seconds: 2_592_000, interval: 14_400 },
  ALL: { seconds: null, interval: null },
};

export function rangeWindow(range, { launchTime, nowSeconds }) {
  const spec = CHART_RANGES[range] ?? CHART_RANGES["7D"];
  if (spec.seconds !== null) return { start: nowSeconds - spec.seconds, interval: spec.interval };
  const start = Math.max(0, Number(launchTime) - 3_600);
  const age = nowSeconds - start;
  const interval = age <= 2 * 86_400 ? 900 : age <= 14 * 86_400 ? 3_600 : age <= 90 * 86_400 ? 14_400 : 86_400;
  return { start, interval };
}

/** Price candles in ALGO, oldest first. Rows that are not plain finite numbers are dropped. Throws when Vestige cannot be reached. */
export async function fetchCandles({ assetId, range = "7D", launchTime = 0, nowSeconds = Math.floor(Date.now() / 1000), fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("No network access");
  const { start, interval } = rangeWindow(range, { launchTime, nowSeconds });
  const rows = await getJson(`/assets/${BigInt(assetId)}/candles?interval=${interval}&start=${Math.max(0, Math.floor(start))}&denominating_asset_id=0`, fetchImpl);
  if (!Array.isArray(rows)) return [];
  const candles = [];
  for (const row of rows) {
    const candle = { time: finite(row?.timestamp), open: finite(row?.open), high: finite(row?.high), low: finite(row?.low), close: finite(row?.close) };
    if (Object.values(candle).every((value) => value !== null) && candle.low > 0 && candle.high >= candle.low) candles.push(candle);
  }
  return candles.sort((a, b) => a.time - b.time);
}
