// The link back to the main website. A plain, followed anchor with descriptive text: it is a real backlink for search engines, and it passes
// the referrer (origin only, see deploy/security-headers.json) so the main site can see visits that came from here.
export const MAIN_SITE_URL = "https://www.testedprofit.com/";

export default function MainSiteLink({ className = "", children = "Main website" }) {
  return (
    <a className={`main-site-link ${className}`.trim()} href={MAIN_SITE_URL} target="_blank" rel="noopener" title="TestedProfit: the main website">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}