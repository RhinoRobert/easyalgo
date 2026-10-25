import { useEffect, useMemo, useState } from "react";
import LaunchCard from "../components/LaunchCard";
import "../LaunchLab.css";
import { useAlgorand } from "../hooks/useAlgorand";
import { launchNetwork } from "../launchpad/config";
import { clearDirectoryCache, loadPopularLaunches, loadRecentLaunches } from "../launchpad/directory";
import { filterLaunches, sortLaunches } from "../launchpad/tokenView";

const COPY = {
  recent: {
    eyebrow: "Recent launches",
    title: "The newest launches",
    text: "Every launch made through the launchpad. Each token starts with the same 1 ALGO of PNET and its full supply in a Tinyman pool. Open one to see its safety checklist.",
    empty: "No launches yet.",
  },
  popular: {
    eyebrow: "Popular launches",
    title: "Ranked by pool value",
    text: "Launches ranked by what their Tinyman pool holds right now, both sides counted in ALGO. Every launch starts at about the same size, so growth since launch is what moves a token up. Based on the newest 100 launches.",
    empty: "No live launches to rank yet.",
  },
};

/** Recent or popular launches as cards. Loads the first time its tab is opened and again whenever it is opened after 45 seconds. */
export default function DirectoryPage({ mode, active }) {
  const { algodClient } = useAlgorand();
  const [state, setState] = useState({ status: "idle", items: [], round: 0, total: 0n, scanned: 0, error: "" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [showCancelled, setShowCancelled] = useState(false);
  const copy = COPY[mode];
  const configured = launchNetwork.launchpadAppId !== 0n;

  const load = async (fresh = false) => {
    if (!configured) return;
    if (fresh) clearDirectoryCache();
    setState((old) => ({ ...old, status: "loading", error: "" }));
    try {
      const result = mode === "popular"
        ? await loadPopularLaunches({ algodClient, config: launchNetwork })
        : await loadRecentLaunches({ algodClient, config: launchNetwork, limit: 100 });
      setState({ status: "ready", items: result.items, round: result.round, total: result.total, scanned: result.scanned ?? result.items.length, error: "" });
    } catch (cause) {
      setState((old) => ({ ...old, status: "error", error: cause?.message || String(cause) }));
    }
  };

  useEffect(() => {
    if (active) load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const filtered = filterLaunches(state.items, { query, showCancelled });
    return mode === "popular" ? filtered : sortLaunches(filtered, sort);
  }, [state.items, query, showCancelled, sort, mode]);

  return (
    <section className="launchlab-page directory" hidden={!active}>
      <div className="instant-hero">
        <div className="af-section-eyebrow">{copy.eyebrow}</div>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
      </div>
      {!configured && <div className="instant-warning">No launchpad application is configured for this build.</div>}
      {state.error && <div className="instant-error">Could not load launches: {state.error}</div>}
      <div className="directory-controls">
        <input type="search" className="directory-search" placeholder="Search name, ticker or asset ID" aria-label="Search launches" value={query} onChange={(event) => setQuery(event.target.value)} />
        {mode === "recent" ? (
          <>
            <label className="directory-sort">Sort
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="newest">Newest</option>
                <option value="pool">Biggest pool</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
            <label className="directory-check"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} /> Show cancelled</label>
          </>
        ) : null}
      </div>
      <div className="directory-bar">
        <span>{state.status === "loading" ? "Loading…" : state.status === "ready" ? `${state.total.toString()} launch${state.total === 1n ? "" : "es"} in total${query ? ` · ${visible.length} match${visible.length === 1 ? "" : "es"}` : ""}` : ""}</span>
        <button className="af-btn-ghost" disabled={state.status === "loading"} onClick={() => load(true)}>Refresh</button>
      </div>
      {state.status === "ready" && visible.length === 0 ? <p className="field-hint">{query ? "Nothing matches that search." : copy.empty}</p> : null}
      <ul className="launch-grid">
        {visible.map((item, index) => (
          <LaunchCard key={item.assetId.toString()} item={item} round={state.round} rank={mode === "popular" ? index + 1 : null} />
        ))}
      </ul>
    </section>
  );
}
