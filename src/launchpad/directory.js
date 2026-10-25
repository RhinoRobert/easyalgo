// Read-only views over the launchpad's public chain data: recent launches, popular launches (by pool value), a wallet's own launches, and the
// operations snapshot. There is no backend: everything is read from the launchpad application's boxes, the launched assets and their Tinyman pools.
import algosdk from "algosdk";
import {
  ALLOCATION_TYPE,
  LAUNCH_TYPE,
  PENDING_TYPE,
  decodeLaunch,
  decodePending,
  launchBoxName,
  pendingBoxName,
  readBox,
  readGlobalState,
  readLaunchDirectory,
} from "./launchpadClient.js";
import { mapLimit, poolTvlMicroAlgo, safeText } from "./format.js";
import { quoteFixedInput } from "./quote.js";
import { reconcileBooks } from "./reconcile.js";
import { readTinymanPoolState, readTinymanSourcePool } from "./tinymanAdapter.js";

const CONCURRENCY = 8;
export const STATUS_COMPLETE = 2n;
export const STATUS_CANCELLED = 3n;
const LAUNCH_START_SELECTOR = toHex(algosdk.ABIMethod.fromSignature("launch_start(pay,string,string,uint64,string,uint64,uint64)uint64").getSelector());

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function clearDirectoryCache() {
  cache.clear();
}

async function readAssetMeta(algodClient, assetId) {
  try {
    const info = await algodClient.getAssetByID(Number(assetId)).do();
    const params = info.params;
    return {
      name: safeText(params.name, 40) || `Asset ${assetId}`,
      unit: safeText(params.unitName ?? params["unit-name"], 12),
      url: safeText(params.url, 96),
      total: BigInt(params.total),
    };
  } catch {
    return { name: `Asset ${assetId}`, unit: "", url: "", total: 0n };
  }
}

/** One launch record joined with its token details and (for finished launches) the pool's current value. */
async function describeLaunch({ algodClient, config, record, source }) {
  const meta = await readAssetMeta(algodClient, record.assetId);
  let pool = null;
  let tvlMicroAlgo = 0n;
  if (record.status === STATUS_COMPLETE && record.poolAddress) {
    try {
      pool = await readTinymanPoolState({ algodClient, poolAddress: record.poolAddress, tinymanAppId: config.tinymanAppId });
      tvlMicroAlgo = poolTvlMicroAlgo({
        pnetReserve: pool.asset2Reserve,
        sourceAlgoReserve: source.algoReserve,
        sourcePnetReserve: source.pnetReserve,
      });
    } catch {
      pool = null;
    }
  }
  return { ...record, ...meta, pool, tvlMicroAlgo };
}

async function readSource(algodClient, config) {
  return readTinymanSourcePool({
    algodClient, sourcePool: config.sourcePool, tinymanAppId: config.tinymanAppId, pnetAssetId: config.pnetAssetId,
  });
}

const DIRECTORY_PAGE = 100;

/** The newest `limit` directory records, oldest first, read in pages (one chain read allows at most 100). Returns `{ total, records }`. */
export async function readRecentRecords({ algodClient, config, limit }) {
  const globals = await readGlobalState(algodClient, config.launchpadAppId);
  const total = globals.total ?? 0n;
  const start = total > BigInt(limit) ? total - BigInt(limit) : 0n;
  const records = [];
  for (let cursor = start; cursor < total; cursor += BigInt(DIRECTORY_PAGE)) {
    const page = Math.min(DIRECTORY_PAGE, Number(total - cursor));
    const result = await readLaunchDirectory({ algodClient, config, cursor, limit: page });
    records.push(...result.records);
  }
  return { total, records };
}
/** The newest `limit` launches (finished and cancelled), newest first, each with its pool value. Cached for 45 s. */
export async function loadRecentLaunches({ algodClient, config, limit = 20 }) {
  return cached(`recent:${limit}`, 45_000, async () => {
    const [{ total, records }, source, status] = await Promise.all([
      readRecentRecords({ algodClient, config, limit }),
      readSource(algodClient, config),
      algodClient.status().do(),
    ]);
    const items = await mapLimit([...records].reverse(), CONCURRENCY, (record) => describeLaunch({ algodClient, config, record, source }));
    return { total, round: Number(status.lastRound ?? status["last-round"] ?? 0), items };
  });
}

/** The most valuable finished launches among the newest `scan`, ranked by pool value (both sides, in ALGO). */
export async function loadPopularLaunches({ algodClient, config, scan = 100, top = 20 }) {
  return cached(`popular:${scan}:${top}`, 60_000, async () => {
    const recent = await loadRecentLaunches({ algodClient, config, limit: scan });
    const ranked = recent.items
      .filter((item) => item.status === STATUS_COMPLETE && item.pool)
      .sort((a, b) => (a.tvlMicroAlgo === b.tvlMicroAlgo ? 0 : a.tvlMicroAlgo > b.tvlMicroAlgo ? -1 : 1))
      .slice(0, top);
    return { total: recent.total, round: recent.round, scanned: recent.items.length, items: ranked };
  });
}

/** Every launch a wallet started: the unfinished one (if any) and its finished or cancelled records, newest first. */
export async function loadMyLaunches({ algodClient, indexerClient, config, wallet }) {
  const source = await readSource(algodClient, config);
  const pendingValues = await readBox(algodClient, config.launchpadAppId, pendingBoxName(wallet), PENDING_TYPE);
  const pending = decodePending(pendingValues);
  const response = await indexerClient
    .searchForTransactions()
    .address(wallet)
    .applicationID(Number(config.launchpadAppId))
    .txType("appl")
    .limit(200)
    .do();
  const assetIds = new Set();
  for (const txn of response.transactions ?? []) {
    const args = txn.applicationTransaction?.applicationArgs ?? [];
    if (!args.length || toHex(args[0]) !== LAUNCH_START_SELECTOR) continue;
    for (const inner of txn.innerTxns ?? []) if (inner.createdAssetIndex) assetIds.add(BigInt(inner.createdAssetIndex));
  }
  if (pending) assetIds.add(pending.assetId);
  const items = await mapLimit([...assetIds], CONCURRENCY, async (assetId) => {
    const values = await readBox(algodClient, config.launchpadAppId, launchBoxName(assetId), LAUNCH_TYPE);
    const record = decodeLaunch(values);
    if (record) return describeLaunch({ algodClient, config, record, source });
    // not finished or cancelled: it is the wallet's pending launch
    const meta = await readAssetMeta(algodClient, assetId);
    return { assetId, status: 1n, launcher: wallet, ...meta, pool: null, tvlMicroAlgo: 0n, swapRound: pending?.swapRound ?? 0n, pnetSeed: pending?.pnetOutput ?? 0n, pending: true };
  });
  items.sort((a, b) => (a.assetId === b.assetId ? 0 : a.assetId > b.assetId ? -1 : 1));
  const status = await algodClient.status().do();
  return { round: Number(status.lastRound ?? status["last-round"] ?? 0), items, pending };
}

/**
 * How many tokens fully launched (a pool exists): every record the launchpad holds except the cancelled ones. Only the newest launches are read, so
 * cancelled launches older than that window would still be counted; at today's size that window covers everything.
 */
export function countLaunched(total, items) {
  const cancelled = items.filter((item) => item.status === STATUS_CANCELLED).length;
  const launched = BigInt(total) - BigInt(cancelled);
  return launched > 0n ? launched : 0n;
}

/**
 * The headline numbers for the launch page. Tokens launched = launches that reached a live Tinyman pool; cancelled launches and ones still waiting for
 * their second approval are not counted. The king is the launch whose pool is worth the most right now (both sides, in ALGO) among the newest `scan`
 * launches. Cached for 60 s. Reads grow with the number of launches, so past a few hundred this should move to a scheduled snapshot.
 */
export async function loadHillStats({ algodClient, config, scan = 200 }) {
  return cached(`hill:${scan}`, 60_000, async () => {
    const recent = await loadRecentLaunches({ algodClient, config, limit: scan });
    const popular = await loadPopularLaunches({ algodClient, config, scan, top: 2 }); // reads the same cached scan
    return {
      tokensLaunched: countLaunched(recent.total, recent.items),
      king: popular.items[0] ?? null,
      runnerUp: popular.items[1] ?? null,
      round: popular.round,
    };
  });
}
/** Everything the operations tab shows: contract balances and counters, the source pool's depth, stuck launches and what the platform is owed. */
export async function loadOperations({ algodClient, config }) {
  const appAddress = algosdk.getApplicationAddress(Number(config.launchpadAppId)).toString();
  const [globals, account, source, status, boxes] = await Promise.all([
    readGlobalState(algodClient, config.launchpadAppId),
    algodClient.accountInformation(appAddress).do(),
    readSource(algodClient, config),
    algodClient.status().do(),
    algodClient.getApplicationBoxes(Number(config.launchpadAppId)).do(),
  ]);
  const round = Number(status.lastRound ?? status["last-round"] ?? 0);
  const holdings = new Map((account.assets ?? []).map((item) => [BigInt(item.assetId ?? item["asset-id"]), BigInt(item.amount)]));
  const boxNames = (boxes.boxes ?? []).map((box) => box.name);
  const pendingNames = boxNames.filter((name) => String.fromCharCode(name[0]) === "p" && name.length === 33);
  const allocationNames = boxNames.filter((name) => String.fromCharCode(name[0]) === "a" && name.length === 9);

  const pendingLaunches = (await mapLimit(pendingNames, CONCURRENCY, async (name) => {
    const values = await readBox(algodClient, config.launchpadAppId, name, PENDING_TYPE);
    const record = decodePending(values);
    if (!record) return null;
    return { launcher: algosdk.encodeAddress(name.slice(1)), assetId: record.assetId, totalRaw: record.totalRaw, swapRound: record.swapRound, pnetOutput: record.pnetOutput };
  })).filter(Boolean);

  // every finished or cancelled launch record ("l" + asset id), for checking the books against what the account holds
  const launchNames = boxNames.filter((name) => String.fromCharCode(name[0]) === "l" && name.length === 9);
  const launchRecords = (await mapLimit(launchNames, CONCURRENCY, async (name) => decodeLaunch(await readBox(algodClient, config.launchpadAppId, name, LAUNCH_TYPE))))
    .filter(Boolean);

  const allocations = (await mapLimit(allocationNames, CONCURRENCY, async (name) => {
    const values = await readBox(algodClient, config.launchpadAppId, name, ALLOCATION_TYPE);
    if (!values) return null;
    const launchAssetId = BigInt(values[0]);
    return { launchAssetId, holdingAssetId: BigInt(values[1]), remaining: BigInt(values[2]), kind: BigInt(values[3]), meta: await readAssetMeta(algodClient, launchAssetId) };
  })).filter((item) => item && item.remaining > 0n);

  const oneAlgoSwap = quoteFixedInput({
    inputAmount: 1_000_000n, inputReserve: source.algoReserve, outputReserve: source.pnetReserve, totalFeeShare: source.totalFeeShare,
  });
  const freeMicroAlgo = BigInt(account.amount) - BigInt(account.minBalance ?? account["min-balance"] ?? 0);
  const deferredPnet = globals.platpnet ?? 0n;
  const alerts = [];
  if (freeMicroAlgo < 300_000n) alerts.push(`The app's free balance is ${freeMicroAlgo} microALGO, below its 0.3 ALGO cushion.`);
  if (oneAlgoSwap.priceImpactBps > 200n) alerts.push(`The source pool is getting thin: one ALGO now moves its price by ${Number(oneAlgoSwap.priceImpactBps) / 100}% (launches are refused above 5%).`);
  const stuck = pendingLaunches.filter((launch) => BigInt(round) - launch.swapRound > BigInt(globals.delay ?? 3000n));
  if (stuck.length) alerts.push(`${stuck.length} launch(es) have been pending longer than the cancel delay.`);
  if (deferredPnet > 0n) alerts.push("PNET is owed to the platform from cancelled launches (use Release deferred PNET).");
  const books = reconcileBooks({
    holdings,
    algo: { amount: BigInt(account.amount), minBalance: BigInt(account.minBalance ?? account["min-balance"] ?? 0) },
    globals: { reserved: globals.reserved ?? 0n, platpnet: deferredPnet },
    pending: pendingLaunches, launches: launchRecords, allocations, pnetAssetId: config.pnetAssetId,
  });
  for (const failure of books.failing) alerts.push(`The contract's books do not match the chain: ${failure.title}. ${failure.detail}`);
  return {
    books,
    round,
    appAddress,
    appBalanceMicroAlgo: BigInt(account.amount),
    freeMicroAlgo,
    pnetHeld: holdings.get(BigInt(config.pnetAssetId)) ?? 0n,
    totalLaunches: globals.total ?? 0n,
    initialized: globals.init === 1n,
    cancelDelay: globals.delay ?? 0n,
    reservedPnet: globals.reserved ?? 0n,
    deferredPnet,
    source,
    oneAlgoSwap,
    pendingLaunches,
    allocations,
    alerts,
  };
}

/** Finished or cancelled launches in the newest `scan` whose cancellation left PNET owed to the platform. */
export async function loadDeferredPnetLaunches({ algodClient, config, scan = 100 }) {
  const recent = await loadRecentLaunches({ algodClient, config, limit: scan });
  return recent.items.filter((item) => item.status === STATUS_CANCELLED && item.cancelPlatformPnetRemaining > 0n);
}
