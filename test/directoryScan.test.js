import test from "node:test";
import assert from "node:assert/strict";
import algosdk from "algosdk";
import { LAUNCH_TYPE, encodeUint64, indexBoxName, launchBoxName } from "../src/launchpad/launchpadClient.js";
import { readRecentRecords } from "../src/launchpad/directory.js";

const zeroAddress = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const zeroTx = new Uint8Array(32);
const launcher = algosdk.generateAccount().addr.toString();
const record = (assetId) => LAUNCH_TYPE.encode([
  launcher, assetId, 1_000_000n, 2n, 1n, 2n, 3n, zeroAddress, 9n, 50n, 80n, 10n, 0n, 10n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, zeroTx, zeroTx, zeroTx, zeroTx, zeroTx,
]);

function chainWith(total) {
  const boxes = new Map();
  for (let i = 0n; i < BigInt(total); i += 1n) {
    boxes.set(algosdk.bytesToBase64(indexBoxName(i)), encodeUint64(1000n + i));
    boxes.set(algosdk.bytesToBase64(launchBoxName(1000n + i)), record(1000n + i));
  }
  return {
    getApplicationByID: () => ({ do: async () => ({ params: { globalState: [{ key: new TextEncoder().encode("total"), value: { type: 2, uint: BigInt(total) } }] } }) }),
    getApplicationBoxByName: (_app, name) => ({ do: async () => {
      const value = boxes.get(algosdk.bytesToBase64(name));
      if (!value) throw Object.assign(new Error("box not found"), { status: 404 });
      return { value };
    } }),
  };
}

test("the newest 200 launches are read in pages of at most 100 (the king of the hill scans more than one page)", async () => {
  const { total, records } = await readRecentRecords({ algodClient: chainWith(250), config: { launchpadAppId: 1n }, limit: 200 });
  assert.equal(total, 250n);
  assert.equal(records.length, 200);
  assert.equal(records[0].assetId, 1050n, "starts at the 51st launch");
  assert.equal(records.at(-1).assetId, 1249n, "ends at the newest");
});

test("fewer launches than the scan size just reads them all, and an empty launchpad reads none", async () => {
  const some = await readRecentRecords({ algodClient: chainWith(3), config: { launchpadAppId: 1n }, limit: 200 });
  assert.deepEqual(some.records.map((r) => r.assetId), [1000n, 1001n, 1002n]);
  const none = await readRecentRecords({ algodClient: chainWith(0), config: { launchpadAppId: 1n }, limit: 200 });
  assert.equal(none.records.length, 0);
});