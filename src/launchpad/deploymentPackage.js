import algosdk from "algosdk";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  BROKEN_V2_MAINNET_APP_ID,
  CANCEL_DELAY_ROUNDS,
  INITIALIZE_FUNDING,
  LEGACY_MAINNET_APP_ID,
  PLATFORM_WALLET,
} from "./config.js";
import { NETWORK_GENESIS, TRUSTED_LAUNCHPAD_BUILD } from "./deploymentTrust.js";

const encoder = new TextEncoder();

function fromBase64(value) {
  if (typeof value !== "string" || !value.length) throw new Error("Unsigned transaction is missing");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalBytes(left, right) {
  return left?.length === right?.length && left.every((value, index) => value === right[index]);
}

function equalBigInts(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => BigInt(value) === BigInt(expected[index]));
}

function equalAddresses(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value.toString() === expected[index]);
}

function assertNoRekey(txn) {
  if (txn.rekeyTo) throw new Error("Deployment transaction contains a rekey target");
}

function assertNetwork(txn, network) {
  const expected = NETWORK_GENESIS[network];
  if (!expected) throw new Error(`Deployment is unsupported on ${network}`);
  if (txn.genesisID !== expected.id
      || algosdk.bytesToBase64(txn.genesisHash) !== expected.hash) {
    throw new Error("Transaction genesis does not match the selected Algorand network");
  }
  if (txn.firstValid > txn.lastValid || txn.lastValid - txn.firstValid > 1_000n) {
    throw new Error("Deployment transaction validity window is unsafe");
  }
}

function assertNote(txn, expected) {
  if (!equalBytes(txn.note, encoder.encode(expected))) throw new Error("Unexpected deployment note");
}

function assertTrustedArtifacts(payload) {
  const artifacts = payload.artifacts || {};
  if (artifacts.approvalSha256 !== TRUSTED_LAUNCHPAD_BUILD.approvalBytecodeSha256
      || artifacts.clearSha256 !== TRUSTED_LAUNCHPAD_BUILD.clearBytecodeSha256
      || artifacts.arc56Sha256 !== TRUSTED_LAUNCHPAD_BUILD.arc56Sha256
      || artifacts.sourceSha256 !== TRUSTED_LAUNCHPAD_BUILD.sourceSha256) {
    throw new Error("Package does not match the frontend-bundled reviewed artifacts");
  }
}

function assertConfig(payload, config) {
  if (!config) throw new Error("Trusted network configuration is required");
  const actual = payload.networkConfig || {};
  const expected = {
    pnetAssetId: BigInt(config.pnetAssetId),
    sourcePool: config.sourcePool,
    tinymanAppId: BigInt(config.tinymanAppId),
    vestigeAppId: BigInt(config.vestigeAppId),
    arc54AppId: BigInt(config.arc54AppId),
    arc54Address: config.arc54Address,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === "bigint" ? BigInt(actual[key] ?? -1) !== value : actual[key] !== value) {
      throw new Error(`Package network configuration mismatch: ${key}`);
    }
  }
}

function assertCreate(txn, payload, config) {
  const app = txn.applicationCall;
  if (!app || app.appIndex !== 0n || app.onComplete !== algosdk.OnApplicationComplete.NoOpOC) {
    throw new Error("Create package must contain an application-create transaction");
  }
  if (txn.fee !== 1_000n || txn.group) throw new Error("Create fee/group is invalid");
  if (app.numGlobalInts !== TRUSTED_LAUNCHPAD_BUILD.globalInts
      || app.numGlobalByteSlices !== TRUSTED_LAUNCHPAD_BUILD.globalBytes
      || app.numLocalInts !== TRUSTED_LAUNCHPAD_BUILD.localInts
      || app.numLocalByteSlices !== TRUSTED_LAUNCHPAD_BUILD.localBytes
      || app.extraPages !== TRUSTED_LAUNCHPAD_BUILD.extraPages) {
    throw new Error("Create application schema or extra pages differ from reviewed values");
  }
  if (hex(sha256(app.approvalProgram)) !== TRUSTED_LAUNCHPAD_BUILD.approvalBytecodeSha256
      || hex(sha256(app.clearProgram)) !== TRUSTED_LAUNCHPAD_BUILD.clearBytecodeSha256) {
    throw new Error("Create bytecode differs from the frontend-bundled reviewed artifact");
  }
  const expectedArgs = [
    algosdk.ABIMethod.fromSignature("create(address,address,uint64,uint64,uint64,uint64,uint64)void").getSelector(),
    algosdk.decodeAddress(config.arc54Address).publicKey,
    algosdk.decodeAddress(config.sourcePool).publicKey,
    algosdk.bigIntToBytes(BigInt(config.pnetAssetId), 8),
    algosdk.bigIntToBytes(BigInt(config.tinymanAppId), 8),
    algosdk.bigIntToBytes(BigInt(config.vestigeAppId), 8),
    algosdk.bigIntToBytes(BigInt(config.arc54AppId), 8),
    algosdk.bigIntToBytes(BigInt(config.cancelDelayRounds ?? CANCEL_DELAY_ROUNDS), 8),
  ];
  if (app.appArgs.length !== expectedArgs.length
      || !app.appArgs.every((arg, index) => equalBytes(arg, expectedArgs[index]))) {
    throw new Error("Create constructor arguments differ from trusted network configuration");
  }
  if (!equalAddresses(app.accounts, [config.sourcePool])
      || !equalBigInts(app.foreignApps, [config.tinymanAppId, config.vestigeAppId, config.arc54AppId])
      || !equalBigInts(app.foreignAssets, [config.pnetAssetId])) {
    throw new Error("Create foreign resources differ from trusted network configuration");
  }
  assertNote(txn, "PNET Instant Launchpad v3 create");
  if (payload.appId != null) throw new Error("Create package must not predeclare an App ID");
}

function assertInitialize(transactions, payload, config) {
  const [payment, callTxn] = transactions;
  const app = callTxn.applicationCall;
  const appId = BigInt(payload.appId ?? 0);
  if (!payment.payment || !app || appId <= 0n || appId === BigInt(LEGACY_MAINNET_APP_ID)
      || appId === BigInt(BROKEN_V2_MAINNET_APP_ID) || app.appIndex !== appId) {
    throw new Error("Initialize package targets an invalid or legacy App ID");
  }
  const appAddress = algosdk.getApplicationAddress(Number(appId)).toString();
  if (payload.appAddress !== appAddress || payment.payment.receiver.toString() !== appAddress
      || payment.payment.amount !== INITIALIZE_FUNDING || payment.fee !== 1_000n) {
    throw new Error("Initialize funding destination or amount is invalid");
  }
  const selector = algosdk.ABIMethod.fromSignature("initialize(pay)void").getSelector();
  if (callTxn.fee !== 2_000n || app.onComplete !== algosdk.OnApplicationComplete.NoOpOC
      || app.appArgs.length !== 2 || !equalBytes(app.appArgs[0], selector)
      || !equalBytes(app.appArgs[1], Uint8Array.of(0))
      || !equalBigInts(app.foreignAssets, [config.pnetAssetId])
      || app.accounts.length || app.foreignApps.length || app.boxes.length) {
    throw new Error("Initialize application call differs from the reviewed transaction shape");
  }
  if (!payment.group || !callTxn.group || !equalBytes(payment.group, callTxn.group)) {
    throw new Error("Initialize transactions are not in one atomic group");
  }
  assertNote(payment, "PNET Launchpad v3 MBR and safety cushion");
  assertNote(callTxn, "PNET Launchpad v3 initialize");
}

export function decodeAndValidateDeploymentPackage(payload, { network, account, config }) {
  if (!payload || payload.schemaVersion !== TRUSTED_LAUNCHPAD_BUILD.schemaVersion) {
    throw new Error("Unsupported or obsolete deployment package version");
  }
  if (!["create", "initialize"].includes(payload.stage)) throw new Error("Unsupported deployment package stage");
  if (payload.network !== network) throw new Error(`Package targets ${payload.network}, not ${network}`);
  if (account !== PLATFORM_WALLET || payload.deployer !== PLATFORM_WALLET
      || payload.requiresAuthority !== PLATFORM_WALLET) {
    throw new Error("Connect the hardcoded platform-authority account");
  }
  if (Number(payload.legacyProductionAppUntouched) !== LEGACY_MAINNET_APP_ID) {
    throw new Error("Package does not preserve the legacy production App ID guard");
  }
  assertTrustedArtifacts(payload);
  assertConfig(payload, config);
  const expectedCount = payload.stage === "create" ? 1 : 2;
  if (!Array.isArray(payload.unsignedTransactions)
      || payload.unsignedTransactions.length !== expectedCount
      || !Array.isArray(payload.transactionIds)
      || payload.transactionIds.length !== expectedCount) {
    throw new Error("Deployment package transaction count is invalid");
  }
  const transactions = payload.unsignedTransactions.map((encoded, index) => {
    const txn = algosdk.decodeUnsignedTransaction(fromBase64(encoded));
    if (txn.sender.toString() !== account) throw new Error(`Transaction ${index} has the wrong sender`);
    assertNoRekey(txn);
    assertNetwork(txn, network);
    if (txn.txID().toString() !== payload.transactionIds[index]) {
      throw new Error(`Transaction ${index} does not match its reviewed ID`);
    }
    return txn;
  });
  if (payload.stage === "create") assertCreate(transactions[0], payload, config);
  else assertInitialize(transactions, payload, config);
  return transactions.map((txn) => ({ txn, signers: [account] }));
}

export async function deploymentPackageSha256(fileBytes) {
  return hex(sha256(fileBytes));
}
