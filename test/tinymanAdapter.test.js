import test from "node:test";
import assert from "node:assert/strict";
import {
  asSafeAssetId,
  decodeTinymanLocalState,
  readTinymanSourcePool,
  tinymanBootstrapCost,
} from "../src/launchpad/tinymanAdapter.js";

const key = (text) => new TextEncoder().encode(text);

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

test("Tinyman helpers reject unsafe IDs and expose ASA/ASA bootstrap cost", () => {
  assert.throws(() => asSafeAssetId(BigInt(Number.MAX_SAFE_INTEGER) + 1n), /safely/);
  assert.ok(tinymanBootstrapCost(1_000n) > 900_000n);
});
