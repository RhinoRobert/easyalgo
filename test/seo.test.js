import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALL_PATHS, FAQ, FAQ_PAGE, GUIDE_LINKS, HOME, PAGES, SITE, plain } from "../src/seoContent.js";
import { buildHomeHtml, faqJsonLd, inline, notFoundHtml, renderFaqPage, renderGuidePage, renderHomePrerender, robotsTxt, sitemapXml } from "../scripts/seo/render.mjs";
import { estimatedLaunchCost } from "../src/launchpad/quote.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (path) => readFileSync(join(root, path), "utf8");
const CSS = ["/assets/index-test.css"];
const pages = () => [
  ...PAGES.map((page) => ({ path: `/${page.slug}/`, title: page.title, description: page.description, html: renderGuidePage(page, CSS) })),
  { path: `/${FAQ_PAGE.slug}/`, title: FAQ_PAGE.title, description: FAQ_PAGE.description, html: renderFaqPage(CSS) },
];
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const jsonLdBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1].replace(/\\u003c/g, "<")));

test("the home page's own tags match the shared content (index.html is what a crawler first sees)", () => {
  const html = read("index.html");
  assert.equal(/<title>(.*?)<\/title>/.exec(html)[1], HOME.title);
  assert.equal(/name="description" content="(.*?)"/.exec(html)[1], HOME.description);
  assert.match(html, /rel="canonical" href="https:\/\/easyalgo\.org\/"/);
  assert.equal(/og:title" content="(.*?)"/.exec(html)[1], HOME.title);
  assert.equal(/og:description" content="(.*?)"/.exec(html)[1], HOME.description);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  const [graph] = jsonLdBlocks(html);
  assert.deepEqual(graph["@graph"].map((node) => node["@type"]), ["WebSite", "Organization", "WebApplication"]);
});

test("titles and descriptions fit what search results show, and every page is unique", () => {
  const all = [{ path: "/", title: HOME.title, description: HOME.description }, ...pages()];
  for (const page of all) {
    assert.ok(page.title.length >= 25 && page.title.length <= 62, `${page.path} title is ${page.title.length} characters`);
    assert.ok(page.description.length >= 70 && page.description.length <= 160, `${page.path} description is ${page.description.length} characters`);
  }
  assert.equal(new Set(all.map((page) => page.title)).size, all.length, "duplicate titles");
  assert.equal(new Set(all.map((page) => page.description)).size, all.length, "duplicate descriptions");
  assert.ok(all.every((page) => /algorand/i.test(page.title)), "every title names Algorand");
});

test("each static page has one h1, a canonical URL, valid structured data and real content", () => {
  for (const page of pages()) {
    const h1 = page.html.match(/<h1[ >]/g) ?? [];
    assert.equal(h1.length, 1, `${page.path} h1 count`);
    assert.match(page.html, new RegExp(`rel="canonical" href="https://easyalgo\\.org${page.path}"`));
    assert.match(page.html, /<html lang="en"/);
    assert.match(page.html, /name="robots" content="index,follow/);
    assert.ok(jsonLdBlocks(page.html).length >= 2, `${page.path} structured data`);
    assert.ok(text(page.html).split(" ").length >= 380, `${page.path} has too little text`);
    assert.match(page.html, /og:image" content="https:\/\/easyalgo\.org\/og-image\.png"/);
    assert.ok(!/<script(?![^>]*ld\+json)/.test(page.html), `${page.path} must not need scripts`);
  }
  const notFound = notFoundHtml(CSS);
  assert.match(notFound, /noindex/);
});

test("the FAQ structured data is exactly the FAQ people can read, on the FAQ page, the home page and in the app", () => {
  const data = faqJsonLd();
  assert.equal(data["@type"], "FAQPage");
  assert.equal(data.mainEntity.length, FAQ.length);
  const faqPage = renderFaqPage(CSS);
  const home = renderHomePrerender();
  for (const [index, item] of FAQ.entries()) {
    assert.equal(data.mainEntity[index].name, item.q);
    assert.equal(data.mainEntity[index].acceptedAnswer.text, plain(item.a));
    assert.ok(text(faqPage).includes(plain(item.q)) && text(faqPage).includes(plain(item.a).slice(0, 60)), `FAQ page shows: ${item.q}`);
    assert.ok(text(home).includes(plain(item.q)), `home shows: ${item.q}`);
  }
  assert.ok(read("src/components/Faq.jsx").includes("FAQ.map"), "the app renders the same list");
  const built = buildHomeHtml('<html><head></head><body><div id="root"></div></body></html>');
  assert.equal([...built.matchAll(/"@type":"FAQPage"/g)].length, 1);
  assert.match(built, /<div id="root"><div class="shell">/);
  assert.throws(() => buildHomeHtml("<html><head></head><body></body></html>"), /empty root/);
});

test("content links stay on this site or https, and never turn page text into markup", () => {
  assert.equal(inline("<b>x</b> & \"y\""), "&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;");
  assert.equal(inline("see [the FAQ](/faq/) now"), 'see <a href="/faq/">the FAQ</a> now');
  assert.match(inline("[ext](https://example.com/a)"), /target="_blank" rel="noopener noreferrer"/);
  assert.equal(inline("[bad](javascript:alert(1))"), "[bad](javascript:alert(1))", "only / and https:// become links");
  assert.equal(plain("see [the FAQ](/faq/)"), "see the FAQ");
  const known = new Set(ALL_PATHS);
  for (const page of [...pages(), { path: "/", html: renderHomePrerender() }]) {
    for (const [, href] of page.html.matchAll(/href="([^"]+)"/g)) {
      if (/^https:\/\//.test(href) || href.startsWith("/assets/") || /^\/(favicon|icon|apple|og)/.test(href)) continue;
      const path = href.split("#")[0] || "/";
      assert.ok(href.startsWith("/#") || known.has(path), `${page.path} links to ${href}, which is not a page of this site`);
    }
  }
  assert.ok(GUIDE_LINKS.every((link) => known.has(link.href)));
});

test("sitemap and robots list every page and point crawlers at each other", () => {
  const sitemap = sitemapXml();
  for (const path of ALL_PATHS) assert.ok(sitemap.includes(`<loc>${SITE.origin}${path}</loc>`), `${path} is in the sitemap`);
  assert.ok(!sitemap.includes("404") && !sitemap.includes("#"));
  const robots = robotsTxt();
  assert.match(robots, /User-agent: \*\nAllow: \//);
  assert.match(robots, /Sitemap: https:\/\/easyalgo\.org\/sitemap\.xml/);
  for (const file of ["favicon.svg", "icon-192.png", "apple-touch-icon.png", "og-image.png"]) assert.ok(existsSync(join(root, "public", file)), `public/${file} exists`);
  assert.ok(statSync(join(root, "public/og-image.png")).size > 20_000);
});

test("the copy states the same numbers the contract enforces", () => {
  const contract = read("contracts/launchpad_v3/contract.py");
  const constant = (name) => Number(new RegExp(`${name} = ([0-9_]+)`).exec(contract)[1].replace(/_/g, ""));
  assert.equal(constant("BURN_BPS") / 100, 80, "80% burned");
  assert.equal(constant("ALGO_SWAP_INPUT"), 1_000_000, "exactly 1 ALGO");
  const hours = (constant("MAINNET_CANCEL_DELAY_ROUNDS") * 2.8) / 3600;
  assert.equal(hours.toFixed(1), "2.3", "cancel after about 2.3 hours");
  const cost = estimatedLaunchCost();
  assert.equal((Number(cost.spent) / 1e6).toFixed(1), "2.7", "about 2.7 ALGO");
  assert.equal(Math.round(Number(cost.keepAvailable) / 1e6), 3, "keep 3 ALGO (the page rounds the same way)");
  const everything = JSON.stringify([HOME, FAQ, PAGES]);
  assert.match(everything, /about 2\.7 ALGO/);
  assert.match(everything, /about 2\.3 hours/);
  assert.match(everything, /80%/);
  assert.match(everything, /not yet had a paid third-party audit/, "the copy is honest about the audit status");
});

test("the banned name appears nowhere a visitor, a crawler or the public repository can see it", () => {
  const banned = new RegExp(["rug", "ninja"].join("\\.?\\s?") + "|" + ["rug", "inja"].join(""), "i");
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(join(root, directory))) {
      const path = join(directory, name);
      if (["node_modules", "dist", ".git", ".venv", ".venv-v2", "__pycache__", "artifacts"].includes(name)) continue;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.(jsx?|mjs|css|html|md|json|py|txt|xml|svg)$/i.test(name)) files.push(path);
    }
  };
  for (const directory of ["src", "public", "scripts", "docs", "test", "contracts/tests", "contracts/launchpad_v3"]) walk(directory);
  files.push("index.html", "README.md", "REVIEW.md");
  const offenders = files.filter((path) => path !== "test/seo.test.js" && banned.test(read(path)));
  assert.deepEqual(offenders, []);
  for (const page of [...pages(), { html: renderHomePrerender() }, { html: notFoundHtml(CSS) }, { html: sitemapXml() + robotsTxt() }]) assert.ok(!banned.test(page.html));
});
