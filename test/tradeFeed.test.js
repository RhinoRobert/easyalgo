import test from "node:test";
import assert from "node:assert/strict";
import { classifySwap, collectNewTrades, formatAlgo, increasedAssets, nextToast } from "../src/launchpad/tradeFeed.js";

const TOKEN = 3753533790;
const PNET = 3169177585;
const row = (overrides = {}) => ({
  group: "G1", offset: 1, asset_1_id: TOKEN, asset_2_id: PNET, timestamp: 1000, address: "TRADER",
  asset_1_delta: -5000, asset_2_delta: 100, asset_1_delta_value: 1.5, asset_2_delta_value: 1.6, ...overrides,
});

test("a swap that takes the token out of the pool is a buy, one that puts it in is a sell", () => {
  const buy = classifySwap(row(), TOKEN);
  assert.equal(buy.side, "buy");
  assert.equal(buy.algo, 1.5, "the value comes from the token's own side");
  assert.equal(buy.address, "TRADER");
  assert.equal(classifySwap(row({ asset_1_delta: 5000, asset_2_delta: -100 }), TOKEN).side, "sell");
});

test("the same rule holds when the token is the pair's second asset (real rows checked against the chain)", () => {
  // GONNA (2582294183) as asset 2: the trader received it when its delta is negative
  const second = row({ asset_1_id: 31566704, asset_2_id: 2582294183, asset_1_delta: 100, asset_2_delta: -9000, asset_1_delta_value: 2, asset_2_delta_value: 2.1 });
  const trade = classifySwap(second, 2582294183);
  assert.equal(trade.side, "buy");
  assert.equal(trade.algo, 2.1);
  // the real GONNA/ALGO buy: token delta -10,482,742 against +4.67 ALGO
  assert.equal(classifySwap({ ...row(), asset_1_id: 2582294183, asset_2_id: 0, asset_1_delta: -10482742.41, asset_2_delta: 4.67, asset_1_delta_value: 4.66, asset_2_delta_value: 4.67 }, 2582294183).side, "buy");
});

test("liquidity changes, dust, other tokens and malformed rows are not trades", () => {
  assert.equal(classifySwap(row({ asset_1_delta: 1_000_000, asset_2_delta: 20_372 }), TOKEN), null, "adding liquidity moves both sides in")
  assert.equal(classifySwap(row({ asset_1_delta: -1, asset_2_delta: -1 }), TOKEN), null, "removing liquidity moves both sides out");
  assert.equal(classifySwap(row({ asset_1_delta: 0, asset_2_delta: 0 }), TOKEN), null);
  assert.equal(classifySwap(row({ asset_1_delta_value: 0.001 }), TOKEN), null, "dust");
  assert.equal(classifySwap(row(), 999), null, "another token");
  assert.equal(classifySwap(row({ asset_1_delta: "x" }), TOKEN), null);
  assert.equal(classifySwap(row({ timestamp: null }), TOKEN), null);
  assert.equal(classifySwap(null, TOKEN), null);
});

test("only tokens whose swap count rose are looked at", () => {
  const snap = (entries) => new Map(Object.entries(entries).map(([id, swaps1d]) => [id, { swaps1d }]));
  assert.deepEqual(increasedAssets(snap({ 1: 5, 2: 5, 3: 5 }), snap({ 1: 6, 2: 5, 3: 4, 4: 9 })), ["1"], "a falling count (old swaps ageing out) and a token seen for the first time are ignored");
  assert.deepEqual(increasedAssets(snap({ 1: null }), snap({ 1: 3 })), []);
});

test("new trades are collected once, in time order, and nothing from before the last look is replayed", async () => {
  const previous = new Map([[String(TOKEN), { swaps1d: 1 }], ["77", { swaps1d: 1 }]]);
  const current = new Map([[String(TOKEN), { swaps1d: 3, name: "Canary", ticker: "CNRY" }], ["77", { swaps1d: 1, name: "Quiet", ticker: "Q" }]]);
  const seen = new Set();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ results: [
      row({ offset: 3, timestamp: 1030, asset_1_delta: 50, asset_2_delta: -5, group: "B" }),
      row({ offset: 2, timestamp: 1010, group: "A" }),
      row({ offset: 1, timestamp: 500, group: "OLD" }),
      row({ offset: 4, timestamp: 1020, asset_1_delta: 1, asset_2_delta: 1, group: "LP" }),
    ] }) };
  };
  const trades = await collectNewTrades({ previous, current, sinceSeconds: 1000, seen, fetchImpl });
  assert.deepEqual(trades.map((t) => [t.side, t.time, t.name, t.ticker]), [["buy", 1010, "Canary", "CNRY"], ["sell", 1030, "Canary", "CNRY"]]);
  assert.equal(urls.length, 1, "the quiet token was never fetched");
  assert.match(urls[0], /\/swaps\?asset_id=3753533790&start=985&/);
  const again = await collectNewTrades({ previous, current, sinceSeconds: 1000, seen, fetchImpl });
  assert.equal(again.length, 0, "a trade already shown is not shown again");
});

test("one token failing does not stop the others, and at most five tokens are looked up per poll", async () => {
  const ids = ["1", "2", "3", "4", "5", "6", "7"];
  const previous = new Map(ids.map((id) => [id, { swaps1d: 1 }]));
  const current = new Map(ids.map((id) => [id, { swaps1d: 2, name: `T${id}`, ticker: "" }]));
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url.includes("asset_id=1&")) throw new Error("boom");
    return { ok: true, json: async () => ({ results: [row({ asset_1_id: Number(/asset_id=(\d+)/.exec(url)[1]), offset: calls, group: `g${calls}`, timestamp: 1010 })] }) };
  };
  const trades = await collectNewTrades({ previous, current, sinceSeconds: 1000, seen: new Set(), fetchImpl });
  assert.equal(calls, 5);
  assert.equal(trades.length, 4);
});

test("one trade shows alone; a busy moment becomes one summary", () => {
  const trade = (n, assetId = "1") => ({ key: `k${n}`, assetId, side: "buy", algo: 1, name: "Canary", ticker: "C", address: "A", time: n });
  assert.deepEqual(nextToast([]), { toast: null, rest: [] });
  const one = nextToast([trade(1), trade(2)]);
  assert.equal(one.toast.kind, "trade");
  assert.equal(one.toast.key, "k1");
  assert.equal(one.rest.length, 1);
  const many = nextToast([trade(1), trade(2), trade(3)]);
  assert.deepEqual([many.toast.kind, many.toast.count, many.toast.tokens, many.toast.assetId, many.rest.length], ["summary", 3, 1, "1", 0]);
  const mixed = nextToast([trade(1, "1"), trade(2, "2"), trade(3, "2"), trade(4, "3")]);
  assert.deepEqual([mixed.toast.count, mixed.toast.tokens, mixed.toast.assetId], [4, 3, null]);
});

test("amounts read well at every size", () => {
  assert.equal(formatAlgo(0.0234), "0.023");
  assert.equal(formatAlgo(4.6708), "4.67");
  assert.equal(formatAlgo(250.4), "250");
});
