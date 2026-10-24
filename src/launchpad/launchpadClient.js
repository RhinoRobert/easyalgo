import algosdk from "algosdk";
import { CREATE_FUNDING, PLATFORM_WALLET } from "./config.js";

const encoder = new TextEncoder();
const ZERO_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const PENDING_TYPE = algosdk.ABIType.from("(uint64,uint64,uint64,uint64,uint64,uint64,uint64,byte[],byte[])");
const LAUNCH_TYPE = algosdk.ABIType.from(
  "(address,uint64,uint64,uint64,uint64,uint64,uint64,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,byte[],byte[],byte[],byte[],byte[])",
);
const ALLOCATION_TYPE = algosdk.ABIType.from("(uint64,uint64,uint64,uint64)");
const UINT64_TYPE = algosdk.ABIType.from("uint64");
const STRING_TYPE = algosdk.ABIType.from("string");
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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

export function allocationBoxName(holdingAssetId) {
  return box("a", encodeUint64(holdingAssetId));
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

export async function buildCreateAssetGroup({ algodClient, appId, wallet, form }) {
  const params = await algodClient.getTransactionParams().do();
  const appAddress = algosdk.getApplicationAddress(Number(appId));
  const funding = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: appAddress,
    amount: CREATE_FUNDING,
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v2 launch storage"),
  });
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(appId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector("create_asset(pay,string,string,uint64,string)uint64"),
      STRING_TYPE.encode(form.name),
      STRING_TYPE.encode(form.unitName),
      encodeUint64(form.totalRaw),
      STRING_TYPE.encode(form.url || ""),
    ],
    boxes: boxesFor(pendingBoxName(wallet)),
    suggestedParams: pinnedParams(params, 2_000),
    note: encoder.encode("PNET Launchpad v2 create immutable ASA"),
  });
  return signerGroup(algosdk.assignGroupID([funding, call]), wallet);
}

export async function buildSwapPnetGroup({ algodClient, config, wallet, assetId, quote }) {
  const params = await algodClient.getTransactionParams().do();
  const appAddress = algosdk.getApplicationAddress(Number(config.launchpadAppId));
  const payment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: appAddress,
    amount: 1_000_000n,
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v2 exact one-ALGO swap"),
  });
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector("swap_pnet(pay,uint64,uint64,uint64)uint64"),
      encodeUint64(assetId),
      encodeUint64(quote.createdRound),
      encodeUint64(quote.minimumPnet),
    ],
    accounts: [config.sourcePool],
    foreignApps: [Number(config.tinymanAppId)],
    // Asset 0 (ALGO) must be listed so the contract can pass it in the inner Tinyman call's Assets.
    foreignAssets: [Number(config.pnetAssetId), 0],
    boxes: boxesFor(pendingBoxName(wallet)),
    suggestedParams: pinnedParams(params, 4_000),
    note: encoder.encode("PNET Launchpad v2 Tinyman source swap"),
  });
  return signerGroup(algosdk.assignGroupID([payment, call]), wallet);
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

export async function buildFinalizeGroup({
  algodClient,
  config,
  wallet,
  assetId,
  poolAddress,
  lpAssetId,
}) {
  const params = await algodClient.getTransactionParams().do();
  const globals = await readGlobalState(algodClient, config.launchpadAppId);
  const totalRecords = globals.total ?? 0n;
  const appAddress = algosdk.getApplicationAddress(Number(config.launchpadAppId));
  const arc54AlreadyOpted = await accountHasAsset(algodClient, config.arc54Address, lpAssetId);
  const creatorOptIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: wallet,
    assetIndex: Number(lpAssetId),
    amount: 0n,
    suggestedParams: pinnedParams(params, 1_000),
  });
  const launchFunding = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: appAddress,
    amount: arc54AlreadyOpted ? 100_000n : 200_000n,
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode(
      arc54AlreadyOpted
        ? "PNET Launchpad v2 app LP opt-in MBR"
        : "PNET Launchpad v2 app and ARC-54 LP opt-in MBR",
    ),
  });
  const resources = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector("provide_finalize_resources(uint64,uint64)void"),
      encodeUint64(assetId),
      encodeUint64(lpAssetId),
    ],
    foreignApps: [Number(config.arc54AppId)],
    foreignAssets: [Number(lpAssetId)],
    boxes: boxesFor(
      indexBoxName(totalRecords),
      allocationBoxName(lpAssetId),
    ),
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v2 finalization resources"),
  });
  const finalize = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector("finalize_launch(axfer,pay,uint64,address,uint64)void"),
      encodeUint64(assetId),
      algosdk.decodeAddress(poolAddress).publicKey,
      encodeUint64(lpAssetId),
    ],
    accounts: [poolAddress, config.arc54Address],
    foreignApps: [Number(config.tinymanAppId)],
    foreignAssets: [Number(assetId), Number(config.pnetAssetId), Number(lpAssetId)],
    boxes: boxesFor(
      pendingBoxName(wallet),
      launchBoxName(assetId),
    ),
    suggestedParams: pinnedParams(params, arc54AlreadyOpted ? 8_000 : 11_000),
    note: encoder.encode("PNET Launchpad v2 atomic liquidity and LP split"),
  });
  return signerGroup(
    algosdk.assignGroupID([creatorOptIn, launchFunding, resources, finalize]),
    wallet,
  );
}

export async function buildVestigeGroup({ algodClient, config, wallet, assetId }) {
  const params = await algodClient.getTransactionParams().do();
  const vestigeAddress = algosdk.getApplicationAddress(Number(config.vestigeAppId));
  const funding = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: vestigeAddress,
    amount: 100_000n,
    suggestedParams: pinnedParams(params, 1_000),
    note: encoder.encode("PNET Launchpad v2 Vestige manager MBR"),
  });
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector("grant_vestige_access(pay,uint64)void"),
      encodeUint64(assetId),
    ],
    foreignApps: [Number(config.vestigeAppId)],
    foreignAssets: [Number(assetId)],
    boxes: [
      { appIndex: 0, name: launchBoxName(assetId) },
      // algosdk accepts the external app ID and encodes its foreign-app index.
      { appIndex: Number(config.vestigeAppId), name: vestigeManagerBoxName(assetId) },
    ],
    suggestedParams: pinnedParams(params, 2_000),
    note: encoder.encode("PNET Launchpad v2 Vestige access"),
  });
  return signerGroup(algosdk.assignGroupID([funding, call]), wallet);
}

export async function buildCancelGroup({ algodClient, config, wallet, assetId, status }) {
  const params = await algodClient.getTransactionParams().do();
  const globals = await readGlobalState(algodClient, config.launchpadAppId);
  const createdOnly = BigInt(status) === 0n;
  const call = algosdk.makeApplicationCallTxnFromObject({
    sender: wallet,
    appIndex: Number(config.launchpadAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      selector(createdOnly ? "cancel_created(uint64)void" : "cancel_launch(uint64)void"),
      encodeUint64(assetId),
    ],
    accounts: createdOnly ? [] : [PLATFORM_WALLET],
    foreignAssets: createdOnly ? [Number(assetId)] : [Number(assetId), Number(config.pnetAssetId)],
    boxes: boxesFor(
      pendingBoxName(wallet),
      launchBoxName(assetId),
      indexBoxName(globals.total ?? 0n),
      ...(createdOnly ? [] : [allocationBoxName(assetId)]),
    ),
    suggestedParams: pinnedParams(params, createdOnly ? 3_000 : 4_000),
    note: encoder.encode(createdOnly
      ? "PNET Launchpad v2 un-swapped ASA recovery"
      : "PNET Launchpad v2 timed cancellation"),
  });
  return signerGroup([call], wallet);
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

export async function buildRecoveryOptIns({ algodClient, config, wallet, assetId, status }) {
  const params = await algodClient.getTransactionParams().do();
  const needed = [];
  const assets = BigInt(status) === 0n
    ? [BigInt(assetId)]
    : [BigInt(assetId), BigInt(config.pnetAssetId)];
  for (const id of assets) {
    if (await accountHasAsset(algodClient, wallet, id)) continue;
    needed.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: wallet,
      receiver: wallet,
      assetIndex: Number(id),
      amount: 0n,
      suggestedParams: pinnedParams(params, 1_000),
      note: encoder.encode("PNET Launchpad v2 cancellation recovery opt-in"),
    }));
  }
  return needed.length ? signerGroup(algosdk.assignGroupID(needed), wallet) : [];
}

export function assetIdFromCreateConfirmation(confirmation) {
  const inner = confirmation.innerTxns ?? confirmation["inner-txns"] ?? [];
  const created = inner.find((txn) => (txn.assetIndex ?? txn["asset-index"]) != null);
  const assetId = created?.assetIndex ?? created?.["asset-index"];
  if (!assetId) throw new Error("Confirmed create transaction did not contain an ASA creation");
  return BigInt(assetId);
}

async function readBox(algodClient, appId, name, abiType) {
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
    platformLp: BigInt(values[12]),
    cancelCreatorToken: BigInt(values[13]),
    cancelPlatformToken: BigInt(values[14]),
    cancelCreatorPnet: BigInt(values[15]),
    cancelPlatformPnet: BigInt(values[16]),
    cancelPlatformPnetRemaining: BigInt(values[17]),
    vestigeGranted: BigInt(values[18]),
    vestigeFunding: BigInt(values[19]),
    createTxId: txIdFromBytes(values[20]),
    swapTxId: txIdFromBytes(values[21]),
    terminalTxId: txIdFromBytes(values[22]),
    vestigeTxId: txIdFromBytes(values[23]),
    releaseTxId: txIdFromBytes(values[24]),
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
  if (launch?.status === 2n && launch.lpAssetId > 0n) {
    const values = await readBox(
      algodClient, config.launchpadAppId, allocationBoxName(launch.lpAssetId), ALLOCATION_TYPE,
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
  const appAddress = algosdk.getApplicationAddress(Number(config.launchpadAppId)).toString();
  const expectedCreator = appAddress;
  const checks = {
    immutableAsset: asset?.immutable === true,
    launchpadIsCreator: asset?.creator === expectedCreator,
    fullSupplyRecord: asset?.total === launch.totalRaw,
    correctPair: poolState.asset1Id === launch.assetId && poolState.asset2Id === BigInt(config.pnetAssetId),
    exactTokenReserve: poolState.asset1Reserve === launch.totalRaw,
    exactPnetReserve: poolState.asset2Reserve === launch.pnetSeed,
    correctLpAsset: poolState.lpAssetId === launch.lpAssetId,
    lpConserved: launch.burnedLp + launch.creatorLp + launch.platformLp
      === poolState.issuedPoolTokens - 1_000n,
    allocationTracked: allocation?.remaining === launch.platformLp,
  };
  const [burn, creator, app] = await Promise.all([
    algodClient.accountInformation(config.arc54Address).do(),
    algodClient.accountInformation(wallet).do(),
    algodClient.accountInformation(appAddress).do(),
  ]);
  checks.arc54ReceivedLp = (holdingMap(burn).get(launch.lpAssetId) ?? 0n) >= launch.burnedLp;
  checks.creatorReceivedLp = (holdingMap(creator).get(launch.lpAssetId) ?? 0n) >= launch.creatorLp;
  checks.platformRetainsLp = (holdingMap(app).get(launch.lpAssetId) ?? 0n) >= launch.platformLp;
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`Chain verification failed: ${failed.join(", ")}`);
  return checks;
}
