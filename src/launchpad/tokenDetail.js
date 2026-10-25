// Everything the token page shows, read from the chain: the launchpad's record, the token's parameters, the pool, the burn account and the holders.
import algosdk from "algosdk";
import { LAUNCH_TYPE, decodeLaunch, launchBoxName, readBox } from "./launchpadClient.js";
import { PLATFORM_WALLET } from "./config.js";
import { safeText } from "./format.js";
import { poolAddress, readTinymanPoolState, readTinymanSourcePool } from "./tinymanAdapter.js";
import { buildSafetyChecks, rankHolders, tokenStats } from "./tokenView.js";

const HOLDER_PAGES = 3;

async function holdingOf(algodClient, address, assetId) {
  try {
    const response = await algodClient.accountAssetInformation(address, Number(assetId)).do();
    return BigInt(response.assetHolding?.amount ?? 0n);
  } catch (error) {
    const status = error?.status ?? error?.response?.status;
    if (status === 404 || /not found|no asset/i.test(String(error?.message))) return 0n;
    throw error;
  }
}

async function readHolders({ indexerClient, assetId }) {
  const balances = [];
  let next;
  for (let page = 0; page < HOLDER_PAGES; page += 1) {
    let request = indexerClient.lookupAssetBalances(Number(assetId)).limit(1000);
    if (next) request = request.nextToken(next);
    const response = await request.do();
    balances.push(...(response.balances ?? []));
    next = response.nextToken;
    if (!next) return { balances, complete: true };
  }
  return { balances, complete: false };
}

/** Returns `{ found: false }` when the launchpad has no record for the asset, otherwise the data for the token page. */
export async function loadTokenDetail({ algodClient, indexerClient, config, assetId }) {
  const id = BigInt(assetId);
  const launch = decodeLaunch(await readBox(algodClient, config.launchpadAppId, launchBoxName(id), LAUNCH_TYPE));
  if (!launch) return { found: false, assetId: id };

  const appAddress = algosdk.getApplicationAddress(Number(config.launchpadAppId)).toString();
  const burnAddress = algosdk.getApplicationAddress(Number(config.arc54AppId)).toString();
  const info = await algodClient.getAssetByID(Number(id)).do();
  const params = info.params;
  const asset = {
    name: safeText(params.name, 40) || `Asset ${id}`,
    unit: safeText(params.unitName, 12),
    url: safeText(params.url, 96),
    total: BigInt(params.total),
    decimals: Number(params.decimals ?? 0),
    creator: params.creator,
    manager: params.manager, reserve: params.reserve, freeze: params.freeze, clawback: params.clawback,
  };

  const finished = launch.status === 2n && Boolean(launch.poolAddress);
  const [status, appTokenHolding] = await Promise.all([algodClient.status().do(), holdingOf(algodClient, appAddress, id)]);
  const round = Number(status.lastRound ?? status["last-round"] ?? 0);

  let pool = null;
  let stats = null;
  let burnHolding = 0n;
  let holders = { rows: [], complete: true };
  if (finished) {
    const [poolState, source, burned, balances] = await Promise.all([
      readTinymanPoolState({ algodClient, poolAddress: launch.poolAddress, tinymanAppId: config.tinymanAppId }),
      readTinymanSourcePool({ algodClient, sourcePool: config.sourcePool, tinymanAppId: config.tinymanAppId, pnetAssetId: config.pnetAssetId }),
      holdingOf(algodClient, burnAddress, launch.lpAssetId),
      readHolders({ indexerClient, assetId: id }).catch(() => null),
    ]);
    pool = poolState;
    burnHolding = burned;
    stats = tokenStats({ assetId: id, total: asset.total, decimals: asset.decimals, pool, source });
    if (balances) {
      const labels = { [launch.poolAddress]: "Tinyman pool", [appAddress]: "Launchpad contract", [PLATFORM_WALLET]: "Platform wallet", [launch.launcher]: "Creator" };
      holders = { rows: rankHolders({ balances: balances.balances, total: asset.total, labels }), complete: balances.complete };
    } else {
      holders = { rows: null, complete: false };
    }
  }

  const poolIsCanonical = finished
    && poolAddress(config.tinymanAppId, id, config.pnetAssetId).toString() === launch.poolAddress;
  const checks = buildSafetyChecks({ asset, launch, appAddress, appTokenHolding, poolIsCanonical, burnHolding });
  return { found: true, assetId: id, launch, asset, pool, stats, holders, checks, round, appAddress, burnAddress };
}
