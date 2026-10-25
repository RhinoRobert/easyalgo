import { useSyncExternalStore } from "react";

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

/** The active tab from the address fragment (#mine, #recent, ...), so every view has its own shareable link. */
export function useActiveTab() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const id = hash.replace(/^#/, "");
  return TABS.some((tab) => tab.id === id) ? id : "launch";
}

export default function Tabs({ active }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map((tab) => (
        <a key={tab.id} href={`#${tab.id}`} className={`tab${active === tab.id ? " tab--active" : ""}`} aria-current={active === tab.id ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
