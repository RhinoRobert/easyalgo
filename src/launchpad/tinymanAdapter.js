import algosdk from "algosdk";

// Tinyman v2 helpers written against the protocol itself instead of the SDK's wallet-signing flow: the launch needs the
// bootstrap pair inside the launchpad's own atomic group, and one algosdk instance keeps every address an `Address`.
const decoder = new TextDecoder();
const encoder = new TextEncoder();

// Pool LogicSig template from tinyman-js-sdk 5.1.4 (`pool_logicsig`): bytes 3..27 are validator app id, asset 1, asset 2.
const POOL_LOGICSIG_TEMPLATE = Uint8Array.from(atob("BoAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgQBbNQA0ADEYEkQxGYEBEkSBAUM="), (char) => char.charCodeAt(0));
const MIN_FEE = 1_000n;
const ASA_ASA_BOOTSTRAP = { callFee: 7n * MIN_FEE, funding: 1_049_000n };
const ASA_ALGO_BOOTSTRAP = { callFee: 6n * MIN_FEE, funding: 948_000n };

export function asSafeAssetId(value, label = "asset ID") {
  const id = BigInt(value);
  if (id <= 0n || id > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} cannot be represented safely`);
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

function uint64Bytes(value) {
  return algosdk.bigIntToBytes(BigInt(value), 8);
}

function orderedPair(assetA, assetB) {
  const a = BigInt(assetA);
  const b = BigInt(assetB);
  if (a === b) throw new Error("Pool assets are the same");
  return a > b ? [a, b] : [b, a];
}

/** The deterministic pool LogicSig for (validator, asset pair); its address is the pool account. */
export function poolLogicSig(validatorAppId, assetA, assetB) {
  const [asset1, asset2] = orderedPair(assetA, assetB);
  const program = new Uint8Array(POOL_LOGICSIG_TEMPLATE.length);
  program.set(POOL_LOGICSIG_TEMPLATE);
  program.set(uint64Bytes(validatorAppId), 3);
  program.set(uint64Bytes(asset1), 11);
  program.set(uint64Bytes(asset2), 19);
  return new algosdk.LogicSigAccount(program);
}

export function poolAddress(validatorAppId, assetA, assetB) {
  return poolLogicSig(validatorAppId, assetA, assetB).address().toString();
}

export function bootstrapParts(assetA, assetB) {
  return orderedPair(assetA, assetB)[1] === 0n ? ASA_ALGO_BOOTSTRAP : ASA_ASA_BOOTSTRAP;
}

/** Total ALGO a wallet pays for the bootstrap pair (funding payment, call fee, payment fee). */
export function tinymanBootstrapCost(isAlgoPair = false) {
  const parts = isAlgoPair ? ASA_ALGO_BOOTSTRAP : ASA_ASA_BOOTSTRAP;
  return parts.funding + parts.callFee + MIN_FEE;
}

/** The two-transaction pool bootstrap exactly as Tinyman's SDK builds it: [funding payment, pool opt-in call]. */
export function buildBootstrapTxns({ wallet, validatorAppId, assetA, assetB, suggestedParams }) {
  const [asset1, asset2] = orderedPair(assetA, assetB);
  const logicSig = poolLogicSig(validatorAppId, asset1, asset2);
  const pool = logicSig.address().toString();
  const parts = bootstrapParts(asset1, asset2);
  const funding = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: pool,
    amount: parts.funding,
    suggestedParams: { ...suggestedParams, fee: MIN_FEE, flatFee: true },
  });
  const call = algosdk.makeApplicationOptInTxnFromObject({
    sender: pool,
    appIndex: Number(validatorAppId),
    appArgs: [encoder.encode("bootstrap")],
    foreignAssets: [Number(asset1), Number(asset2)],
    rekeyTo: algosdk.getApplicationAddress(Number(validatorAppId)),
    suggestedParams: { ...suggestedParams, fee: parts.callFee, flatFee: true },
  });
  return { txns: [funding, call], logicSig, poolAddress: pool };
}

/** Signed blob for a transaction the pool LogicSig authorises (no wallet involved). */
export function signWithPoolLogicSig(txn, logicSig) {
  return algosdk.signLogicSigTransactionObject(txn, logicSig).blob;
}

/** Pool existence and live state for an asset pair: `{ exists, address, state, lpAssetId }`. */
export async function readPool({ algodClient, validatorAppId, assetA, assetB }) {
  const address = poolAddress(validatorAppId, assetA, assetB);
  let account;
  try {
    account = await algodClient.accountInformation(address).do();
  } catch (error) {
    const status = error?.status ?? error?.response?.status;
    if (status === 404) return { exists: false, address, state: null, lpAssetId: null };
    throw error;
  }
  let state = null;
  try { state = decodeTinymanLocalState(account, validatorAppId); } catch { /* not bootstrapped */ }
  if (!state?.pool_token_asset_id) return { exists: false, address, state: null, lpAssetId: null };
  return { exists: true, address, state, lpAssetId: state.pool_token_asset_id };
}

export async function readTinymanPoolState({ algodClient, poolAddress: address, tinymanAppId }) {
  const account = await algodClient.accountInformation(address).do();
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
