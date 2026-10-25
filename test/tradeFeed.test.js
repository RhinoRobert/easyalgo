import test from "node:test";
import assert from "node:assert/strict";
import { changedAssets, classifySwap, collectNewTrades, formatAlgo, nextToast } from "../src/launchpad/tradeFeed.js";

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

test("a token is looked at when its price moves or its swap count rises, biggest price move first", () => {
  const snap = (entries) => new Map(Object.entries(entries).map(([id, [price, swaps1d]]) => [id, { price, swaps1d }]));
  const before = snap({ 1: [1, 5], 2: [1, 5], 3: [1, 5], 4: [1, 5], 5: [1, 5] });
  const after = snap({ 1: [1.2, 5], 2: [1, 5], 3: [1, 6], 4: [1 + 1e-12, 5], 5: [3, 5], 9: [7, 1] });
  assert.deepEqual(changedAssets(before, after), ["5", "1", "3"], "an unchanged price, float noise and a token seen for the first time are ignored");
  assert.deepEqual(changedAssets(snap({ 1: [null, null] }), snap({ 1: [2, 3] })), []);
});

test("new trades are collected once, in time order, and nothing from before watching began is replayed", async () => {
  const previous = new Map([[String(TOKEN), { price: 1, swaps1d: 1 }], ["77", { price: 1, swaps1d: 1 }]]);
  const current = new Map([[String(TOKEN), { price: 1.5, swaps1d: 1, name: "Canary", ticker: "CNRY" }], ["77", { price: 1, swaps1d: 1, name: "Quiet", ticker: "Q" }]]);
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
  const trades = await collectNewTrades({ previous, current, sinceSeconds: 1000, seen, hot: new Map(), fetchImpl });
  assert.deepEqual(trades.map((t) => [t.side, t.time, t.name, t.ticker]), [["buy", 1010, "Canary", "CNRY"], ["sell", 1030, "Canary", "CNRY"]]);
  assert.equal(urls.length, 1, "the quiet token was never fetched");
  assert.match(urls[0], /\/swaps\?asset_id=3753533790&start=985&/);
  const again = await collectNewTrades({ previous: current, current, sinceSeconds: 1000, seen, hot: new Map([[String(TOKEN), 2]]), fetchImpl });
  assert.equal(again.length, 0, "a trade already shown is not shown again");
});

test("a trade that reaches Vestige's swap list late is still shown (the bug that hid real buys)", async () => {
  // watching began at t=1000; the buy happened at t=1010 but only appears in the list two polls later, when the price no longer moves
  const state = (price) => new Map([[String(TOKEN), { price, swaps1d: 0, name: "Canary", ticker: "CNRY" }]]);
  const hot = new Map();
  const seen = new Set();
  let listed = [];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ results: listed }) });
  const poll = (previous, current) => collectNewTrades({ previous, current, sinceSeconds: 1000, seen, hot, fetchImpl });
  assert.equal((await poll(state(1), state(1.9))).length, 0, "price moved, swap not listed yet");
  assert.equal((await poll(state(1.9), state(1.9))).length, 0, "price steady, still not listed");
  listed = [row({ timestamp: 1010, group: "LATE" })];
  const late = await poll(state(1.9), state(1.9));
  assert.deepEqual(late.map((t) => [t.side, t.time]), [["buy", 1010]]);
  assert.equal((await poll(state(1.9), state(1.9))).length, 0, "and only once");
});

test("a token stops being rechecked after a few polls, and trades from before watching began never show", async () => {
  const state = (price) => new Map([[String(TOKEN), { price, swaps1d: 0, name: "Canary", ticker: "CNRY" }]]);
  const hot = new Map();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ results: [row({ timestamp: 900, group: "BEFORE" })] }) }; };
  const poll = (previous, current) => collectNewTrades({ previous, current, sinceSeconds: 1000, seen: new Set(), hot, fetchImpl });
  assert.equal((await poll(state(1), state(2))).length, 0, "a trade from before watching began is ignored");
  for (let index = 0; index < 6; index += 1) await poll(state(2), state(2));
  assert.equal(calls, 4, "looked at on the poll that saw the change and the three after it, then left alone");
  assert.equal(hot.size, 0);
});

test("one token failing does not stop the others, and at most eight tokens are looked up per poll", async () => {
  const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const previous = new Map(ids.map((id) => [id, { price: 1, swaps1d: 1 }]));
  const current = new Map(ids.map((id, index) => [id, { price: 2 + index, swaps1d: 1, name: `T${id}`, ticker: "" }]));
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url.includes("asset_id=10&")) throw new Error("boom"); // the biggest price move, looked at first
    return { ok: true, json: async () => ({ results: [row({ asset_1_id: Number(/asset_id=(\d+)/.exec(url)[1]), offset: calls, group: `g${calls}`, timestamp: 1010 })] }) };
  };
  const trades = await collectNewTrades({ previous, current, sinceSeconds: 1000, seen: new Set(), hot: new Map(), fetchImpl });
  assert.equal(calls, 8);
  assert.equal(trades.length, 7);
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
