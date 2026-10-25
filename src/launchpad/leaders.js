// Rankings and creator summaries from the launch list the directory already loads (items from loadRecentLaunches). Pure and tested; only finished
// launches count towards a ranking, because a cancelled one never had a pool.
import { ROUNDS_PER_DAY } from "./funnel.js";

const FINISHED = 2n;
const CANCELLED = 3n;
const tvl = (item) => item.tvlMicroAlgo ?? 0n;
const byBigDesc = (key) => (a, b) => (key(b) === key(a) ? 0 : key(b) > key(a) ? 1 : -1);

export const finishedLaunches = (items) => items.filter((item) => item.status === FINISHED && item.pool);

/** The biggest pools right now, biggest first. */
export const biggestPools = (items, limit = 20) => finishedLaunches(items).sort(byBigDesc(tvl)).slice(0, limit);

/** Launches that went live in the last `days` days, ranked by pool value. */
export function biggestThisWeek(items, round, days = 7, limit = 20) {
  const since = BigInt(round) - BigInt(days * ROUNDS_PER_DAY);
  return finishedLaunches(items).filter((item) => item.terminalRound >= since).sort(byBigDesc(tvl)).slice(0, limit);
}

/** Wallets ranked by how many launches went live, then by what their pools hold together. */
export function topCreators(items, limit = 20) {
  const byWallet = new Map();
  for (const item of finishedLaunches(items)) {
    const entry = byWallet.get(item.launcher) ?? { address: item.launcher, launched: 0, totalPool: 0n, best: null };
    entry.launched += 1;
    entry.totalPool += tvl(item);
    if (!entry.best || tvl(item) > tvl(entry.best)) entry.best = item;
    byWallet.set(item.launcher, entry);
  }
  return [...byWallet.values()]
    .sort((a, b) => b.launched - a.launched || byBigDesc((entry) => entry.totalPool)(a, b))
    .slice(0, limit);
}

/** Everything about one wallet's launches: its live tokens (newest first), how many were cancelled and what their pools hold together. */
export function creatorSummary(items, address) {
  const mine = items.filter((item) => item.launcher === address);
  const live = finishedLaunches(mine).sort(byBigDesc((item) => item.assetId));
  return {
    address,
    live,
    launched: live.length,
    cancelled: mine.filter((item) => item.status === CANCELLED).length,
    totalPool: live.reduce((sum, item) => sum + tvl(item), 0n),
    best: live.reduce((best, item) => (!best || tvl(item) > tvl(best) ? item : best), null),
  };
}
