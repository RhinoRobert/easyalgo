import test from "node:test";
import assert from "node:assert/strict";
import { buildChart, nearestPoint } from "../src/launchpad/chartMath.js";
import { fetchCandles, fetchVestigeAssets, parseAsset, rangeWindow, safeLogoUrl } from "../src/launchpad/vestigeApi.js";

const json = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test("a logo is used only if it is https on a host Vestige serves token images from", () => {
  assert.equal(safeLogoUrl("https://ipfs.vestigelabs.org/ipfs/Qmb3aXstRq2bE1ZftV3re9eoRHSAYArqmj9XyVkqAXue7b"), "https://ipfs.vestigelabs.org/ipfs/Qmb3aXstRq2bE1ZftV3re9eoRHSAYArqmj9XyVkqAXue7b");
  assert.match(safeLogoUrl("https://algorand-wallet-mainnet.b-cdn.net/media/x.png?format=png&height=256&width=256"), /^https:\/\/algorand-wallet-mainnet\.b-cdn\.net\//);
  for (const bad of [
    "", null, undefined, "http://ipfs.vestigelabs.org/x", "https://evil.example/logo.png", "https://ipfs.vestigelabs.org.evil.example/x",
    "https://user:pw@ipfs.vestigelabs.org/x", "https://ipfs.vestigelabs.org:8443/x", "javascript:alert(1)", "data:image/png;base64,AAAA", "//ipfs.vestigelabs.org/x",
    `https://ipfs.vestigelabs.org/${"a".repeat(400)}`,
  ]) assert.equal(safeLogoUrl(bad), "", String(bad));
});

test("asset rows keep only checked numbers and the 24h change is worked out here", () => {
  const row = parseAsset({ price: 1.1, price1d: 1.0, volume1d: 5.5, swaps1d: 3, image: "https://evil.example/x.png" });
  assert.equal(row.image, "");
  assert.ok(Math.abs(row.change1d - 10) < 1e-9);
  assert.equal(row.volume1d, 5.5);
  const bad = parseAsset({ price: "1", price1d: 0, volume1d: NaN, swaps1d: null });
  assert.deepEqual(bad, { image: "", price: null, change1d: null, volume1d: null, swaps1d: null });
});

test("fetching assets batches ids, asks without cookies or referrer, and never throws", async () => {
  const calls = [];
  const ok = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ results: [{ id: 5, price: 2, price1d: 1, volume1d: 1, swaps1d: 1, image: "" }] }) }; };
  const map = await fetchVestigeAssets([5n, 5n, "6"], ok);
  assert.equal(map.get("5").change1d, 100);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://api.vestigelabs.org/assets/list?asset_ids=5,6&"));
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.equal((await fetchVestigeAssets([5n], async () => { throw new Error("offline"); })).size, 0);
  assert.equal((await fetchVestigeAssets([5n], json({}, false, 500))).size, 0);
  assert.equal((await fetchVestigeAssets([5n], undefined ?? null)).size, 0);
  const many = await fetchVestigeAssets(Array.from({ length: 120 }, (_, index) => index + 1), async (url) => { calls.push({ url }); return { ok: true, json: async () => ({ results: [] }) }; });
  assert.equal(many.size, 0);
  assert.equal(calls.length, 1 + 3, "120 ids go out in three batches of at most 50");
});

test("chart windows use intervals the API accepts", () => {
  const now = 2_000_000_000;
  assert.deepEqual(rangeWindow("1D", { launchTime: 0, nowSeconds: now }), { start: now - 86_400, interval: 900 });
  assert.deepEqual(rangeWindow("7D", { launchTime: 0, nowSeconds: now }), { start: now - 604_800, interval: 3_600 });
  assert.equal(rangeWindow("30D", { launchTime: 0, nowSeconds: now }).interval, 14_400);
  assert.equal(rangeWindow("ALL", { launchTime: now - 3_600, nowSeconds: now }).interval, 900);
  assert.equal(rangeWindow("ALL", { launchTime: now - 5 * 86_400, nowSeconds: now }).interval, 3_600);
  assert.equal(rangeWindow("ALL", { launchTime: now - 40 * 86_400, nowSeconds: now }).interval, 14_400);
  assert.equal(rangeWindow("ALL", { launchTime: now - 400 * 86_400, nowSeconds: now }).interval, 86_400);
});

test("candles are requested in ALGO, sorted, and rows that are not plain numbers are dropped", async () => {
  let url;
  const rows = [
    { timestamp: 200, open: 2, high: 3, low: 1, close: 2 },
    { timestamp: 100, open: 1, high: 2, low: 1, close: 2 },
    { timestamp: 300, open: "1", high: 2, low: 1, close: 2 },
    { timestamp: 400, open: 1, high: 0.5, low: 1, close: 1 },
    { timestamp: 500, open: 1, high: 2, low: 0, close: 1 },
  ];
  const candles = await fetchCandles({ assetId: 77n, range: "7D", nowSeconds: 1_000_000, fetchImpl: async (u) => { url = u; return { ok: true, json: async () => rows }; } });
  assert.deepEqual(candles.map((c) => c.time), [100, 200]);
  assert.match(url, /\/assets\/77\/candles\?interval=3600&start=\d+&denominating_asset_id=0$/);
  await assert.rejects(fetchCandles({ assetId: 1n, fetchImpl: json({}, false, 503) }), /503/);
  assert.deepEqual(await fetchCandles({ assetId: 1n, fetchImpl: json({ not: "an array" }) }), []);
});

test("chart geometry: ordered points inside the box, flat prices still draw, nothing draws for no data", () => {
  assert.equal(buildChart([]), null);
  const candle = (time, close, low = close, high = close) => ({ time, open: close, high, low, close });
  const chart = buildChart([candle(0, 1, 0.9, 1.1), candle(10, 2, 1.8, 2.2), candle(20, 1.5, 1.4, 1.6)], { width: 100, height: 50, padX: 5, padTop: 5, padBottom: 5 });
  assert.equal(chart.points.length, 3);
  assert.ok(chart.points[0].x === 5 && chart.points[2].x === 95);
  assert.ok(chart.points.every((p) => p.x >= 5 && p.x <= 95 && p.y >= 5 && p.y <= 45));
  assert.ok(chart.points[1].y < chart.points[0].y, "a higher price is drawn higher up");
  assert.ok(Math.abs(chart.changePct - 50) < 1e-9);
  assert.match(chart.line, /^M5\.0 /);
  assert.match(chart.area, /Z$/);
  const flat = buildChart([candle(0, 1), candle(10, 1)]);
  assert.ok(flat.points.every((p) => Number.isFinite(p.y)));
  const single = buildChart([candle(5, 1)]);
  assert.equal(single.points.length, 2);
  assert.equal(nearestPoint(chart, 60).candle.time, 10);
  assert.equal(nearestPoint(chart, 0).candle.time, 0);
});
