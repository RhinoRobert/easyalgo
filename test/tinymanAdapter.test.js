import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  asSafeAssetId,
  buildBootstrapTxns,
  decodeTinymanLocalState,
  poolAddress,
  readTinymanSourcePool,
  tinymanBootstrapCost,
} from "../src/launchpad/tinymanAdapter.js";

const key = (text) => new TextEncoder().encode(text);
const MAINNET_VALIDATOR = 1_002_541_853n;
const PNET = 3_169_177_585n;
const PARAMS = {
  fee: 1_000n, flatFee: true, firstValid: 1n, lastValid: 1_000n, genesisID: "mainnet-v1.0",
  genesisHash: new Uint8Array(32),
};

function accountState() {
  return {
    appsLocalState: [{
      id: 77n,
      keyValue: [
        { key: key("asset_1_id"), value: { type: 2, uint: 123n } },
        { key: key("asset_2_id"), value: { type: 2, uint: 0n } },
        { key: key("pool_token_asset_id"), value: { type: 2, uint: 456n } },
        { key: key("asset_1_reserves"), value: { type: 2, uint: 14_660_119_130_454n } },
        { key: key("asset_2_reserves"), value: { type: 2, uint: 844_474_148n } },
        { key: key("total_fee_share"), value: { type: 2, uint: 36n } },
      ],
    }],
  };
}

test("Tinyman source pool decoding is bigint exact", async () => {
  const decoded = decodeTinymanLocalState(accountState(), 77n);
  assert.equal(decoded.asset_1_reserves, 14_660_119_130_454n);
  const algodClient = { accountInformation: () => ({ do: async () => accountState() }) };
  const source = await readTinymanSourcePool({
    algodClient, sourcePool: "POOL", tinymanAppId: 77n, pnetAssetId: 123n,
  });
  assert.equal(source.pnetReserve, 14_660_119_130_454n);
  assert.equal(source.algoReserve, 844_474_148n);
  assert.equal(source.totalFeeShare, 36n);
});

test("Tinyman helpers reject unsafe IDs and expose the bootstrap cost", () => {
  assert.throws(() => asSafeAssetId(BigInt(Number.MAX_SAFE_INTEGER) + 1n), /safely/);
  assert.ok(tinymanBootstrapCost(false) > 1_000_000n);
  assert.ok(tinymanBootstrapCost(true) < tinymanBootstrapCost(false));
});

// The pool address is a function of (validator, asset pair). These are real MainNet pools, so a match with the live
// chain proves the template splice is byte-exact: the source pool and the canary pool from the 2026-10-24 launch.
test("pool addresses match the real MainNet pools", () => {
  assert.equal(poolAddress(MAINNET_VALIDATOR, PNET, 0), "ANESQRCMZ5KWZFKDGESLJEWQLRCVUZU725FJL7NO3BMKJEYMAB3TR56R3E");
  assert.equal(poolAddress(MAINNET_VALIDATOR, 3_753_489_997n, PNET), "CNAA6EOK6IX2KX6LAZ7SOKIE6CMIXZVO2MEST56Q53TS4O4MAAMNKGIS2E");
  assert.equal(poolAddress(MAINNET_VALIDATOR, PNET, 3_753_489_997n), poolAddress(MAINNET_VALIDATOR, 3_753_489_997n, PNET));
});

// Equality with the official SDK (a dev dependency) for pairs that do not exist yet.
test("bootstrap pair equals the Tinyman SDK's transactions", async (t) => {
  const require = createRequire(import.meta.url);
  const algosdk = require("algosdk");
  let sdk;
  try { sdk = await import("@tinymanorg/tinyman-js-sdk"); } catch { t.skip("Tinyman SDK not installed"); return; }
  const algod = new algosdk.Algodv2("", "https://mainnet-api.algonode.cloud", 443);
  const wallet = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E";
  for (const [assetA, assetB] of [[3_999_999_001n, PNET], [3_999_999_002n, 0n]]) {
    let official;
    try {
      official = await sdk.Bootstrap.v2.generateTxns({
        network: "mainnet", client: algod,
        asset_1: { id: String(assetA), unit_name: "A" }, asset_2: { id: String(assetB), unit_name: "B" }, initiatorAddr: wallet,
      });
    } catch (error) { t.skip(`algod unreachable: ${error.message}`); return; }
    const mine = buildBootstrapTxns({ wallet, validatorAppId: MAINNET_VALIDATOR, assetA, assetB, suggestedParams: PARAMS });
    const [officialPay, officialCall] = official.map((entry) => entry.txn);
    assert.equal(mine.txns[0].payment.amount, officialPay.payment.amount);
    assert.equal(mine.txns[0].fee, officialPay.fee);
    assert.equal(mine.txns[0].payment.receiver.toString(), officialPay.payment.receiver.toString());
    const mc = mine.txns[1];
    assert.equal(mc.fee, officialCall.fee);
    assert.equal(mc.sender.toString(), officialCall.sender.toString());
    assert.equal(mc.rekeyTo.toString(), officialCall.rekeyTo.toString());
    assert.equal(mc.applicationCall.onComplete, officialCall.applicationCall.onComplete);
    assert.deepEqual(mc.applicationCall.appArgs, officialCall.applicationCall.appArgs);
    assert.deepEqual(mc.applicationCall.foreignAssets.map(Number), officialCall.applicationCall.foreignAssets.map(Number));
  }
});
