# Search engine plan for easyalgo.org

Goal: be found for **"algorand launchpad"** and the searches of people who want to launch a memecoin on Algorand, without naming any other
project on the site.

## Where it stood (2026-10-25)

* Google had **not indexed the site at all** (a `site:easyalgo.org` search returned nothing). That, not ranking, is why there was no traffic.
* The app is a single page with `#` routes. Search engines ignore everything after `#`, and the page's own text only appears after JavaScript runs.
* The page title was just "PNET LaunchLab", and there was no sitemap, no icon and no social image.
* Searching the bare name "easyalgo" returns unrelated businesses, so the site must lead with what it is: an *Algorand launchpad*.

## What was built

| Piece | Where |
|---|---|
| One source for all search-facing text (home, FAQ, five guides) | `src/seoContent.js` |
| Static, crawlable pages, sitemap, robots, 404, home pre-render | `scripts/seo/render.mjs`, written into `dist/` by `scripts/build-seo.mjs` on every `npm run build` |
| Pages | `/algorand-launchpad/`, `/how-to-create-an-algorand-token/`, `/algorand-memecoin-launchpad/`, `/burn-liquidity-on-algorand/`, `/faq/` |
| Home page text readable without JavaScript, replaced by the app on load | `renderHomePrerender()` into `<div id="root">` |
| Title, description, canonical, social card, icons, structured data | `index.html` and each generated page |
| Visible FAQ in the app, matching the FAQ structured data | `src/components/Faq.jsx` |
| Guide links on every page and in the footer | `src/components/TermsFooter.jsx` |
| Per-page browser titles | `src/App.jsx`, `src/pages/TokenPage.jsx` |
| Tests that keep all of it true | `test/seo.test.js` |

## Token pages, the feed and the 20-minute rebuild

* Every finished launch gets its own page at `/token/<asset id>/`, written at build time from the chain (`scripts/seo/tokens.mjs`): its own title,
  description, canonical address, social card text, a snapshot of its numbers and its safety checklist. The live app loads over the same address, so
  a visitor sees the full interactive page (chart, holders, replies) while a crawler or a link preview reads the static text.
* The Share on X button now links to that page, so a post shows the token's name and numbers instead of the generic site card.
* `.github/workflows/pages.yml` also runs every 20 minutes. A token launched since the last run gets its page on the next run; until then its link
  opens the live app (through `404.html`) but shows the generic card. If the chain can not be read during a run, the run fails and the previous site
  stays live, so pages never disappear. GitHub pauses scheduled runs after 60 days without a commit, so push something now and then.
* `/feed.xml` is an Atom feed of the newest launches (entry dates are the launches' block times). A free automation tool (for example IFTTT or Zapier)
  can watch it and post each new launch to X; that is optional and needs your own account on that tool.
* A token named with the banned name just gets no page; it does not stop the deploy.

The deploy refuses to publish if the sitemap, pre-render or social image is missing, or if the banned name appears in any published file.

## Changing the text

Edit `src/seoContent.js` only. Update `SITE.updated` to today's date when the content changes (it feeds the sitemap and the pages' "last updated").
The tests check that titles stay under 62 characters, descriptions under 160, every page has one H1, links resolve, the FAQ data equals the visible FAQ,
and the numbers in the copy (2.7 ALGO, 80% burned, 2.3 hours to cancel) still match the contract.

## What only the site owner can do (this is what actually moves rankings)

1. **Verify the site in Google Search Console.** Add the property `easyalgo.org` as a *Domain* property and verify with the DNS TXT record in Cloudflare
   (DNS > Add record > TXT). Then **Sitemaps > add `https://easyalgo.org/sitemap.xml`**.
2. **Request indexing** (URL Inspection > Request indexing) for `/` and the five guide pages. The first crawl usually takes days, not hours.
3. **Bing Webmaster Tools:** sign in, choose *Import from Google Search Console*, and submit the same sitemap. Bing also feeds several smaller search engines.
4. **Get links to it.** Links from other sites are the biggest ranking factor for a new site.
   * Link from `www.testedprofit.com` to `https://easyalgo.org/` using the words "Algorand launchpad" (header, footer and any relevant page).
   * Put `https://easyalgo.org` in the X profile of the project and in the pinned post.
   * Ask for listings where Algorand projects are collected (ecosystem directories, community lists, Algorand forum). Follow each site's rules, and
     do not buy links.
   * Write a post people can link to, for example a walkthrough of a real launch with its token page.
5. **Keep a single brand.** Use "PNET LaunchLab" and "Algorand launchpad" everywhere so searches and mentions point to one site.
6. **Check back in Search Console** after a few weeks: *Pages* shows what is indexed and why anything is not, and *Performance* shows the searches
   that show the site.

## Honest expectations

Indexing should start within days of verifying and submitting. Ranking for "algorand launchpad" depends on links and on competing pages; the current
results are mostly forum posts and project pages, so a focused page has a realistic chance over weeks to months, not days. Nothing here can promise a position.

## Limits to know about

* Old-style token links (`/#token/...`) still work inside the app but can not be indexed, because search engines ignore `#`. Every launched token now also has a real page at `/token/<asset id>/` (see below); that is the address to share.
* The main script bundle is large (about 870 kB), which slows the first load on phones. Splitting the wallet library out would help speed scores.
* Older commits in the public repository still contain a mention of another project in a test comment (history was not rewritten).

## Look and feel (2026-10-25)

* The FAQ is native `<details>` accordions on the static pages and in the app (no script needed, crawlers still read every answer).
* Colours are theme tokens in `src/styles.css`. Dark is the default; light follows the visitor's system setting, and the footer has Theme: auto / dark / light (stored in this browser only). `public/theme.js` applies a saved choice before first paint; it is an external file so the content security policy needs no inline-script exception. `test/theme.test.js` keeps the two light blocks identical and every token defined.
