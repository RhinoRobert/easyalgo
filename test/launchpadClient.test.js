import test from "node:test";
import assert from "node:assert/strict";
import algosdk from "algosdk";
import {
  buildCreateAssetGroup,
  buildFinalizeGroup,
  buildVestigeGroup,
  decodeLaunch,
  decodePending,
  encodeUint64,
  findLatestLaunchForWallet,
  indexBoxName,
  launchBoxName,
  pendingBoxName,
  readLaunchDirectory,
  vestigeManagerBoxName,
} from "../src/launchpad/launchpadClient.js";

const wallet = algosdk.generateAccount().addr.toString();
const algodClient = {
  getTransactionParams: () => ({ do: async () => ({
    fee: 1_000n,
    minFee: 1_000n,
    firstValid: 1n,
    lastValid: 1_001n,
    genesisID: "testnet-v1.0",
    genesisHash: new Uint8Array(32),
  }) }),
};

test("box keys are deterministic and uint64 big-endian", () => {
  assert.equal(pendingBoxName(wallet).length, 33);
  assert.equal(launchBoxName(5n).length, 9);
  assert.equal(vestigeManagerBoxName(5n).length, 9);
  assert.deepEqual([...encodeUint64(258n)], [0, 0, 0, 0, 0, 0, 1, 2]);
});

test("Vestige grant references both launch and external manager boxes", async () => {
  const group = await buildVestigeGroup({
    algodClient,
    config: { launchpadAppId: 999n, vestigeAppId: 777n },
    wallet,
    assetId: 2_001n,
  });
  const call = group[1].txn.applicationCall;
  assert.deepEqual(call.foreignApps, [777n]);
  assert.equal(call.boxes.length, 2);
  assert.equal(call.boxes[0].appIndex, 0n);
  assert.equal(call.boxes[1].appIndex, 777n);
  assert.deepEqual(call.boxes[1].name, vestigeManagerBoxName(2_001n));
});

test("create group is exact-funded and rejects rekey/close by construction", async () => {
  const group = await buildCreateAssetGroup({
    algodClient,
    appId: 999n,
    wallet,
    form: { name: "Example", unitName: "EX", totalRaw: 1_000_000n, url: "" },
  });
  assert.equal(group.length, 2);
  assert.equal(group[0].txn.payment.amount, 289_500n);
  assert.equal(group[0].txn.sender.toString(), wallet);
  assert.equal(group[1].txn.applicationCall.appIndex, 999n);
  assert.equal(group[1].txn.applicationCall.boxes.length, 1);
  assert.deepEqual(group.map((item) => item.signers), [[wallet], [wallet]]);
});

for (const [arc54Opted, funding, appFee] of [
  [false, 200_000n, 11_000n],
  [true, 100_000n, 8_000n],
]) {
  test(`finalize handles ARC-54 ${arc54Opted ? "pre-opted" : "not-yet-opted"} LP state`, async () => {
    const arc54Address = algosdk.generateAccount().addr.toString();
    const poolAddress = algosdk.generateAccount().addr.toString();
    const client = {
      ...algodClient,
      getApplicationByID: () => ({ do: async () => ({
        params: {
          globalState: [{
            key: new TextEncoder().encode("total"),
            value: { type: 2, uint: 3n },
          }],
        },
      }) }),
      accountAssetInformation: () => ({
        do: async () => {
          if (!arc54Opted) throw Object.assign(new Error("not found"), { status: 404 });
          return { assetHolding: { amount: 0n } };
        },
      }),
    };
    const group = await buildFinalizeGroup({
      algodClient: client,
      config: {
        launchpadAppId: 999n,
        arc54Address,
        arc54AppId: 77n,
        tinymanAppId: 88n,
        pnetAssetId: 1_001n,
      },
      wallet,
      assetId: 2_001n,
      poolAddress,
      lpAssetId: 3_001n,
    });
    assert.equal(group.length, 4);
    assert.equal(group[1].txn.payment.amount, funding);
    assert.equal(group[2].txn.applicationCall.foreignApps[0], 77n);
    assert.equal(group[2].txn.applicationCall.foreignAssets[0], 3_001n);
    assert.equal(group[2].txn.applicationCall.boxes.length, 2);
    assert.equal(group[3].txn.applicationCall.boxes.length, 2);
    assert.equal(group[3].txn.fee, appFee);
    assert.deepEqual(group.map((item) => item.signers), [[wallet], [wallet], [wallet], [wallet]]);
  });
}

test("box decoders preserve uint64 and zero transaction sentinel", () => {
  const zero = new Uint8Array(32);
  const pending = decodePending([1n, 2n, 1n, 3n, 4n, 5n, 6n, zero, zero]);
  assert.equal(pending.assetId, 1n);
  assert.equal(pending.swapTxId, null);
  const launch = decodeLaunch([
    wallet, 1n, 2n, 2n, 3n, 4n, 5n, wallet,
    6n, 7n, 8n, 9n, 10n, 0n, 0n, 0n, 0n, 0n, 1n, 100_000n,
    zero, zero, zero, zero, zero,
  ]);
  assert.equal(launch.platformLp, 10n);
  assert.equal(launch.vestigeGranted, 1n);
});

test("directory pagination and wallet recovery use chain boxes without local storage", async () => {
  const other = algosdk.generateAccount().addr.toString();
  const zeroAddress = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
  const launchType = algosdk.ABIType.from(
    "(address,uint64,uint64,uint64,uint64,uint64,uint64,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,byte[],byte[],byte[],byte[],byte[])",
  );
  const zeroTx = new Uint8Array(32);
  const record = (launcher, assetId) => launchType.encode([
    launcher, assetId, 1_000_000n, 3n, 1n, 2n, 20_002n, zeroAddress,
    0n, 50n, 0n, 0n, 0n, 500_000n, 500_000n, 25n, 25n, 0n, 0n, 0n,
    zeroTx, zeroTx, zeroTx, zeroTx, zeroTx,
  ]);
  const boxes = new Map([
    [algosdk.bytesToBase64(indexBoxName(0n)), encodeUint64(10n)],
    [algosdk.bytesToBase64(indexBoxName(1n)), encodeUint64(11n)],
    [algosdk.bytesToBase64(launchBoxName(10n)), record(other, 10n)],
    [algosdk.bytesToBase64(launchBoxName(11n)), record(wallet, 11n)],
  ]);
  const client = {
    getApplicationByID: () => ({ do: async () => ({
      params: { globalState: [{
        key: new TextEncoder().encode("total"),
        value: { type: 2, uint: 2n },
      }] },
    }) }),
    getApplicationBoxByName: (_appId, name) => ({ do: async () => {
      const value = boxes.get(algosdk.bytesToBase64(name));
      if (!value) throw Object.assign(new Error("box not found"), { status: 404 });
      return { value };
    } }),
  };
  const page = await readLaunchDirectory({
    algodClient: client, config: { launchpadAppId: 999n }, cursor: 0n, limit: 1,
  });
  assert.equal(page.records[0].assetId, 10n);
  assert.equal(page.nextCursor, 1n);
  const latest = await findLatestLaunchForWallet({
    algodClient: client, config: { launchpadAppId: 999n }, wallet,
  });
  assert.equal(latest.assetId, 11n);
});
