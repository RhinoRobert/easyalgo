// Runs after `vite build`: writes the crawlable pages, sitemap and robots.txt into dist/ and pre-renders the home page's text into dist/index.html.
//   node scripts/build-seo.mjs [dist directory]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAQ_PAGE, PAGES } from "../src/seoContent.js";
import { buildHomeHtml, notFoundHtml, renderFaqPage, renderGuidePage, robotsTxt, sitemapXml } from "./seo/render.mjs";

const dist = process.argv[2] ?? "dist";
const assets = join(dist, "assets");
const css = readdirSync(assets).filter((name) => name.endsWith(".css")).map((name) => `/assets/${name}`);
if (!css.length) throw new Error("No stylesheet found in dist/assets; run `vite build` first");

const write = (relative, content) => {
  const target = join(dist, relative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
};

write("index.html", buildHomeHtml(readFileSync(join(dist, "index.html"), "utf8")));
for (const page of PAGES) write(`${page.slug}/index.html`, renderGuidePage(page, css));
write(`${FAQ_PAGE.slug}/index.html`, renderFaqPage(css));
write("404.html", notFoundHtml(css));
write("sitemap.xml", sitemapXml());
write("robots.txt", robotsTxt());
// The published files must never carry a name this site chose not to use (checked on every build, over every text file in dist/).
const banned = new RegExp(["rug", "ninja"].join("\\.?\\s?") + "|" + ["rug", "inja"].join(""), "i");
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
for (const file of walk(dist).filter((path) => /\.(html|js|css|txt|xml|svg|json)$/i.test(path))) {
  if (banned.test(readFileSync(file, "utf8"))) throw new Error(`${file} contains a banned name; refusing to publish`);
}

console.log(`SEO files written to ${dist}: home pre-render, ${PAGES.length + 1} pages, 404, sitemap, robots`);
