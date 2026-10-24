import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import {
  INITIALIZE_FUNDING,
  LEGACY_MAINNET_APP_ID,
  PLATFORM_WALLET,
} from "../src/launchpad/config.js";
import { decodeAndValidateDeploymentPackage } from "../src/launchpad/deploymentPackage.js";
import { TRUSTED_LAUNCHPAD_BUILD } from "../src/launchpad/deploymentTrust.js";

const artifact = JSON.parse(readFileSync(new URL(
  "../contracts/launchpad_v3/artifacts/launchpad_v3/PNETInstantLaunchpad.arc56.json",
  import.meta.url,
)));
const approval = Uint8Array.from(Buffer.from(artifact.byteCode.approval, "base64"));
const clear = Uint8Array.from(Buffer.from(artifact.byteCode.clear, "base64"));
const sourcePool = algosdk.generateAccount().addr.toString();
const config = {
  pnetAssetId: 1_001n,
  sourcePool,
  tinymanAppId: 148_607_000n,
  vestigeAppId: 743_122_411n,
  arc54AppId: 497_806_551n,
  arc54Address: "3TKF2GMZJ5VZ4BQVQGC72BJ63WFN4QBPU2EUD4NQYHFLC3NE5D7GXHXYOQ",
};
const params = {
  fee: 1_000n,
  minFee: 1_000n,
  flatFee: true,
  firstValid: 1n,
  lastValid: 1_001n,
  genesisID: "testnet-v1.0",
  genesisHash: Uint8Array.from(Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64")),
};
const artifacts = {
  approvalSha256: TRUSTED_LAUNCHPAD_BUILD.approvalBytecodeSha256,
  clearSha256: TRUSTED_LAUNCHPAD_BUILD.clearBytecodeSha256,
  arc56Sha256: TRUSTED_LAUNCHPAD_BUILD.arc56Sha256,
  sourceSha256: TRUSTED_LAUNCHPAD_BUILD.sourceSha256,
};

function payload(stage, txns, additions = {}) {
  return {
    schemaVersion: 3,
    stage,
    network: "testnet",
    deployer: PLATFORM_WALLET,
    requiresAuthority: PLATFORM_WALLET,
    networkConfig: {
      pnetAssetId: Number(config.pnetAssetId),
      sourcePool: config.sourcePool,
      tinymanAppId: Number(config.tinymanAppId),
      vestigeAppId: Number(config.vestigeAppId),
      arc54AppId: Number(config.arc54AppId),
      arc54Address: config.arc54Address,
    },
    artifacts,
    unsignedTransactions: txns.map((txn) => algosdk.bytesToBase64(algosdk.encodeUnsignedTransaction(txn))),
    transactionIds: txns.map((txn) => txn.txID().toString()),
    legacyProductionAppUntouched: LEGACY_MAINNET_APP_ID,
    ...additions,
  };
}

function validate(packagePayload) {
  return decodeAndValidateDeploymentPackage(packagePayload, {
    network: "testnet", account: PLATFORM_WALLET, config,
  });
}

test("deployment console pins bytecode, schema, constructor, resources, and network", () => {
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: PLATFORM_WALLET,
    suggestedParams: params,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: approval,
    clearProgram: clear,
    numGlobalInts: 9,
    numGlobalByteSlices: 2,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    extraPages: 2,
    appArgs: [
      algosdk.ABIMethod.fromSignature("create(address,address,uint64,uint64,uint64,uint64,uint64)void").getSelector(),
      algosdk.decodeAddress(config.arc54Address).publicKey,
      algosdk.decodeAddress(config.sourcePool).publicKey,
      algosdk.bigIntToBytes(config.pnetAssetId, 8),
      algosdk.bigIntToBytes(config.tinymanAppId, 8),
      algosdk.bigIntToBytes(config.vestigeAppId, 8),
      algosdk.bigIntToBytes(config.arc54AppId, 8),
      algosdk.bigIntToBytes(3_000n, 8),
    ],
    accounts: [config.sourcePool],
    foreignApps: [Number(config.tinymanAppId), Number(config.vestigeAppId), Number(config.arc54AppId)],
    foreignAssets: [Number(config.pnetAssetId)],
    note: new TextEncoder().encode("PNET Instant Launchpad v3 create"),
  });
  assert.equal(validate(payload("create", [txn])).length, 1);

  const tampered = algosdk.makeApplicationCreateTxnFromObject({
    sender: PLATFORM_WALLET,
    suggestedParams: params,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: Uint8Array.of(1),
    clearProgram: clear,
    numGlobalInts: 9,
    numGlobalByteSlices: 2,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    extraPages: 2,
  });
  assert.throws(() => validate(payload("create", [tampered])), /bytecode differs/);
});

test("initialize pins App ID, receiver, amount, selector, PNET, fees, and group", () => {
  const appId = 999;
  const appAddress = algosdk.getApplicationAddress(appId).toString();
  const txns = algosdk.assignGroupID([
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: PLATFORM_WALLET,
      receiver: appAddress,
      amount: INITIALIZE_FUNDING,
      suggestedParams: params,
      note: new TextEncoder().encode("PNET Launchpad v3 MBR and safety cushion"),
    }),
    algosdk.makeApplicationCallTxnFromObject({
      sender: PLATFORM_WALLET,
      appIndex: appId,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      appArgs: [algosdk.ABIMethod.fromSignature("initialize(pay)void").getSelector(), Uint8Array.of(0)],
      foreignAssets: [Number(config.pnetAssetId)],
      suggestedParams: { ...params, fee: 2_000n },
      note: new TextEncoder().encode("PNET Launchpad v3 initialize"),
    }),
  ]);
  assert.equal(validate(payload("initialize", txns, { appId, appAddress })).length, 2);
  const changed = payload("initialize", txns, { appId, appAddress });
  changed.transactionIds[0] = "A".repeat(52);
  assert.throws(() => validate(changed), /reviewed ID/);
});
