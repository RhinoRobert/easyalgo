// Books versus chain. The launchpad keeps its own records (pending launches, launch records, platform allocations, two counters). This compares
// them with what the contract's account really holds, so a mismatch (a bug, or an exploit that moves funds without leaving a record) shows up at
// once instead of being found later. Pure: the caller reads the chain and passes the data in. Anyone can send tokens to the contract, so holding
// MORE than the records need is fine and is shown as a surplus; holding LESS than they promise, or anything the records do not explain, is a failure.
const STATUS_COMPLETE = 2n;
const STATUS_CANCELLED = 3n;
const ALLOCATION_CANCELLED_ASA = 1n;
const ALLOCATION_PLATFORM_LP = 2n;

const sum = (values) => values.reduce((total, value) => total + value, 0n);
const held = (holdings, assetId) => holdings.get(BigInt(assetId)) ?? 0n;
const list = (ids) => ids.map(String).join(", ");

/**
 * Returns `{ ok, failing, rows }`. Each row is `{ id, title, status: "pass" | "fail", detail, expected?, actual? }`.
 *   holdings     Map of asset id to the amount the contract's account holds
 *   algo         `{ amount, minBalance }` of the contract's account, in microALGO
 *   globals      `{ reserved, platpnet }`: the contract's own counters for escrowed and deferred PNET
 *   pending      launches waiting for their second approval: `{ assetId, totalRaw, pnetOutput }`
 *   launches     finished and cancelled launch records as decoded by decodeLaunch
 *   allocations  platform allocations: `{ launchAssetId, holdingAssetId, remaining, kind }`
 */
export function reconcileBooks({ holdings, algo, globals, pending, launches, allocations, pnetAssetId }) {
  const pnet = BigInt(pnetAssetId);
  const finished = launches.filter((launch) => launch.status === STATUS_COMPLETE);
  const cancelled = launches.filter((launch) => launch.status === STATUS_CANCELLED);
  const remainingFor = (launchAssetId, kind) => sum(
    allocations.filter((entry) => entry.launchAssetId === launchAssetId && entry.kind === kind).map((entry) => entry.remaining),
  );
  const rows = [];
  const row = (id, title, problems, detail, extra = {}) => rows.push({
    id, title, status: problems.length === 0 ? "pass" : "fail", detail: problems.length === 0 ? detail : problems.join("; "), ...extra,
  });

  // 1-3 PNET: the contract's counters, the records behind them, and the PNET actually held
  const escrowRecorded = sum(pending.map((launch) => launch.pnetOutput));
  const reserved = globals.reserved ?? 0n;
  row("escrow-counter", "Escrowed PNET counter matches the in-progress launches",
    reserved === escrowRecorded ? [] : [`the counter says ${reserved} but the in-progress launches add up to ${escrowRecorded}`],
    "The counter and the launches agree.", { expected: escrowRecorded, actual: reserved });

  const deferredRecorded = sum(cancelled.map((launch) => launch.cancelPlatformPnetRemaining ?? 0n));
  const deferred = globals.platpnet ?? 0n;
  row("deferred-counter", "Deferred platform PNET counter matches the cancelled launches",
    deferred === deferredRecorded ? [] : [`the counter says ${deferred} but the cancelled launches add up to ${deferredRecorded}`],
    "The counter and the launches agree.", { expected: deferredRecorded, actual: deferred });

  const pnetOwed = reserved + deferred;
  const pnetHeld = held(holdings, pnet);
  row("pnet-held", "PNET held covers everything owed",
    pnetHeld >= pnetOwed ? [] : [`holds ${pnetHeld} but owes ${pnetOwed}: ${pnetOwed - pnetHeld} missing`],
    pnetHeld > pnetOwed ? `Holds ${pnetHeld - pnetOwed} more than owed (donations or rounding).` : "Holds exactly what is owed.",
    { expected: pnetOwed, actual: pnetHeld });

  // 4 tokens of launches still waiting for their second approval: the whole supply must still be here
  const short = pending.filter((launch) => held(holdings, launch.assetId) !== launch.totalRaw);
  row("pending-tokens", `The full supply of each in-progress launch is held (${pending.length})`,
    short.map((launch) => `asset ${launch.assetId}: holds ${held(holdings, launch.assetId)}, should hold ${launch.totalRaw}`),
    pending.length ? "Every in-progress launch's supply is intact." : "No launch is in progress.");

  // 5 cancelled launches: only the platform's recorded token half may remain
  const cancelledOff = cancelled.filter((launch) => held(holdings, launch.assetId) !== remainingFor(launch.assetId, ALLOCATION_CANCELLED_ASA));
  row("cancelled-tokens", `Cancelled launches hold only the platform's recorded half (${cancelled.length})`,
    cancelledOff.map((launch) => `asset ${launch.assetId}: holds ${held(holdings, launch.assetId)}, recorded ${remainingFor(launch.assetId, ALLOCATION_CANCELLED_ASA)}`),
    cancelled.length ? "Each cancelled launch holds exactly what is recorded." : "No cancelled launches.");

  // 6 finished launches: all of the supply went into the pool, so none may be left here
  const leftover = finished.filter((launch) => held(holdings, launch.assetId) !== 0n);
  row("finished-tokens", `Finished launches keep none of their supply (${finished.length})`,
    leftover.map((launch) => `asset ${launch.assetId}: still holds ${held(holdings, launch.assetId)}`),
    finished.length ? "All supply of every finished launch is in its pool." : "No finished launches.");

  // 7 liquidity tokens: the creators' unclaimed 10% plus the platform's recorded share must be there
  const lpShort = finished.filter((launch) => {
    const owed = (launch.creatorLpClaimed === 1n ? 0n : launch.creatorLp) + remainingFor(launch.assetId, ALLOCATION_PLATFORM_LP);
    return held(holdings, launch.lpAssetId) < owed;
  });
  const creatorsOwed = sum(finished.filter((launch) => launch.creatorLpClaimed !== 1n).map((launch) => launch.creatorLp));
  const platformOwed = sum(finished.map((launch) => remainingFor(launch.assetId, ALLOCATION_PLATFORM_LP)));
  row("liquidity-tokens", `Liquidity tokens held cover creators' unclaimed and the platform's shares (${finished.length})`,
    lpShort.map((launch) => `liquidity asset ${launch.lpAssetId} (launch ${launch.assetId}): holds ${held(holdings, launch.lpAssetId)}, owes ${(launch.creatorLpClaimed === 1n ? 0n : launch.creatorLp) + remainingFor(launch.assetId, ALLOCATION_PLATFORM_LP)}`),
    finished.length ? `Creators' unclaimed ${creatorsOwed} and platform's ${platformOwed} are all held.` : "No finished launches.",
    { expected: creatorsOwed + platformOwed, actual: sum(finished.map((launch) => held(holdings, launch.lpAssetId))) });

  // 8 every allocation must belong to a launch record
  const known = new Set(launches.map((launch) => launch.assetId));
  const orphans = allocations.filter((entry) => entry.remaining > 0n && !known.has(entry.launchAssetId));
  row("allocations", "Every platform allocation belongs to a launch record",
    orphans.map((entry) => `allocation for asset ${entry.launchAssetId} has no launch record`), "All allocations are explained.");

  // 9 ALGO: the account must be able to keep its minimum balance
  const algoFree = algo.amount - algo.minBalance;
  row("algo", "ALGO covers the minimum balance",
    algoFree >= 0n ? [] : [`${-algoFree} microALGO short of the minimum balance`], `${algoFree} microALGO free above the minimum.`,
    { expected: algo.minBalance, actual: algo.amount });

  // 10 nothing the records cannot explain
  const explained = new Set([pnet, ...pending.map((launch) => launch.assetId), ...launches.map((launch) => launch.assetId),
    ...finished.map((launch) => launch.lpAssetId)]);
  const strangers = [...holdings.entries()].filter(([id, amount]) => amount > 0n && !explained.has(id)).map(([id]) => id);
  row("unknown-assets", "Nothing is held that the records do not explain",
    strangers.length ? [`unrecognised asset${strangers.length > 1 ? "s" : ""} held: ${list(strangers)}`] : [], "Every asset held belongs to a record.");

  const failing = rows.filter((entry) => entry.status === "fail");
  return { ok: failing.length === 0, failing, rows };
}
