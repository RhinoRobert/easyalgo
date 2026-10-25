// How launching is going, worked out from the chain's own records alone (no tracking of visitors): how many launches start, how many finish, cancel or stall,
// how many wallets come back, and how many launches there were each day. Pure: the caller passes the records in.
const STATUS_COMPLETE = 2n;
const STATUS_CANCELLED = 3n;
export const SECONDS_PER_ROUND = 2.8;
export const ROUNDS_PER_DAY = Math.round(86_400 / SECONDS_PER_ROUND);

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 *   launches   finished and cancelled records (decodeLaunch): launcher, status, createdRound, swapRound, terminalRound
 *   pending    launches waiting for their second approval: launcher, createdRound, swapRound
 *   round      the current round
 *   cancelDelay  rounds after which a waiting launch counts as stalled (it can be cancelled)
 */
export function summarizeFunnel({ launches, pending, round, cancelDelay = 3000n, days = 7 }) {
  const now = BigInt(round);
  const finished = launches.filter((launch) => launch.status === STATUS_COMPLETE);
  const cancelled = launches.filter((launch) => launch.status === STATUS_CANCELLED);
  const stalled = pending.filter((launch) => now - BigInt(launch.swapRound) > BigInt(cancelDelay));
  const waiting = pending.length - stalled.length;
  const started = launches.length + pending.length;

  const perLauncher = new Map();
  for (const entry of [...launches, ...pending]) perLauncher.set(entry.launcher, (perLauncher.get(entry.launcher) ?? 0) + 1);

  // Of the launches that reached an outcome (finished, cancelled, or stuck past the cancel delay), the share that finished
  const decided = finished.length + cancelled.length + stalled.length;
  const gaps = finished
    .filter((launch) => launch.terminalRound >= launch.swapRound)
    .map((launch) => Number(launch.terminalRound - launch.swapRound) * SECONDS_PER_ROUND);

  const perDay = Array.from({ length: days }, (_, daysAgo) => ({ daysAgo, started: 0 }));
  for (const entry of [...launches, ...pending]) {
    const age = Number(now - BigInt(entry.createdRound));
    const bucket = Math.floor(Math.max(age, 0) / ROUNDS_PER_DAY);
    if (bucket < days) perDay[bucket].started += 1;
  }

  return {
    started,
    finished: finished.length,
    cancelled: cancelled.length,
    waiting,
    stalled: stalled.length,
    completionRate: decided ? finished.length / decided : null,
    launchers: perLauncher.size,
    repeatLaunchers: [...perLauncher.values()].filter((count) => count >= 2).length,
    medianSecondsBetweenApprovals: median(gaps),
    perDay,
  };
}
