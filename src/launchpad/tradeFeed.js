// Live trade alerts. Every swap is public, so each visitor's browser watches the launched tokens itself (there is no server): one cheap request now
// and then for the prices of up to 50 tokens, and a closer look at a token's swaps when its price moves (Vestige's own swap counters lag behind the
// trades, so they are not used to notice them). Nothing is shown for trades from before the page was opened or the tab came back into view. Swap rows
// come from Vestige and are untrusted: only plain numbers are used.
import { fetchSwaps } from "./vestigeApi.js";

export const MIN_TRADE_ALGO = 0.01;
export const POLL_MS = 20_000;
export const MAX_WATCHED = 50; // Vestige answers for up to 50 tokens in one request
const LOOKBACK_SECONDS = 15;
const MAX_LOOKUPS_PER_POLL = 8;
const HOT_POLLS = 4; // a token whose price moved is looked at again for this many polls, because its trade can reach the swap list a little later
const TOAST_BATCH = 3;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * One Vestige swap row as a trade of `assetId`, or null when it is not a trade of that token: a liquidity change moves both sides the same way (or not at
 * all). Deltas are from the pool's side: when the pool pays the token out and takes the other asset in, the trader bought; when it takes the token in,
 * the trader sold. (Checked against real transactions: the trader receives the token exactly when the token's delta is negative.)
 */
export function classifySwap(row, assetId) {
  const id = Number(assetId);
  const first = row?.asset_1_id === id;
  if (!first && row?.asset_2_id !== id) return null;
  const delta = num(first ? row.asset_1_delta : row.asset_2_delta);
  const other = num(first ? row.asset_2_delta : row.asset_1_delta);
  const value = num(Number(first ? row.asset_1_delta_value : row.asset_2_delta_value));
  const time = num(row?.timestamp);
  if (delta === null || other === null || value === null || time === null || !(delta * other < 0)) return null;
  const algo = Math.abs(value);
  if (algo < MIN_TRADE_ALGO) return null;
  return {
    key: `${row.group}:${row.asset_1_id}:${row.asset_2_id}:${row.offset}`,
    assetId: String(id),
    side: delta < 0 ? "buy" : "sell",
    algo,
    address: typeof row.address === "string" ? row.address : "",
    time,
  };
}

/**
 * Tokens that look like they traded since the last look: their price moved (largest move first), or their 24 h swap count rose. Tokens not seen before are
 * ignored, since that is just the first look at them. A price can also move when PNET's own price moves, which only costs a look at that token's swaps.
 */
export function changedAssets(previous, current) {
  const changed = [];
  for (const [id, row] of current) {
    const before = previous.get(id);
    if (!before) continue;
    const move = row.price !== null && before.price !== null && before.price > 0 ? Math.abs(row.price / before.price - 1) : 0;
    const counted = row.swaps1d !== null && before.swaps1d !== null && row.swaps1d > before.swaps1d;
    if (move > 1e-9 || counted) changed.push({ id, move });
  }
  return changed.sort((a, b) => b.move - a.move).map((entry) => entry.id);
}

/**
 * The new trades since `sinceSeconds` (when watching began). `seen` holds the keys already shown so none repeats. `hot` remembers tokens that just changed
 * so they are looked at again on the next polls: Vestige can list a trade a little after the price has moved, and by then it is no longer "new" by
 * the clock, which is why only the start of watching (not the last poll) decides what is too old. At most a few tokens are looked up per poll, and one
 * token failing does not stop the rest.
 */
export async function collectNewTrades({ previous, current, sinceSeconds, seen, hot = new Map(), fetchImpl }) {
  for (const id of changedAssets(previous, current)) hot.set(id, HOT_POLLS);
  const trades = [];
  for (const id of [...hot.keys()].slice(0, MAX_LOOKUPS_PER_POLL)) {
    hot.set(id, hot.get(id) - 1);
    if (hot.get(id) <= 0) hot.delete(id);
    let rows;
    try { rows = await fetchSwaps({ assetId: id, since: sinceSeconds - LOOKBACK_SECONDS, fetchImpl }); } catch { continue; }
    for (const row of rows) {
      const trade = classifySwap(row, id);
      if (!trade || seen.has(trade.key) || trade.time < sinceSeconds - LOOKBACK_SECONDS) continue;
      seen.add(trade.key);
      trades.push({ ...trade, name: current.get(id)?.name || "a token", ticker: current.get(id)?.ticker || "", image: current.get(id)?.image || "" });
    }
  }
  return trades.sort((a, b) => a.time - b.time);
}

/**
 * What to show next from a queue of trades: the oldest trade on its own, or, when several are waiting, one summary so a busy moment never turns into a
 * stream of popups. Returns `{ toast, rest }`.
 */
export function nextToast(queue) {
  if (!queue.length) return { toast: null, rest: [] };
  if (queue.length >= TOAST_BATCH) {
    const tokens = new Set(queue.map((trade) => trade.assetId));
    const only = tokens.size === 1 ? queue[0] : null;
    return { toast: { kind: "summary", count: queue.length, tokens: tokens.size, assetId: only?.assetId ?? null, name: only?.name ?? "", key: `summary:${queue.at(-1).key}` }, rest: [] };
  }
  return { toast: { kind: "trade", ...queue[0] }, rest: queue.slice(1) };
}

export const formatAlgo = (value) => (value >= 100 ? value.toFixed(0) : value >= 1 ? value.toFixed(2) : value.toFixed(3));
