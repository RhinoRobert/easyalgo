import algosdk from "algosdk";
import {
  ARC54_LP_HOLDING_MBR,
  LAUNCH_START_FUNDING,
  LP_HOLDING_MBR,
  MIN_SUPPLY_RAW,
  PLATFORM_WALLET,
  VESTIGE_FUNDING,
} from "./config.js";
import { buildBootstrapTxns, signWithPoolLogicSig } from "./tinymanAdapter.js";

const encoder = new TextEncoder();
const ZERO_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
export const PENDING_TYPE = algosdk.ABIType.from("(uint64,uint64,uint64,uint64,uint64,uint64,uint64,byte[],byte[])");
// launcher, asset, total, status, created, swap, terminal, pool, lp, seed, burned, creatorLp, creatorLpClaimed, platformLp,
// five cancellation amounts, vestigeGranted, vestigeFunding, five 32-byte transaction ids (must match contract.py's LaunchRecord).
export const LAUNCH_TYPE = algosdk.ABIType.from(
  `(address,${Array(6).fill("uint64").join(",")},address,${Array(6).fill("uint64").join(",")},${Array(7).fill("uint64").join(",")},${Array(5).fill("byte[]").join(",")})`,
);
export const ALLOCATION_TYPE = algosdk.ABIType.from("(uint64,uint64,uint64,uint64)");
const UINT64_TYPE = algosdk.ABIType.from("uint64");
const STRING_TYPE = algosdk.ABIType.from("string");
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const SIG_START = "launch_start(pay,string,string,uint64,string,uint64,uint64)uint64";
const SIG_FINISH = "launch_finish(pay,uint64,address,uint64)void";
const SIG_BUDGET = "budget()void";
const SIG_CLAIM = "claim_creator_lp(axfer,uint64)void";
const SIG_CANCEL = "cancel_launch(uint64)void";
const SIG_VESTIGE = "grant_vestige_access(pay,uint64)void";
const SIG_RELEASE_ALLOCATION = "release_platform_allocation(uint64,address,uint64)uint64";
const SIG_RELEASE_PNET = "release_cancelled_pnet(uint64)uint64";
const RELEASE_FEE = 3_000n;

// Minimum fees measured against the real Tinyman, ARC-54 and Vestige programs (contracts/tests), plus one spare transaction fee.
export const START_FEE = 6_000n;
export const FINISH_BASE_FEE = 8_000n;
const FINISH_ARC54_FEE = 3_000n;
const FINISH_VESTIGE_FEE = 2_000n;
const SPARE_FEE = 1_000n;
const CANCEL_FEE = 7_000n;
const CLAIM_FEE = 3_000n;
const VESTIGE_RETRY_FEE = 5_000n;

function selector(signature) {
  return algosdk.ABIMethod.fromSignature(signature).getSelector();
}

export function encodeUint64(value) {
  return algosdk.bigIntToBytes(BigInt(value), 8);
}

function pinnedParams(params, fee) {
  return { ...params, fee: BigInt(fee), flatFee: true };
}

function box(prefix, keyBytes) {
  const name = new Uint8Array(prefix.length + keyBytes.length);
  name.set(encoder.encode(prefix));
  name.set(keyBytes, prefix.length);
  return name;
}

export function pendingBoxName(wallet) {
  return box("p", algosdk.decodeAddress(wallet).publicKey);
}

export function launchBoxName(assetId) {
  return box("l", encodeUint64(assetId));
}

export function indexBoxName(index) {
  return box("i", encodeUint64(index));
}

/** One platform allocation per launch, keyed by the launch asset id (the LP asset id may not exist when the group is built). */
export function allocationBoxName(launchAssetId) {
  return box("a", encodeUint64(launchAssetId));
}

export function vestigeManagerBoxName(assetId) {
  return box("m", encodeUint64(assetId));
}

function boxesFor(...names) {
  return names.map((name) => ({ appIndex: 0, name }));
}

function txIdFromBytes(bytes) {
  if (!bytes?.length || bytes.every((byte) => byte === 0)) return null;
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function signerGroup(txns, wallet) {
  return txns.map((txn) => ({ txn, signers: [wallet] }));
}

function appAddressOf(appId) {
  return algosdk.getApplicationAddress(Number(appId)).toString();
}

export async function readGlobalState(algodClient, appId) {
  const app = await algodClient.getApplicationByID(Number(appId)).do();
  const result = {};
  const entries = app.params?.globalState ?? app.params?.["global-state"] ?? [];
  for (const entry of entries) {
    const keyBytes = entry.key instanceof Uint8Array
      ? entry.key
      : Uint8Array.from(atob(entry.key), (char) => char.charCodeAt(0));
    const key = new TextDecoder().decode(keyBytes);
    const value = entry.value;
    if (Number(value.type) === 2) result[key] = BigInt(value.uint);
    else result[key] = value.bytes instanceof Uint8Array
      ? value.bytes
      : Uint8Array.from(atob(value.bytes), (char) => char.charCodeAt(0));
  }
  return result;
}

export async function accountHasAsset(algodClient, address, assetId) {
  try {
    await algodClient.accountAssetInformation(address, Number(assetId)).do();
    return true;
  } catch (error) {
    const status = error?.status ?? error?.response?.status;
    if (status === 404 || /not found|not opted/i.test(String(error?.message))) return false;
    throw error;
  }
}

// -- approval 1: create the token and buy PNET ---------------------------------------------------------------------------------

export async function buildLaunchStartGroup({ algodClient, config, wallet, form, quote }) {
  if (BigInt(form.totalRaw) < MIN_SUPPLY_RAW) throw new Error("Supply must be at least 1 whole token: Tinyman cannot take a smaller first deposit");
  const params = await algodClient.getTransactionParams().do();
  const appId = Number(config.launchpadAppId);
  const funding = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: appAddressOf(appId),
    amount: LAUNCH_START_FUNDING,
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v3 launch funding"),
  });
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: appId,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector(SIG_START),
      STRING_TYPE.encode(form.name),
      STRING_TYPE.encode(form.unitName),
      encodeUint64(form.totalRaw),
      STRING_TYPE.encode(form.url || ""),
      encodeUint64(quote.createdRound),
      encodeUint64(quote.minimumPnet),
    ],
    accounts: [config.sourcePool],
    foreignApps: [Number(config.tinymanAppId)],
    // Asset 0 (ALGO) must be listed so the contract can pass it in the inner Tinyman call's Assets.
    foreignAssets: [Number(config.pnetAssetId), 0],
    boxes: boxesFor(pendingBoxName(wallet)),
    suggestedParams: pinnedParams(params, START_FEE),
    note: encoder.encode("PNET Launchpad v3 create token and buy PNET"),
  });
  return signerGroup(algosdk.assignGroupID([funding, call]), wallet);
}

// -- approval 2: pool + liquidity (+ Vestige) ------------------------------------------------------------------------------------

export function finishFee({ arc54Needed, grantVestige }) {
  return FINISH_BASE_FEE + (arc54Needed ? FINISH_ARC54_FEE : 0n) + (grantVestige ? FINISH_VESTIGE_FEE : 0n) + SPARE_FEE;
}

export function finishFunding({ arc54Needed, grantVestige }) {
  return LP_HOLDING_MBR + (arc54Needed ? ARC54_LP_HOLDING_MBR : 0n) + (grantVestige ? VESTIGE_FUNDING : 0n);
}

/**
 * The finish group: [bootstrap payment, pool bootstrap (LogicSig), resource carrier, funding payment, launch_finish].
 * The bootstrap pair is left out when the pool already exists. Returns `{ entries, presigned }`: wallet transactions have
 * `signers: [wallet]`; the pool's own transaction is signed here (`presigned[index]`) and carries `signers: []`.
 */
export async function buildLaunchFinishGroup({ algodClient, config, wallet, assetId, pool, grantVestige = true }) {
  const params = await algodClient.getTransactionParams().do();
  const appId = Number(config.launchpadAppId);
  const globals = await readGlobalState(algodClient, appId);
  const lpKnown = pool.exists ? pool.lpAssetId : null;
  const arc54Needed = !(lpKnown && await accountHasAsset(algodClient, config.arc54Address, lpKnown));
  const txns = [];
  let bootstrap = null;
  if (!pool.exists) {
    bootstrap = buildBootstrapTxns({
      wallet, validatorAppId: config.tinymanAppId, assetA: assetId, assetB: config.pnetAssetId, suggestedParams: params,
    });
    txns.push(bootstrap.txns[0], bootstrap.txns[1]);
  }
  const poolAddress = pool.exists ? pool.address : bootstrap.poolAddress;
  // One application call carries at most eight references and the group shares them: the budget call holds the accounts,
  // apps, assets and the Vestige box, the finish call its own four boxes.
  const carrier = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: appId,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [selector(SIG_BUDGET)],
    accounts: [poolAddress],
    foreignApps: [Number(config.tinymanAppId), Number(config.arc54AppId), Number(config.vestigeAppId)],
    foreignAssets: [Number(assetId), Number(config.pnetAssetId), ...(lpKnown ? [Number(lpKnown)] : [])],
    boxes: [{ appIndex: Number(config.vestigeAppId), name: vestigeManagerBoxName(assetId) }],
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v3 shared resources"),
  });
  const funding = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: appAddressOf(appId),
    amount: finishFunding({ arc54Needed, grantVestige }),
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v3 pool funding"),
  });
  const finish = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: appId,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector(SIG_FINISH),
      encodeUint64(assetId),
      algosdk.decodeAddress(poolAddress).publicKey,
      encodeUint64(grantVestige ? 1 : 0),
    ],
    boxes: boxesFor(
      pendingBoxName(wallet),
      launchBoxName(assetId),
      indexBoxName(globals.total ?? 0n),
      allocationBoxName(assetId),
    ),
    suggestedParams: pinnedParams(params, finishFee({ arc54Needed, grantVestige })),
    note: encoder.encode("PNET Launchpad v3 seed liquidity and split LP"),
  });
  txns.push(carrier, funding, finish);
  const grouped = algosdk.assignGroupID(txns);
  const presigned = {};
  const entries = grouped.map((txn, index) => {
    if (bootstrap && index === 1) {
      presigned[index] = signWithPoolLogicSig(txn, bootstrap.logicSig);
      return { txn, signers: [] };
    }
    return { txn, signers: [wallet] };
  });
  return { entries, presigned, poolAddress, arc54Needed };
}

// -- later actions ------------------------------------------------------------------------------------------------------------

export async function buildClaimLpGroup({ algodClient, config, wallet, assetId, lpAssetId }) {
  const params = await algodClient.getTransactionParams().do();
  const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: wallet,
    assetIndex: Number(lpAssetId),
    amount: 0n,
    suggestedParams: pinnedParams(params, 1_000),
  });
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [selector(SIG_CLAIM), encodeUint64(assetId)],
    foreignAssets: [Number(lpAssetId)],
    boxes: boxesFor(launchBoxName(assetId)),
    suggestedParams: pinnedParams(params, CLAIM_FEE),
    note: encoder.encode("PNET Launchpad v3 claim creator LP"),
  });
  return signerGroup(algosdk.assignGroupID([optIn, call]), wallet);
}

/** Cancel an escrowed launch after the delay; the recovery opt-ins ride in the same group (one approval). */
export async function buildCancelGroup({ algodClient, config, wallet, assetId }) {
  const params = await algodClient.getTransactionParams().do();
  const globals = await readGlobalState(algodClient, config.launchpadAppId);
  const txns = [];
  for (const id of [BigInt(assetId), BigInt(config.pnetAssetId)]) {
    if (await accountHasAsset(algodClient, wallet, id)) continue;
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: wallet,
      receiver: wallet,
      assetIndex: Number(id),
      amount: 0n,
      suggestedParams: pinnedParams(params, 1_000),
      note: encoder.encode("PNET Launchpad v3 cancellation recovery opt-in"),
    }));
  }
  txns.push(algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [selector(SIG_CANCEL), encodeUint64(assetId)],
    accounts: [config.platformWallet ?? PLATFORM_WALLET],
    foreignAssets: [Number(assetId), Number(config.pnetAssetId)],
    boxes: boxesFor(
      pendingBoxName(wallet),
      launchBoxName(assetId),
      indexBoxName(globals.total ?? 0n),
      allocationBoxName(assetId),
    ),
    suggestedParams: pinnedParams(params, CANCEL_FEE),
    note: encoder.encode("PNET Launchpad v3 timed cancellation"),
  }));
  return signerGroup(algosdk.assignGroupID(txns), wallet);
}

/** Retry path when the finish group ran without the Vestige grant. */
export async function buildVestigeGroup({ algodClient, config, wallet, assetId }) {
  const params = await algodClient.getTransactionParams().do();
  const funding = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: appAddressOf(config.vestigeAppId),
    amount: VESTIGE_FUNDING,
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v3 Vestige manager MBR"),
  });
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [selector(SIG_VESTIGE), encodeUint64(assetId)],
    foreignApps: [Number(config.vestigeAppId)],
    foreignAssets: [Number(assetId)],
    boxes: [
      { appIndex: 0, name: launchBoxName(assetId) },
      // algosdk accepts the external app ID and encodes its foreign-app index.
      { appIndex: Number(config.vestigeAppId), name: vestigeManagerBoxName(assetId) },
    ],
    suggestedParams: pinnedParams(params, VESTIGE_RETRY_FEE),
    note: encoder.encode("PNET Launchpad v3 Vestige access"),
  });
  return signerGroup(algosdk.assignGroupID([funding, call]), wallet);
}

// -- platform authority actions (the contract accepts these only from the hardcoded platform wallet) ---------------------------------

export async function buildOptInGroup({ algodClient, wallet, assetId }) {
  const params = await algodClient.getTransactionParams().do();
  const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: wallet,
    assetIndex: Number(assetId),
    amount: 0n,
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v3 platform opt-in"),
  });
  return signerGroup([optIn], wallet);
}

/** Pay a recorded platform allocation (platform LP, or the platform's half of a cancelled launch's token) to `receiver`. */
export async function buildReleaseAllocationGroup({ algodClient, config, wallet, launchAssetId, holdingAssetId, receiver, amount }) {
  const params = await algodClient.getTransactionParams().do();
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector(SIG_RELEASE_ALLOCATION),
      encodeUint64(launchAssetId),
      algosdk.decodeAddress(receiver).publicKey,
      encodeUint64(amount),
    ],
    accounts: [receiver],
    foreignAssets: [Number(holdingAssetId)],
    boxes: boxesFor(allocationBoxName(launchAssetId), launchBoxName(launchAssetId)),
    suggestedParams: pinnedParams(params, RELEASE_FEE),
    note: encoder.encode("PNET Launchpad v3 release platform allocation"),
  });
  return signerGroup([call], wallet);
}

/** Pay PNET the platform was owed from a cancelled launch (deferred when the platform was not opted in at the time). */
export async function buildReleaseCancelledPnetGroup({ algodClient, config, wallet, launchAssetId }) {
  const params = await algodClient.getTransactionParams().do();
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [selector(SIG_RELEASE_PNET), encodeUint64(launchAssetId)],
    foreignAssets: [Number(config.pnetAssetId)],
    boxes: boxesFor(launchBoxName(launchAssetId)),
    suggestedParams: pinnedParams(params, RELEASE_FEE),
    note: encoder.encode("PNET Launchpad v3 release deferred PNET"),
  });
  return signerGroup([call], wallet);
}

export function assetIdFromCreateConfirmation(confirmation) {
  const inner = confirmation.innerTxns ?? confirmation["inner-txns"] ?? [];
  const created = inner.find((txn) => (txn.assetIndex ?? txn["asset-index"]) != null);
  const assetId = created?.assetIndex ?? created?.["asset-index"];
  if (!assetId) throw new Error("Confirmed start transaction did not contain an ASA creation");
  return BigInt(assetId);
}

// -- chain reads --------------------------------------------------------------------------------------------------------------

export async function readBox(algodClient, appId, name, abiType) {
  try {
    const response = await algodClient.getApplicationBoxByName(Number(appId), name).do();
    return abiType.decode(response.value);
  } catch (error) {
    const status = error?.status ?? error?.response?.status;
    if (status === 404 || /box.*not found|no box/i.test(String(error?.message))) return null;
    throw error;
  }
}

export async function readLaunchDirectory({
  algodClient,
  config,
  cursor = 0n,
  limit = 25,
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Directory page limit must be between 1 and 100");
  }
  const globals = await readGlobalState(algodClient, config.launchpadAppId);
  const total = globals.total ?? 0n;
  const start = BigInt(cursor);
  if (start < 0n || start > total) throw new Error("Directory cursor is out of range");
  const end = start + BigInt(limit) < total ? start + BigInt(limit) : total;
  const records = [];
  for (let index = start; index < end; index += 1n) {
    const assetId = await readBox(
      algodClient, config.launchpadAppId, indexBoxName(index), UINT64_TYPE,
    );
    if (assetId == null) throw new Error(`Directory index ${index} is missing`);
    const values = await readBox(
      algodClient, config.launchpadAppId, launchBoxName(assetId), LAUNCH_TYPE,
    );
    const launch = decodeLaunch(values);
    if (!launch || launch.assetId !== BigInt(assetId)) {
      throw new Error(`Directory record ${index} is inconsistent`);
    }
    records.push({ index, ...launch });
  }
  return { records, total, nextCursor: end < total ? end : null };
}

export async function findLatestLaunchForWallet({
  algodClient,
  config,
  wallet,
  maxRecords = 500,
}) {
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error("Invalid recovery scan limit");
  const globals = await readGlobalState(algodClient, config.launchpadAppId);
  const total = globals.total ?? 0n;
  const floor = total > BigInt(maxRecords) ? total - BigInt(maxRecords) : 0n;
  for (let index = total; index > floor;) {
    index -= 1n;
    const assetId = await readBox(
      algodClient, config.launchpadAppId, indexBoxName(index), UINT64_TYPE,
    );
    if (assetId == null) throw new Error(`Directory index ${index} is missing`);
    const values = await readBox(
      algodClient, config.launchpadAppId, launchBoxName(assetId), LAUNCH_TYPE,
    );
    const launch = decodeLaunch(values);
    if (launch?.launcher === wallet) return launch;
  }
  return null;
}

export function decodePending(values) {
  if (!values) return null;
  return {
    assetId: BigInt(values[0]),
    totalRaw: BigInt(values[1]),
    status: BigInt(values[2]),
    createdRound: BigInt(values[3]),
    swapRound: BigInt(values[4]),
    pnetOutput: BigInt(values[5]),
    quoteMinimum: BigInt(values[6]),
    createTxId: txIdFromBytes(values[7]),
    swapTxId: txIdFromBytes(values[8]),
  };
}

export function decodeLaunch(values) {
  if (!values) return null;
  return {
    launcher: values[0],
    assetId: BigInt(values[1]),
    totalRaw: BigInt(values[2]),
    status: BigInt(values[3]),
    createdRound: BigInt(values[4]),
    swapRound: BigInt(values[5]),
    terminalRound: BigInt(values[6]),
    poolAddress: values[7] === ZERO_ADDRESS ? null : values[7],
    lpAssetId: BigInt(values[8]),
    pnetSeed: BigInt(values[9]),
    burnedLp: BigInt(values[10]),
    creatorLp: BigInt(values[11]),
    creatorLpClaimed: BigInt(values[12]),
    platformLp: BigInt(values[13]),
    cancelCreatorToken: BigInt(values[14]),
    cancelPlatformToken: BigInt(values[15]),
    cancelCreatorPnet: BigInt(values[16]),
    cancelPlatformPnet: BigInt(values[17]),
    cancelPlatformPnetRemaining: BigInt(values[18]),
    vestigeGranted: BigInt(values[19]),
    vestigeFunding: BigInt(values[20]),
    createTxId: txIdFromBytes(values[21]),
    swapTxId: txIdFromBytes(values[22]),
    terminalTxId: txIdFromBytes(values[23]),
    vestigeTxId: txIdFromBytes(values[24]),
    releaseTxId: txIdFromBytes(values[25]),
  };
}

export async function readLaunchSnapshot({ algodClient, config, wallet, assetId = null }) {
  const pendingValues = await readBox(
    algodClient, config.launchpadAppId, pendingBoxName(wallet), PENDING_TYPE,
  );
  const pending = decodePending(pendingValues);
  let resolvedAssetId = assetId ?? pending?.assetId ?? null;
  let launch = null;
  if (resolvedAssetId == null) {
    launch = await findLatestLaunchForWallet({ algodClient, config, wallet });
    resolvedAssetId = launch?.assetId ?? null;
  } else {
    const launchValues = await readBox(
      algodClient, config.launchpadAppId, launchBoxName(resolvedAssetId), LAUNCH_TYPE,
    );
    launch = decodeLaunch(launchValues);
  }
  let asset = null;
  if (resolvedAssetId != null) {
    const info = await algodClient.getAssetByID(Number(resolvedAssetId)).do();
    const params = info.params;
    asset = {
      id: BigInt(resolvedAssetId),
      creator: params.creator,
      total: BigInt(params.total),
      decimals: Number(params.decimals),
      name: params.name ?? "",
      unitName: params.unitName ?? params["unit-name"] ?? "",
      url: params.url ?? "",
      immutable: [params.manager, params.reserve, params.freeze, params.clawback]
        .every((address) => !address || address === ZERO_ADDRESS),
    };
  }
  let allocation = null;
  if (launch && resolvedAssetId != null) {
    const values = await readBox(
      algodClient, config.launchpadAppId, allocationBoxName(resolvedAssetId), ALLOCATION_TYPE,
    );
    if (values) allocation = {
      launchAssetId: BigInt(values[0]),
      holdingAssetId: BigInt(values[1]),
      remaining: BigInt(values[2]),
      kind: BigInt(values[3]),
    };
  }
  return { pending, launch, asset, allocation };
}

function holdingMap(account) {
  const assets = account.assets ?? [];
  return new Map(assets.map((item) => [BigInt(item.assetId ?? item["asset-id"]), BigInt(item.amount)]));
}

export async function verifyCompletedLaunch({ algodClient, config, wallet, snapshot, poolState }) {
  const { launch, asset, allocation } = snapshot;
  if (!launch || launch.status !== 2n) throw new Error("Launch record is not complete");
  const appAddress = appAddressOf(config.launchpadAppId);
  const checks = {
    immutableAsset: asset?.immutable === true,
    launchpadIsCreator: asset?.creator === appAddress,
    fullSupplyRecord: asset?.total === launch.totalRaw,
    correctPair: poolState.asset1Id === launch.assetId && poolState.asset2Id === BigInt(config.pnetAssetId),
    exactTokenReserve: poolState.asset1Reserve === launch.totalRaw,
    exactPnetReserve: poolState.asset2Reserve === launch.pnetSeed,
    correctLpAsset: poolState.lpAssetId === launch.lpAssetId,
    lpConserved: launch.burnedLp + launch.creatorLp + launch.platformLp
      === poolState.issuedPoolTokens - 1_000n,
    allocationTracked: allocation === null || allocation.remaining <= launch.platformLp,
  };
  const [burn, creator, app] = await Promise.all([
    algodClient.accountInformation(config.arc54Address).do(),
    algodClient.accountInformation(wallet).do(),
    algodClient.accountInformation(appAddress).do(),
  ]);
  checks.arc54ReceivedLp = (holdingMap(burn).get(launch.lpAssetId) ?? 0n) >= launch.burnedLp;
  checks.platformRetainsLp = (holdingMap(app).get(launch.lpAssetId) ?? 0n)
    >= (allocation?.remaining ?? 0n) + (launch.creatorLpClaimed === 1n ? 0n : launch.creatorLp);
  if (launch.creatorLpClaimed === 1n) {
    checks.creatorReceivedLp = (holdingMap(creator).get(launch.lpAssetId) ?? 0n) >= launch.creatorLp;
  }
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`Chain verification failed: ${failed.join(", ")}`);
  return checks;
}
