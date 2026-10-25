import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSafetyChecks, burnedPercent, filterLaunches, formatPrice, parseRoute, placeholderBadge, rankHolders, shareOnXUrl, sortLaunches, tokenHash, tokenStats,
} from "../src/launchpad/tokenView.js";

const APP = "APPADDRESS";
const asset = { creator: APP, manager: undefined, reserve: undefined, freeze: undefined, clawback: undefined };
const launch = {
  status: 2n, poolAddress: "POOL", lpAssetId: 9n, burnedLp: 800n, creatorLp: 100n, platformLp: 100n, creatorLpClaimed: 0n, terminalTxId: "TX",
};
const good = { asset, launch, appAddress: APP, appTokenHolding: 0n, poolIsCanonical: true, burnHolding: 800n };
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));

test("routes: #token/<id> opens a token, bad ids are not tokens", () => {
  assert.deepEqual(parseRoute("#token/3753533790"), { tab: "token", assetId: 3753533790n, address: null });
  assert.equal(parseRoute("#recent").tab, "recent");
  assert.equal(parseRoute("").tab, "");
  for (const bad of ["#token/", "#token/abc", "#token/0", "#token/18446744073709551616", "#token/1/../2", "#token/-5"]) {
    assert.equal(parseRoute(bad).assetId, null, bad);
    assert.notEqual(parseRoute(bad).tab, "token", bad);
  }
  assert.equal(tokenHash(5n), "#token/5");
  const wallet = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E";
  assert.deepEqual(parseRoute(`#creator/${wallet}`), { tab: "creator", assetId: null, address: wallet });
  for (const bad of ["#creator/", "#creator/abc", `#creator/${wallet}x`, `#creator/${wallet.toLowerCase()}`, `#creator/${wallet.slice(1)}`]) assert.notEqual(parseRoute(bad).tab, "creator", bad);
});

test("safety checklist passes for a clean launch and splits the liquidity honestly", () => {
  const checks = byId(buildSafetyChecks(good));
  for (const id of ["locked", "supply", "pool", "burn"]) assert.equal(checks[id].status, "pass", id);
  assert.match(checks.burn.title, /80\.0%/);
  assert.equal(checks.burn.link.id, "TX");
  assert.equal(checks.creator.status, "info");
  assert.equal(checks.platform.status, "info");
});

test("each safety check fails on its own", () => {
  assert.equal(byId(buildSafetyChecks({ ...good, asset: { ...asset, manager: "SOMEONE" } })).locked.status, "fail");
  assert.equal(byId(buildSafetyChecks({ ...good, asset: { ...asset, clawback: "SOMEONE" } })).locked.status, "fail");
  assert.equal(byId(buildSafetyChecks({ ...good, asset: { ...asset, creator: "OTHER" } })).locked.status, "fail");
  assert.equal(byId(buildSafetyChecks({ ...good, appTokenHolding: 5n })).supply.status, "fail");
  assert.equal(byId(buildSafetyChecks({ ...good, poolIsCanonical: false })).pool.status, "fail");
  assert.equal(byId(buildSafetyChecks({ ...good, burnHolding: 799n })).burn.status, "fail");
  assert.equal(byId(buildSafetyChecks({ ...good, launch: { ...launch, burnedLp: 500n, creatorLp: 250n, platformLp: 250n }, burnHolding: 500n })).burn.status, "fail");
});

test("an all-zero address counts as unset; unfinished launches only get the token check", () => {
  const zero = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
  assert.equal(byId(buildSafetyChecks({ ...good, asset: { ...asset, manager: zero } })).locked.status, "pass");
  assert.deepEqual(buildSafetyChecks({ ...good, launch: { ...launch, status: 3n } }).map((check) => check.id), ["locked"]);
  assert.deepEqual(buildSafetyChecks({ ...good, launch: null }).map((check) => check.id), ["locked"]);
});

test("burned percent", () => {
  assert.equal(burnedPercent(launch), 80);
  assert.equal(burnedPercent({ burnedLp: 0n, creatorLp: 0n, platformLp: 0n }), null);
  assert.equal(burnedPercent(null), null);
});

test("price and pool value from reserves", () => {
  // pool: 1,000,000 tokens (6 decimals) against 2,000 PNET; source pool prices 1 PNET at 0.5 ALGO
  const pool = { asset1Id: 77n, asset2Id: 5n, asset1Reserve: 1_000_000_000_000n, asset2Reserve: 2_000_000_000n };
  const source = { algoReserve: 500_000_000n, pnetReserve: 1_000_000_000n };
  const stats = tokenStats({ assetId: 77n, total: 1_000_000_000_000n, decimals: 6, pool, source });
  assert.equal(stats.tvlMicroAlgo, 2_000_000_000n); // 2 x 2,000 PNET x 0.5 ALGO = 2,000 ALGO
  assert.ok(Math.abs(stats.priceAlgo - 0.001) < 1e-12);
  assert.ok(Math.abs(stats.marketCapAlgo - 1000) < 1e-6);
  // the same pool read with the pair the other way round
  const flipped = tokenStats({ assetId: 77n, total: 1_000_000_000_000n, decimals: 6, pool: { asset1Id: 5n, asset2Id: 77n, asset1Reserve: 2_000_000_000n, asset2Reserve: 1_000_000_000_000n }, source });
  assert.equal(flipped.tvlMicroAlgo, stats.tvlMicroAlgo);
  assert.equal(formatPrice(0.001), "0.00100");
  assert.equal(formatPrice(0.000000444620), "0.000000445");
  assert.equal(formatPrice(12.34567), "12.3457");
  assert.equal(formatPrice(0), "0");
});

test("holders are ranked, labelled and zero balances dropped", () => {
  const rows = rankHolders({
    balances: [{ address: "B", amount: 100n }, { address: "POOL", amount: 800n }, { address: "C", amount: 0n }, { address: "A", amount: 100n }],
    total: 1000n, labels: { POOL: "Tinyman pool" },
  });
  assert.deepEqual(rows.map((row) => row.address), ["POOL", "B", "A"]);
  assert.equal(rows[0].percent, 80);
  assert.equal(rows[0].label, "Tinyman pool");
  assert.equal(rows[1].label, "");
  assert.equal(rankHolders({ balances: [{ address: "A", amount: 3n }, { address: "B", amount: 2n }], total: 5n, limit: 1 }).length, 1);
});

test("search, cancelled filter and sorting", () => {
  const items = [
    { assetId: 10n, name: "Alpha", unit: "AAA", status: 2n, tvlMicroAlgo: 5n },
    { assetId: 30n, name: "Gamma", unit: "GGG", status: 3n, tvlMicroAlgo: 0n },
    { assetId: 20n, name: "Beta", unit: "BBB", status: 2n, tvlMicroAlgo: 9n },
  ];
  assert.deepEqual(filterLaunches(items).map((i) => i.name), ["Alpha", "Beta"]);
  assert.equal(filterLaunches(items, { showCancelled: true }).length, 3);
  assert.deepEqual(filterLaunches(items, { query: "bbb" }).map((i) => i.name), ["Beta"]);
  assert.deepEqual(filterLaunches(items, { query: "10" }).map((i) => i.name), ["Alpha"]);
  assert.deepEqual(sortLaunches(items, "newest").map((i) => i.assetId), [30n, 20n, 10n]);
  assert.deepEqual(sortLaunches(items, "oldest").map((i) => i.assetId), [10n, 20n, 30n]);
  assert.deepEqual(sortLaunches(items, "pool").map((i) => i.assetId), [20n, 10n, 30n]);
});

test("share link: X intent with the token page, burn line only when the record shows it", () => {
  const url = new URL(shareOnXUrl({ name: "Tok‮en", unit: "TOK", assetId: 5n, burnedPct: 80, pageUrl: "https://easyalgo.org/#launch" }));
  assert.equal(url.origin + url.pathname, "https://x.com/intent/post");
  assert.equal(url.searchParams.get("url"), "https://easyalgo.org/#token/5");
  assert.match(url.searchParams.get("text"), /^Token \(\$TOK\) just launched on PNET LaunchLab\. 80% of its liquidity is burned\.$/);
  const plain = new URL(shareOnXUrl({ name: "Tok", unit: "", assetId: 5n, burnedPct: null, pageUrl: "https://easyalgo.org/" }));
  assert.equal(plain.searchParams.get("text"), "Tok just launched on PNET LaunchLab.");
});

test("placeholder badge is stable per token", () => {
  assert.deepEqual(placeholderBadge({ assetId: 7n, unit: "abc" }), placeholderBadge({ assetId: 7n, unit: "abc" }));
  assert.equal(placeholderBadge({ assetId: 7n, unit: "abc" }).mark, "AB");
  assert.equal(placeholderBadge({ assetId: 360n, unit: "" , name: ""}).hue, 0);
});
