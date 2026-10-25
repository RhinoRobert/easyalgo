// Runs after `vite build`: writes the crawlable pages, sitemap, feed and robots.txt into dist/, pre-renders the home page's text into dist/index.html, and
// writes a page for every launched token.
//   node scripts/build-seo.mjs [dist directory]
// Token pages need the chain: in CI (the scheduled GitHub Pages build) a failed read FAILS the build, so the previous site stays live and tokens never vanish
// from it; on a developer machine a failed read only warns. SEO_TOKENS=off skips them. ALGOD_URL / INDEXER_URL override the public MainNet nodes.
import algosdk from "algosdk";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORKS } from "../src/launchpad/config.js";
import { mapLimit } from "../src/launchpad/format.js";
import { readRecentRecords } from "../src/launchpad/directory.js";
import { loadTokenDetail } from "../src/launchpad/tokenDetail.js";
import { FAQ_PAGE, PAGES } from "../src/seoContent.js";
import { BANNED } from "./seo/banned.mjs";
import { buildHomeHtml, notFoundHtml, renderFaqPage, renderGuidePage, robotsTxt, sitemapXml } from "./seo/render.mjs";
import { buildTokenFiles, extractAssetTags } from "./seo/tokens.mjs";

const dist = process.argv[2] ?? "dist";
const strict = Boolean(process.env.CI);
const assets = join(dist, "assets");
const css = readdirSync(assets).filter((name) => name.endsWith(".css")).map((name) => `/assets/${name}`);
if (!css.length) throw new Error("No stylesheet found in dist/assets; run `vite build` first");

const write = (relative, content) => {
  const target = join(dist, relative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
};

/** Every finished launch's chain detail, plus the block time of the newest ones (for the feed). */
async function readLaunchedTokens() {
  const algodClient = new algosdk.Algodv2("", process.env.ALGOD_URL ?? "https://mainnet-api.algonode.cloud", 443);
  const indexerClient = new algosdk.Indexer("", process.env.INDEXER_URL ?? "https://mainnet-idx.algonode.cloud", 443);
  const config = { ...NETWORKS.mainnet, launchpadAppId: BigInt(process.env.VITE_LAUNCHPAD_APP_ID ?? "3753531793") };
  const { records } = await readRecentRecords({ algodClient, config, limit: 300 });
  const finished = records.filter((record) => record.status === 2n && record.poolAddress);
  const results = await mapLimit(finished, 3, async (record) => {
    try { return await loadTokenDetail({ algodClient, indexerClient, config, assetId: record.assetId }); } catch (error) { return { failed: record.assetId, error }; }
  });
  const failed = results.filter((result) => result.failed);
  // one token failing to read is skipped for this build; most of them failing means the chain could not be reached
  if (failed.length && failed.length * 2 > finished.length) throw new Error(`${failed.length} of ${finished.length} tokens could not be read: ${failed[0].error?.message}`);
  for (const result of failed) console.warn(`Token ${result.failed} skipped: ${result.error?.message}`);
  const details = results.filter((result) => !result.failed);
  const timestamps = new Map();
  const newest = [...details].sort((a, b) => (a.assetId === b.assetId ? 0 : a.assetId > b.assetId ? -1 : 1)).slice(0, 20);
  await mapLimit(newest, 3, async (detail) => {
    try { timestamps.set(detail.assetId.toString(), Number((await indexerClient.lookupBlock(Number(detail.launch.terminalRound)).do()).timestamp)); } catch { /* the feed falls back to the build time */ }
  });
  return { details, timestamps };
}

const builtAt = new Date();
const today = builtAt.toISOString().slice(0, 10);
const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
const assetTags = extractAssetTags(indexHtml);

write("index.html", buildHomeHtml(indexHtml));
for (const page of PAGES) write(`${page.slug}/index.html`, renderGuidePage(page, css));
write(`${FAQ_PAGE.slug}/index.html`, renderFaqPage(css));
write("404.html", notFoundHtml(css, assetTags));
write("robots.txt", robotsTxt());

let tokenPaths = [];
let summary = "no token pages (skipped)";
if (process.env.SEO_TOKENS !== "off") {
  try {
    const { details, timestamps } = await readLaunchedTokens();
    const built = buildTokenFiles(details, { indexHtml, builtAt, timestamps });
    for (const [path, html] of built.files) write(path, html);
    write("feed.xml", built.feed);
    tokenPaths = built.paths;
    summary = `${built.paths.length} token pages${built.skipped.length ? ` (${built.skipped.length} skipped)` : ""}, feed`;
  } catch (error) {
    if (strict) throw new Error(`Token pages could not be built, so nothing is published: ${error.message}`);
    console.warn(`Token pages skipped (not in CI): ${error.message}`);
  }
}
write("sitemap.xml", sitemapXml(tokenPaths, today));

// The published files must never carry a name this site chose not to use (checked on every build, over every text file in dist/).
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
for (const file of walk(dist).filter((path) => /\.(html|js|css|txt|xml|svg|json)$/i.test(path))) {
  if (BANNED.test(readFileSync(file, "utf8"))) throw new Error(`${file} contains a banned name; refusing to publish`);
}

console.log(`SEO files written to ${dist}: home pre-render, ${PAGES.length + 1} pages, 404, sitemap, robots, ${summary}`);
