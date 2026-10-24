import {
  Bootstrap,
  poolUtils,
  tinymanJSSDKConfig,
} from "@tinymanorg/tinyman-js-sdk";
import { simulateSignedGroup } from "./simulation.js";

tinymanJSSDKConfig.setClientName("algoflow-pnet-launchpad-v2");

const decoder = new TextDecoder();

export function asSafeAssetId(value, label = "asset ID") {
  const id = BigInt(value);
  if (id <= 0n || id > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} cannot be represented safely by the Tinyman SDK`);
  }
  return Number(id);
}

function stateKeyText(key) {
  if (key instanceof Uint8Array) return decoder.decode(key);
  if (typeof key === "string") {
    try { return decoder.decode(Uint8Array.from(atob(key), (char) => char.charCodeAt(0))); }
    catch { return key; }
  }
  return String(key);
}

function uintValue(value) {
  return BigInt(value?.uint ?? value?.value?.uint ?? 0);
}

export function decodeTinymanLocalState(accountInfo, tinymanAppId) {
  const states = accountInfo.appsLocalState ?? accountInfo["apps-local-state"] ?? [];
  const target = states.find((entry) => BigInt(entry.id) === BigInt(tinymanAppId));
  if (!target) throw new Error("Account is not a Tinyman v2 pool");
  const values = {};
  for (const item of target.keyValue ?? target["key-value"] ?? []) {
    values[stateKeyText(item.key)] = uintValue(item.value);
  }
  return values;
}

export async function readTinymanSourcePool({ algodClient, sourcePool, tinymanAppId, pnetAssetId }) {
  const account = await algodClient.accountInformation(sourcePool).do();
  const state = decodeTinymanLocalState(account, tinymanAppId);
  if (state.asset_1_id !== BigInt(pnetAssetId) || state.asset_2_id !== 0n) {
    throw new Error("Configured source pool is not the pinned PNET/ALGO pair");
  }
  if (!state.pool_token_asset_id || !state.asset_1_reserves || !state.asset_2_reserves) {
    throw new Error("Pinned PNET/ALGO source pool has no executable liquidity");
  }
  return {
    address: sourcePool,
    pnetAssetId: state.asset_1_id,
    lpAssetId: state.pool_token_asset_id,
    pnetReserve: state.asset_1_reserves,
    algoReserve: state.asset_2_reserves,
    totalFeeShare: state.total_fee_share,
  };
}

export async function readTinymanPoolState({ algodClient, poolAddress, tinymanAppId }) {
  const account = await algodClient.accountInformation(poolAddress).do();
  const state = decodeTinymanLocalState(account, tinymanAppId);
  return {
    asset1Id: state.asset_1_id,
    asset2Id: state.asset_2_id,
    asset1Reserve: state.asset_1_reserves,
    asset2Reserve: state.asset_2_reserves,
    issuedPoolTokens: state.issued_pool_tokens,
    lpAssetId: state.pool_token_asset_id,
  };
}

export function tinymanBootstrapCost(minFee = 1_000n) {
  return BigInt(Bootstrap.v2.getTotalCost(false, BigInt(minFee)));
}

export async function discoverTinymanV2Pool({ algodClient, network, pnetAssetId, launchedAssetId }) {
  return poolUtils.v2.getPoolInfo({
    client: algodClient,
    network,
    asset1ID: asSafeAssetId(pnetAssetId, "PNET asset ID"),
    asset2ID: asSafeAssetId(launchedAssetId, "launched asset ID"),
  });
}

export async function bootstrapTinymanV2Pool({
  algodClient,
  network,
  walletAddress,
  pnetAssetId,
  launchedAssetId,
  launchedUnitName,
  initiatorSigner,
  onProgress = () => {},
}) {
  let pool = await discoverTinymanV2Pool({ algodClient, network, pnetAssetId, launchedAssetId });
  if (poolUtils.isPoolReady(pool)) {
    const reserves = await poolUtils.v2.getPoolReserves(algodClient, pool);
    if (!poolUtils.isPoolEmpty(reserves)) {
      throw new Error("The deterministic Tinyman pool already contains liquidity");
    }
    onProgress({ step: "pool_bootstrap", status: "confirmed", skipped: true, pool });
    return { pool, skipped: true, transactionIds: [] };
  }
  if (!poolUtils.isPoolNotCreated(pool)) {
    throw new Error(`Tinyman pool is not bootstrappable (status: ${pool.status})`);
  }

  onProgress({ step: "pool_bootstrap", status: "signing", pool });
  const txGroup = await Bootstrap.v2.generateTxns({
    network,
    client: algodClient,
    asset_1: { id: String(launchedAssetId), unit_name: launchedUnitName },
    asset_2: { id: String(pnetAssetId), unit_name: "PNET" },
    initiatorAddr: walletAddress,
  });
  const { signedTxns, txnIDs } = await Bootstrap.v2.signTxns({
    network,
    txGroup,
    initiatorSigner,
    asset1ID: asSafeAssetId(launchedAssetId),
    asset2ID: asSafeAssetId(pnetAssetId),
  });
  const simulation = await simulateSignedGroup(algodClient, signedTxns);
  onProgress({ step: "pool_bootstrap", status: "simulated", simulation, transactionIds: txnIDs });
  onProgress({ step: "pool_bootstrap", status: "submitting", transactionIds: txnIDs });
  pool = await Bootstrap.v2.execute({
    network,
    client: algodClient,
    pool: { asset1ID: pool.asset1ID, asset2ID: pool.asset2ID },
    txGroup,
    signedTxns,
  });
  onProgress({ step: "pool_bootstrap", status: "confirmed", pool, transactionIds: txnIDs });
  return { pool, skipped: false, transactionIds: txnIDs, simulation };
}

export function poolSnapshot(pool) {
  if (!pool || !poolUtils.isPoolReady(pool) || !pool.poolTokenID) return { ready: false };
  return {
    ready: true,
    address: pool.account.address().toString(),
    lpAssetId: BigInt(pool.poolTokenID),
  };
}
