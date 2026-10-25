// Turns src/seoContent.js into the crawlable files: the static guide pages, the pre-rendered home page, the sitemap, robots.txt and the 404 page.
// Pure functions (strings in, strings out) so every rule can be tested; scripts/build-seo.mjs does the file work after `vite build`.
import { ALL_PATHS, FAQ, FAQ_PAGE, GUIDE_LINKS, HOME, PAGES, SITE, plain } from "../../src/seoContent.js";

export const SOCIAL_IMAGE = { path: "/og-image.png", width: 1200, height: 630, alt: "Algorand launchpad: launch a token with instant Tinyman liquidity" };

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LINK = /\[([^\]]+)\]\((\/[^)\s]*|https:\/\/[^)\s]+)\)/g;

/** Escaped text with `[label](/path/)` turned into links. Nothing else in the content is ever treated as markup. */
export function inline(text) {
  return escapeHtml(text).replace(LINK, (_match, label, url) => {
    const external = url.startsWith("https://");
    return `<a href="${url}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
  });
}

export const abs = (path) => `${SITE.origin}${path}`;
export const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

export function faqJsonLd(items = FAQ) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: plain(item.a) } })) };
}

export const guideList = () => `<ul class="seo-related">${GUIDE_LINKS.map((link) => `<li><a href="${link.href}">${escapeHtml(link.label)}</a></li>`).join("")}</ul>`;

export function head({ title, description, path, type = "website", css, extra = "", robots = "index,follow,max-snippet:-1,max-image-preview:large" }) {
  const url = abs(path);
  return `<meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#08071a" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${robots}" />
    <link rel="canonical" href="${url}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="${SITE.name}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${abs(SOCIAL_IMAGE.path)}" />
    <meta property="og:image:width" content="${SOCIAL_IMAGE.width}" />
    <meta property="og:image:height" content="${SOCIAL_IMAGE.height}" />
    <meta property="og:image:alt" content="${escapeHtml(SOCIAL_IMAGE.alt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${abs(SOCIAL_IMAGE.path)}" />
    ${css.map((href) => `<link rel="stylesheet" href="${href}" />`).join("\n    ")}
    ${extra}`;
}

export const header = () => `<header class="shell-header">
      <a class="shell-brand seo-brand" href="/"><span class="shell-mark" aria-hidden="true">P</span><div><strong>${SITE.name}</strong><span>Algorand asset + Tinyman liquidity launcher</span></div></a>
      <nav class="seo-nav" aria-label="Main"><a href="/#launch">Launch a token</a><a href="/#recent">Recent launches</a><a href="/faq/">FAQ</a></nav>
    </header>`;

export const footer = () => `<footer class="terms">
      <nav aria-label="Guides"><strong>Guides</strong>${guideList()}</nav>
      <p class="terms-line">A <a href="${SITE.parent.url}" target="_blank" rel="noopener noreferrer">${SITE.parent.name}</a> project. Source code on <a href="${SITE.source}" target="_blank" rel="noopener noreferrer">GitHub</a>.</p>
      <p class="terms-line">Beta software. Tokens launched here are permanent, and nothing on this site is financial, legal or tax advice. Use only amounts you can afford to lose.</p>
    </footer>`;

function sectionHtml(section) {
  return `<section>
        <h2>${escapeHtml(section.h2)}</h2>
        ${(section.paragraphs ?? []).map((text) => `<p>${inline(text)}</p>`).join("\n        ")}
        ${section.list ? `<ul>${section.list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>` : ""}
      </section>`;
}

const cta = () => `<p class="seo-cta"><a class="trade-button" href="/#launch">Launch a token</a> <a class="trade-button trade-button--ghost" href="/#recent">See recent launches</a></p>`;

function pageShell({ title, description, path, type, css, extra, body, breadcrumb }) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    ${head({ title, description, path, type, css, extra })}
  </head>
  <body>
    <div class="shell">
    ${header()}
    <main class="seo-page">
      <nav class="seo-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">/</span> <span>${escapeHtml(breadcrumb)}</span></nav>
      ${body}
    </main>
    ${footer()}
    </div>
  </body>
</html>
`;
}

const breadcrumbLd = (name, path) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: [{ "@type": "ListItem", position: 1, name: SITE.name, item: abs("/") }, { "@type": "ListItem", position: 2, name, item: abs(path) }],
});

const articleLd = (page, path) => ({
  "@context": "https://schema.org", "@type": "Article", headline: page.h1, description: page.description, mainEntityOfPage: abs(path),
  dateModified: SITE.updated, datePublished: SITE.updated, inLanguage: "en",
  author: { "@type": "Organization", name: SITE.parent.name, url: SITE.parent.url },
  publisher: { "@type": "Organization", name: SITE.name, url: abs("/") },
  image: abs(SOCIAL_IMAGE.path),
});

export function renderGuidePage(page, css) {
  const path = `/${page.slug}/`;
  return pageShell({
    title: page.title, description: page.description, path, type: "article", css, breadcrumb: page.h1,
    extra: `${jsonLd(breadcrumbLd(page.h1, path))}\n    ${jsonLd(articleLd(page, path))}`,
    body: `<article>
      <h1>${escapeHtml(page.h1)}</h1>
      <p class="seo-lead">${inline(page.lead)}</p>
      ${page.sections.map(sectionHtml).join("\n      ")}
      ${cta()}
      <p class="seo-updated">Last updated ${SITE.updated}.</p>
      </article>`,
  });
}

export function renderFaqPage(css) {
  const path = `/${FAQ_PAGE.slug}/`;
  return pageShell({
    title: FAQ_PAGE.title, description: FAQ_PAGE.description, path, css, breadcrumb: FAQ_PAGE.h1,
    extra: `${jsonLd(breadcrumbLd(FAQ_PAGE.h1, path))}\n    ${jsonLd(faqJsonLd())}`,
    body: `<article>
      <h1>${escapeHtml(FAQ_PAGE.h1)}</h1>
      <p class="seo-lead">${inline(FAQ_PAGE.lead)}</p>
      <div class="seo-faq">${FAQ.map((item) => `<section><h2>${escapeHtml(item.q)}</h2><p>${inline(item.a)}</p></section>`).join("\n      ")}</div>
      ${cta()}
      <p class="seo-updated">Last updated ${SITE.updated}.</p>
      </article>`,
  });
}

/** What goes inside <div id="root"> in the built home page: the same text the app shows, readable without JavaScript. React replaces it on load. */
export function renderHomePrerender() {
  return `<div class="shell">
    ${header()}
    <main class="shell-main"><section class="launchlab-page instant-launch seo-home">
      <noscript><p class="instant-warning">Launching a token needs JavaScript and Pera Wallet. The guides below work without them.</p></noscript>
      <div class="instant-hero">
        <div class="af-section-eyebrow">Algorand launchpad</div>
        <h1>${escapeHtml(HOME.h1)}</h1>
        <p>${escapeHtml(HOME.intro)}</p>
        <ol class="how-it-works">${HOME.steps.map((step, index) => `<li><span class="how-it-works-n">${index + 1}</span><div><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.text)}</small></div></li>`).join("")}</ol>
      </div>
      <ul class="seo-facts">${HOME.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>
      <p class="seo-cta"><a class="trade-button" href="/#launch">Launch a token</a> <a class="trade-button trade-button--ghost" href="/#recent">See recent launches</a></p>
      <h2>Frequently asked questions</h2>
      <div class="seo-faq">${FAQ.map((item) => `<section><h3>${escapeHtml(item.q)}</h3><p>${inline(item.a)}</p></section>`).join("")}</div>
      <h2>Guides</h2>
      ${guideList()}
    </section></main>
    ${footer()}
  </div>`;
}

/** Injects the pre-rendered content and the FAQ structured data into the built index.html. Fails loudly if the page is not in the expected shape. */
export function buildHomeHtml(indexHtml) {
  if (!indexHtml.includes('<div id="root"></div>')) throw new Error("index.html does not contain the empty root element");
  if (!indexHtml.includes("</head>")) throw new Error("index.html has no </head>");
  return indexHtml
    .replace("</head>", `    ${jsonLd(faqJsonLd())}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${renderHomePrerender()}</div>`);
}

export function sitemapXml(tokenPaths = [], builtOn = SITE.updated) {
  const urls = [
    ...ALL_PATHS.map((path) => `  <url><loc>${abs(path)}</loc><lastmod>${SITE.updated}</lastmod><changefreq>${path === "/" ? "daily" : "monthly"}</changefreq><priority>${path === "/" ? "1.0" : "0.7"}</priority></url>`),
    ...tokenPaths.map((path) => `  <url><loc>${abs(path)}</loc><lastmod>${builtOn}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export const robotsTxt = () => `User-agent: *\nAllow: /\n\nSitemap: ${abs("/sitemap.xml")}\n`;

/**
 * The page GitHub Pages serves, with a 404 status, for any address that is not a file. It carries the app, so a token page that was launched after the
 * last rebuild (`/token/<id>/`) still opens as the live app; search engines see the 404 status and the noindex tag. Its social card is the site's own,
 * so a link shared before the token's own page exists still shows the brand instead of "not found".
 */
export function notFoundHtml(css, assetTags = []) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    ${head({ title: HOME.title, description: HOME.description, path: "/", css: assetTags.length ? [] : css, robots: "noindex,follow", extra: assetTags.join("\n    ") })}
  </head>
  <body>
    <div id="root"><div class="shell">
    ${header()}
    <main class="seo-page"><article><h1>Page not found</h1><p class="seo-lead">That page does not exist. Try the <a href="/">Algorand launchpad</a> or one of the guides below.</p>${guideList()}</article></main>
    ${footer()}
    </div></div>
  </body>
</html>
`;
}

export { GUIDE_LINKS, PAGES, plain };
