import test from "node:test";
import assert from "node:assert/strict";
import { buildSafetyChecks } from "../src/launchpad/tokenView.js";
import { notFoundHtml, sitemapXml } from "../scripts/seo/render.mjs";
import { atomFeed, buildTokenFiles, extractAssetTags, renderTokenPage, tokenPageModel, tokenPath } from "../scripts/seo/tokens.mjs";
import { isBanned } from "../scripts/seo/banned.mjs";

const INDEX = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-AAA.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-BBB.js"><link rel="stylesheet" crossorigin href="/assets/index-CCC.css"></head><body><div id="root"></div></body></html>';
const LAUNCHER = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E";
const APP = "APPADDRESS";
const BUILT = new Date("2026-10-26T12:30:45Z");

function detail(id, name, { unit = "MCAT", status = 2n, found = true, tvl = 2_015_366n, url = "" } = {}) {
  const asset = { name, unit, url, total: 1_000_000_000_000n, decimals: 6, creator: APP };
  const launch = { status, launcher: LAUNCHER, burnedLp: 800n, creatorLp: 100n, platformLp: 100n, creatorLpClaimed: 0n, poolAddress: "POOL", lpAssetId: 9n, terminalRound: 66_000_000n, createdRound: 65_999_000n, terminalTxId: "TX" };
  return {
    found, assetId: BigInt(id), asset, launch, stats: { tvlMicroAlgo: tvl, priceAlgo: 0.000001 },
    checks: buildSafetyChecks({ asset, launch, appAddress: APP, appTokenHolding: 0n, poolIsCanonical: true, burnHolding: 800n }),
  };
}
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the app's script, preloads and stylesheet are taken from the built home page", () => {
  const tags = extractAssetTags(INDEX);
  assert.equal(tags.length, 3);
  assert.ok(tags[0].startsWith('<script type="module"') && tags[0].endsWith("</script>"));
  assert.throws(() => extractAssetTags("<html><head></head></html>"), /no app script/);
});

test("a token page has its own title, description, canonical address and social tags, one h1, and loads the app", () => {
  const html = renderTokenPage(detail(3753721447, "Moon Cat"), { assetTags: extractAssetTags(INDEX), builtAt: BUILT });
  const model = tokenPageModel(detail(3753721447, "Moon Cat"));
  assert.equal(model.title, "Moon Cat (MCAT) on Algorand | PNET LaunchLab");
  assert.ok(model.title.length <= 62 && model.description.length <= 160);
  assert.match(model.description, /pool of 2\.02 ALGO, 80% of its liquidity burned/);
  assert.ok(html.includes(`<title>${model.title}</title>`));
  assert.match(html, /rel="canonical" href="https:\/\/easyalgo\.org\/token\/3753721447\/"/);
  assert.match(html, /og:url" content="https:\/\/easyalgo\.org\/token\/3753721447\/"/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(html, /<script type="module" crossorigin src="\/assets\/index-AAA\.js"><\/script>/);
  assert.match(html, /<div id="root"><div class="shell">/);
  assert.match(text(html), /Safety checklist/);
  assert.match(text(html), /Snapshot taken 2026-10-26 12:30 UTC/);
  const ld = [...html.matchAll(/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(ld.map((block) => block["@type"]), ["BreadcrumbList", "WebPage"]);
});

test("whatever a token is called, it can not inject markup into its page", () => {
  const hostile = detail(5, '<script>alert(1)</script><img src=x onerror=alert(2)> & "q"', { unit: "<b>", url: '"><svg onload=1>' });
  const html = renderTokenPage(hostile, { assetTags: extractAssetTags(INDEX), builtAt: BUILT });
  assert.ok(!html.includes("<script>alert(1)"), "script tag escaped");
  assert.ok(!html.includes("<img src=x"), "image tag escaped");
  assert.ok(!html.includes("<b></span>") && html.includes("&lt;b&gt;"), "the ticker is escaped too");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((html.match(/<script/g) ?? []).length, 1 + 2 + 1, "only the app script, the two structured-data blocks and the theme script");
});

test("a very long name is shortened in the title and description, not allowed to overflow them", () => {
  const model = tokenPageModel(detail(7, "N".repeat(32), { unit: "ABCDEFGH" }));
  assert.ok(model.title.length <= 62, `title ${model.title.length}`);
  assert.ok(model.title.endsWith("…") || model.title.length <= 62);
  assert.ok(model.description.length <= 160);
});

test("only finished launches get a page; cancelled, unknown and banned-name tokens are skipped without failing the build", () => {
  const banned = ["rug", "ninja"].join("");
  const built = buildTokenFiles(
    [detail(10, "Alpha"), detail(11, "Gone", { status: 3n }), detail(12, "Missing", { found: false }), detail(13, `${banned} clone`), detail(14, "Bravo", { unit: banned })],
    { indexHtml: INDEX, builtAt: BUILT },
  );
  assert.deepEqual(built.paths, ["/token/10/"]);
  assert.deepEqual([...built.files.keys()], ["token/10/index.html"]);
  assert.deepEqual(built.skipped, ["13", "14"]);
  assert.ok(!isBanned(built.feed) && !isBanned(built.files.get("token/10/index.html")));
  assert.ok(isBanned(`${banned} clone`) && isBanned(["Rug", "Ninja"].join(".")) && !isBanned("Moon Cat"));
});

test("the feed lists the newest launches first, with dates that come from the chain and never change between builds", () => {
  const details = [detail(20, "Old"), detail(30, "New"), detail(25, "Mid")];
  const timestamps = new Map([["20", 1_000], ["30", 3_000], ["25", 2_000]]);
  const built = buildTokenFiles(details, { indexHtml: INDEX, builtAt: BUILT, timestamps });
  const ids = [...built.feed.matchAll(/<id>https:\/\/easyalgo\.org\/token\/(\d+)\/<\/id>/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["30", "25", "20"]);
  assert.match(built.feed, /<updated>1970-01-01T00:50:00\.000Z<\/updated>/, "the feed is as new as its newest launch");
  const again = buildTokenFiles(details, { indexHtml: INDEX, builtAt: new Date("2027-01-01T00:00:00Z"), timestamps });
  assert.equal(again.feed, built.feed, "an entry's date does not depend on when the site was built");
  assert.equal(buildTokenFiles(details, { indexHtml: INDEX, builtAt: BUILT, timestamps, feedSize: 2 }).feed.match(/<entry>/g).length, 2);
  assert.match(atomFeed([], BUILT), /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.ok(atomFeed([{ assetId: 1n, name: "A & <B>", unit: "", pool: "1 ALGO", burned: null, timestamp: 5 }], BUILT).includes("A &amp; &lt;B&gt;"));
});

test("the sitemap lists the token pages and the 404 page is the app's, with the brand card and noindex", () => {
  assert.match(sitemapXml(["/token/10/", "/token/11/"], "2026-10-26"), /<loc>https:\/\/easyalgo\.org\/token\/11\/<\/loc><lastmod>2026-10-26<\/lastmod>/);
  assert.equal(tokenPath(5n), "/token/5/");
  const notFound = notFoundHtml(["/assets/x.css"], extractAssetTags(INDEX));
  assert.match(notFound, /noindex/);
  assert.match(notFound, /<script type="module"/);
  assert.match(notFound, /<div id="root">/);
  assert.match(notFound, /<title>Algorand Launchpad: Launch a Token with Liquidity \| LaunchLab<\/title>/, "a link shared before the token's page exists still previews as the brand");
  assert.ok(!/Page not found \|/.test(notFound.match(/<title>.*?<\/title>/)[0]));
});
