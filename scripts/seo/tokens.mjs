// A real, shareable page for every launched token (`/token/<asset id>/`), written at build time from what the chain says at that moment, plus the sitemap
// entries and an Atom feed of the newest launches. Each page carries the app, so a visitor sees the live token page at the same address; a crawler or a
// link preview sees the static text and the page's own title, description and social card. Pure functions here; scripts/build-seo.mjs reads the chain.
import { formatUnits } from "../../src/launchpad/amounts.js";
import { burnedPercent, formatPrice } from "../../src/launchpad/tokenView.js";
import { SITE } from "../../src/seoContent.js";
import { isBanned } from "./banned.mjs";
import { abs, escapeHtml, footer, head, header, jsonLd } from "./render.mjs";

export const tokenPath = (assetId) => `/token/${BigInt(assetId)}/`;

const algo = (micro) => Number(formatUnits(micro, 6)).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const clip = (text, max) => (text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text);

/** The asset tags (stylesheet, scripts, preloads) of the built home page, so a generated page can load the same app. */
export function extractAssetTags(indexHtml) {
  const tags = [...indexHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\/assets\/[^"]+"[^>]*>(?:<\/script>)?/g)].map((match) => match[0]);
  if (!tags.some((tag) => tag.startsWith("<script"))) throw new Error("The built index.html has no app script to reuse");
  return tags;
}

/** What a token page says, from the token's chain detail (loadTokenDetail). Everything from the chain is escaped where it is written out. */
export function tokenPageModel(detail) {
  const { asset, launch, stats, checks } = detail;
  const id = detail.assetId.toString();
  const label = `${asset.name}${asset.unit ? ` (${asset.unit})` : ""}`;
  const burned = burnedPercent(launch);
  const pool = stats ? `${algo(stats.tvlMicroAlgo)} ALGO` : "n/a";
  const title = clip(`${label} on Algorand | PNET LaunchLab`, 62);
  const description = clip(
    `${label} launched on PNET LaunchLab: pool of ${pool}${burned !== null ? `, ${burned.toFixed(0)}% of its liquidity burned` : ""}, fixed supply, nothing hidden. See its live safety checklist.`,
    160,
  );
  return { id, label, burned, pool, title, description, path: tokenPath(id) };
}

export function renderTokenPage(detail, { assetTags, builtAt }) {
  const model = tokenPageModel(detail);
  const { asset, launch, stats, checks } = detail;
  const url = abs(model.path);
  const supply = Number(formatUnits(asset.total, asset.decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: SITE.name, item: abs("/") },
    { "@type": "ListItem", position: 2, name: "Recent launches", item: abs("/#recent") },
    { "@type": "ListItem", position: 3, name: model.label, item: url },
  ] };
  const webPage = { "@context": "https://schema.org", "@type": "WebPage", name: model.title, description: model.description, url, inLanguage: "en", isPartOf: { "@type": "WebSite", name: SITE.name, url: abs("/") } };
  return `<!doctype html>
<html lang="en">
  <head>
    ${head({ title: model.title, description: model.description, path: model.path, css: [], extra: `${assetTags.join("\n    ")}\n    ${jsonLd(breadcrumb)}\n    ${jsonLd(webPage)}` })}
  </head>
  <body>
    <div id="root"><div class="shell">
    ${header()}
    <main class="seo-page">
      <nav class="seo-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/#recent">Recent launches</a> <span aria-hidden="true">/</span> <span>${escapeHtml(model.label)}</span></nav>
      <article>
        <h1>${escapeHtml(asset.name)}${asset.unit ? ` <span class="launch-unit">${escapeHtml(asset.unit)}</span>` : ""}</h1>
        <p class="seo-lead">${escapeHtml(asset.name)} is an Algorand token launched on PNET LaunchLab. When this page was built its Tinyman pool held about ${escapeHtml(model.pool)}${model.burned !== null ? ` and ${model.burned.toFixed(1)}% of its liquidity was burned` : ""}.</p>
        <ul class="seo-facts">
          <li>Pool value: ${escapeHtml(model.pool)}</li>
          ${stats ? `<li>Price: ${escapeHtml(formatPrice(stats.priceAlgo))} ALGO</li>` : ""}
          <li>Total supply: ${escapeHtml(supply)}</li>
          <li>Asset ID: ${escapeHtml(model.id)}</li>
          <li>Launched by <a href="/#creator/${escapeHtml(launch.launcher)}">${escapeHtml(launch.launcher.slice(0, 5))}…${escapeHtml(launch.launcher.slice(-5))}</a></li>
        </ul>
        <h2>Safety checklist</h2>
        <ul>${checks.map((check) => `<li><strong>${escapeHtml(check.title)}.</strong> ${escapeHtml(check.detail)}</li>`).join("")}</ul>
        <p class="seo-cta"><a class="trade-button" href="https://vestige.fi/asset/${escapeHtml(model.id)}" target="_blank" rel="noopener noreferrer">Trade on Vestige ↗</a> <a class="trade-button trade-button--ghost" href="/#launch">Launch your own token</a></p>
        <p class="seo-updated">Snapshot taken ${escapeHtml(builtAt.toISOString().replace("T", " ").slice(0, 16))} UTC. The live page, with the price chart, top holders and replies, loads over this one.</p>
      </article>
    </main>
    ${footer()}
    </div></div>
  </body>
</html>
`;
}

/** Atom feed of the newest launches. `timestamp` is the block time of the launch (seconds), so an entry's date never changes between builds. */
export function atomFeed(entries, builtAt) {
  const items = entries.map((entry) => {
    const link = abs(tokenPath(entry.assetId));
    const summary = `${entry.name}${entry.unit ? ` (${entry.unit})` : ""} just launched on PNET LaunchLab with a Tinyman pool of ${entry.pool}${entry.burned !== null ? ` and ${entry.burned.toFixed(0)}% of its liquidity burned` : ""}.`;
    return `  <entry>
    <id>${escapeHtml(link)}</id>
    <title>${escapeHtml(`New launch: ${entry.name}${entry.unit ? ` (${entry.unit})` : ""}`)}</title>
    <link rel="alternate" type="text/html" href="${escapeHtml(link)}" />
    <updated>${new Date(entry.timestamp * 1000).toISOString()}</updated>
    <summary>${escapeHtml(summary)}</summary>
  </entry>`;
  });
  const newest = entries.length ? Math.max(...entries.map((entry) => entry.timestamp)) * 1000 : builtAt.getTime();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${abs("/feed.xml")}</id>
  <title>${escapeHtml(SITE.name)}: new Algorand token launches</title>
  <subtitle>Tokens launched on ${escapeHtml(SITE.name)}, newest first.</subtitle>
  <link rel="self" type="application/atom+xml" href="${abs("/feed.xml")}" />
  <link rel="alternate" type="text/html" href="${abs("/")}" />
  <updated>${new Date(newest).toISOString()}</updated>
${items.join("\n")}
</feed>
`;
}

/** Everything the build writes for tokens: `files` (path under dist -> text), the sitemap paths and the feed. `details` are loadTokenDetail results of finished launches. */
export function buildTokenFiles(details, { indexHtml, builtAt, timestamps = new Map(), feedSize = 20 }) {
  const assetTags = extractAssetTags(indexHtml);
  const finished = details.filter((detail) => detail.found && detail.launch.status === 2n);
  // A token whose own name carries the banned name gets no page of its own (a guard that failed the whole build would let anyone stop every deploy)
  const skipped = finished.filter((detail) => isBanned(detail.asset.name, detail.asset.unit, detail.asset.url));
  const live = finished.filter((detail) => !skipped.includes(detail));
  const files = new Map();
  for (const detail of live) files.set(`token/${detail.assetId}/index.html`, renderTokenPage(detail, { assetTags, builtAt }));
  const newest = [...live].sort((a, b) => (a.assetId === b.assetId ? 0 : a.assetId > b.assetId ? -1 : 1)).slice(0, feedSize);
  const feedEntries = newest.map((detail) => {
    const model = tokenPageModel(detail);
    return { assetId: detail.assetId, name: detail.asset.name, unit: detail.asset.unit, pool: model.pool, burned: model.burned, timestamp: timestamps.get(detail.assetId.toString()) ?? Math.floor(builtAt.getTime() / 1000) };
  });
  return { files, paths: live.map((detail) => tokenPath(detail.assetId)), feed: atomFeed(feedEntries, builtAt), assetTags, skipped: skipped.map((detail) => detail.assetId.toString()) };
}
