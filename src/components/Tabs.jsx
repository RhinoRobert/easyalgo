import { useEffect, useRef, useSyncExternalStore } from "react";
import { parseRoute } from "../launchpad/tokenView";
import MainSiteLink from "./MainSiteLink";

export const TABS = [
  { id: "launch", label: "Launch" },
  { id: "mine", label: "My launches" },
  { id: "recent", label: "Recent" },
  { id: "popular", label: "Popular" },
  { id: "ops", label: "Operations" },
];

const subscribe = (listener) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

/** The view from the address fragment (#mine, #recent, #token/<asset id>, ...), so every view has its own shareable link. `assetId` is set for "token". */
export function useRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const { tab, assetId, address } = parseRoute(hash);
  if (tab === "token" || tab === "creator") return { tab, assetId, address };
  return { tab: TABS.some((item) => item.id === tab) ? tab : "launch", assetId: null, address: null };
}

export function useActiveTab() {
  return useRoute().tab;
}

/** `showOperations` is true only for the platform authority wallet: nobody else is shown that the tab exists. */
export default function Tabs({ active, showOperations = false }) {
  const nav = useRef(null);
  // On a phone the row scrolls sideways: bring the chosen tab into view.
  useEffect(() => {
    nav.current?.querySelector("[aria-current='page']")?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <nav className="tabs" aria-label="Sections" ref={nav}>
      {TABS.filter((tab) => tab.id !== "ops" || showOperations).map((tab) => (
        <a key={tab.id} href={`#${tab.id}`} className={`tab${active === tab.id ? " tab--active" : ""}`} aria-current={active === tab.id ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
      <MainSiteLink className="tab tab--external mobile-only">Main website</MainSiteLink>
    </nav>
  );
}
