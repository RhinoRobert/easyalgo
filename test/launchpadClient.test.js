import test from "node:test";
import assert from "node:assert/strict";
import algosdk from "algosdk";
import {
  buildCancelGroup,
  buildClaimLpGroup,
  buildLaunchFinishGroup,
  buildLaunchStartGroup,
  buildVestigeGroup,
  decodeLaunch,
  decodePending,
  encodeUint64,
  findLatestLaunchForWallet,
  finishFee,
  finishFunding,
  indexBoxName,
  launchBoxName,
  pendingBoxName,
  readLaunchDirectory,
  readLaunchSnapshot,
  vestigeManagerBoxName,
} from "../src/launchpad/launchpadClient.js";
import { LAUNCH_START_FUNDING } from "../src/launchpad/config.js";

const wallet = algosdk.generateAccount().addr.toString();
const params = {
  fee: 1_000n,
  minFee: 1_000n,
  firstValid: 1n,
  lastValid: 1_001n,
  genesisID: "testnet-v1.0",
  genesisHash: new Uint8Array(32),
};
const baseClient = {
  getTransactionParams: () => ({ do: async () => params }),
  getApplicationByID: () => ({ do: async () => ({
    params: { globalState: [{ key: new TextEncoder().encode("total"), value: { type: 2, uint: 3n } }] },
  }) }),
  accountAssetInformation: () => ({ do: async () => { throw Object.assign(new Error("not found"), { status: 404 }); } }),
};
const config = {
  launchpadAppId: 999n,
  tinymanAppId: 88n,
  vestigeAppId: 777n,
  arc54AppId: 77n,
  pnetAssetId: 1_001n,
  sourcePool: algosdk.generateAccount().addr.toString(),
  arc54Address: algosdk.generateAccount().addr.toString(),
};

test("box keys are deterministic and uint64 big-endian", () => {
  assert.equal(pendingBoxName(wallet).length, 33);
  assert.equal(launchBoxName(5n).length, 9);
  assert.equal(vestigeManagerBoxName(5n).length, 9);
  assert.deepEqual([...encodeUint64(258n)], [0, 0, 0, 0, 0, 0, 1, 2]);
});

test("start group: exact funding, ARC-4 args only (no transaction references), one approval", async () => {
  const group = await buildLaunchStartGroup({
    algodClient: baseClient, config, wallet,
    form: { name: "Example", unitName: "EX", totalRaw: 1_000_000n, url: "" },
    quote: { createdRound: 50, minimumPnet: 123n },
  });
  assert.equal(group.length, 2);
  assert.equal(group[0].txn.payment.amount, LAUNCH_START_FUNDING);
  const call = group[1].txn.applicationCall;
  assert.equal(call.appIndex, 999n);
  assert.equal(call.appArgs.length, 7, "selector + six ARC-4 arguments; the payment is not an app argument");
  assert.deepEqual(call.foreignAssets.map(Number), [1_001, 0]);
  assert.equal(call.boxes.length, 1);
  assert.deepEqual(group.map((item) => item.signers), [[wallet], [wallet]]);
});

for (const [arc54Opted, grantVestige] of [[false, true], [false, false], [true, true], [true, false]]) {
  test(`finish group (pool missing): ARC-54 ${arc54Opted ? "opted" : "not opted"}, Vestige ${grantVestige}`, async () => {
    const client = { ...baseClient, accountAssetInformation: () => ({ do: async () => {
      if (!arc54Opted) throw Object.assign(new Error("not found"), { status: 404 });
      return { assetHolding: { amount: 0n } };
    } }) };
    // With the pool missing the LP asset is unknown, so ARC-54 can never already hold it: the funding always includes it.
    const { entries, presigned } = await buildLaunchFinishGroup({
      algodClient: client, config, wallet, assetId: 2_001n, pool: { exists: false }, grantVestige,
    });
    assert.equal(entries.length, 5, "bootstrap payment, bootstrap call, resource carrier, funding, finish");
    assert.deepEqual(entries.map((item) => item.signers.length), [1, 0, 1, 1, 1]);
    assert.deepEqual(Object.keys(presigned), ["1"], "only the pool's own transaction is signed without the wallet");
    assert.equal(entries[3].txn.payment.amount, finishFunding({ arc54Needed: true, grantVestige }));
    assert.equal(entries[4].txn.fee, finishFee({ arc54Needed: true, grantVestige }));
    assert.equal(entries[4].txn.applicationCall.appArgs.length, 4);
    assert.equal(entries[4].txn.applicationCall.boxes.length, 4);
    assert.equal(entries[2].txn.applicationCall.foreignApps.length, 3);
    const groupIds = new Set(entries.map((item) => algosdk.bytesToBase64(item.txn.group)));
    assert.equal(groupIds.size, 1, "one atomic group");
  });
}

test("finish group (pool exists): no bootstrap pair, LP asset shared, ARC-54 funding follows its real state", async () => {
  const pool = { exists: true, address: algosdk.generateAccount().addr.toString(), lpAssetId: 3_001n };
  const { entries, presigned } = await buildLaunchFinishGroup({
    algodClient: { ...baseClient, accountAssetInformation: () => ({ do: async () => ({ assetHolding: { amount: 0n } }) }) },
    config, wallet, assetId: 2_001n, pool, grantVestige: true,
  });
  assert.equal(entries.length, 3);
  assert.deepEqual(presigned, {});
  assert.ok(entries[0].txn.applicationCall.foreignAssets.map(Number).includes(3_001));
  assert.equal(entries[1].txn.payment.amount, finishFunding({ arc54Needed: false, grantVestige: true }));
});

test("claim, cancel and Vestige retry build the reviewed shapes", async () => {
  const claim = await buildClaimLpGroup({ algodClient: baseClient, config, wallet, assetId: 5n, lpAssetId: 6n });
  assert.equal(claim.length, 2);
  assert.equal(claim[0].txn.assetTransfer.amount, 0n);
  assert.equal(claim[1].txn.applicationCall.appArgs.length, 2);

  const cancel = await buildCancelGroup({ algodClient: baseClient, config, wallet, assetId: 5n });
  assert.equal(cancel.length, 3, "ASA opt-in, PNET opt-in and the cancel call travel together");
  assert.equal(cancel.at(-1).txn.applicationCall.appArgs.length, 2);

  const vestige = await buildVestigeGroup({ algodClient: baseClient, config, wallet, assetId: 2_001n });
  const call = vestige[1].txn.applicationCall;
  assert.deepEqual(call.foreignApps, [777n]);
  assert.equal(call.boxes.length, 2);
  assert.equal(call.boxes[0].appIndex, 0n);
  assert.equal(call.boxes[1].appIndex, 777n);
  assert.deepEqual(call.boxes[1].name, vestigeManagerBoxName(2_001n));
});

test("box decoders preserve uint64 and zero transaction sentinel", () => {
  const zero = new Uint8Array(32);
  const pending = decodePending([1n, 2n, 1n, 3n, 4n, 5n, 6n, zero, zero]);
  assert.equal(pending.assetId, 1n);
  assert.equal(pending.swapTxId, null);
  const launch = decodeLaunch([
    wallet, 1n, 2n, 2n, 3n, 4n, 5n, wallet,
    6n, 7n, 8n, 9n, 1n, 10n, 0n, 0n, 0n, 0n, 0n, 1n, 100_000n,
    zero, zero, zero, zero, zero,
  ]);
  assert.equal(launch.creatorLp, 9n);
  assert.equal(launch.creatorLpClaimed, 1n);
  assert.equal(launch.platformLp, 10n);
  assert.equal(launch.vestigeGranted, 1n);
});

test("directory pagination and wallet recovery use chain boxes without local storage", async () => {
  const other = algosdk.generateAccount().addr.toString();
  const zeroAddress = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
  const u = Array(6).fill("uint64").join(",");
  const launchType = algosdk.ABIType.from(
    `(address,${u},address,${u},${Array(7).fill("uint64").join(",")},${Array(5).fill("byte[]").join(",")})`,
  );
  const zeroTx = new Uint8Array(32);
  const record = (launcher, assetId) => launchType.encode([
    launcher, assetId, 1_000_000n, 3n, 1n, 2n, 20_002n, zeroAddress,
    0n, 50n, 0n, 0n, 0n, 0n, 500_000n, 500_000n, 25n, 25n, 0n, 0n, 0n,
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
      params: { globalState: [{ key: new TextEncoder().encode("total"), value: { type: 2, uint: 2n } }] },
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

test("the start builder refuses a supply Tinyman could not take", async () => {
  await assert.rejects(buildLaunchStartGroup({
    algodClient: baseClient, config, wallet, form: { name: "Tiny", unitName: "TNY", totalRaw: 999_999n, url: "" }, quote: { createdRound: 1, minimumPnet: 1n },
  }), /at least 1 whole token/);
});

test("a launch that has not started reads only the unfinished-launch box, never the wallet's older finished launches", async () => {
  let directoryReads = 0;
  const client = {
    getApplicationByID: () => ({ do: async () => { directoryReads += 1; return { params: { globalState: [{ key: new TextEncoder().encode("total"), value: { type: 2, uint: 5n } }] } }; } }),
    getApplicationBoxByName: () => ({ do: async () => { throw Object.assign(new Error("box not found"), { status: 404 }); } }),
  };
  const snapshot = await readLaunchSnapshot({ algodClient: client, config: { launchpadAppId: 999n }, wallet, assetId: null, scanDirectory: false });
  assert.equal(snapshot.pending, null);
  assert.equal(snapshot.launch, null);
  assert.equal(directoryReads, 0, "the launch directory must not be scanned");
});