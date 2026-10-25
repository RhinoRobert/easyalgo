import { useEffect, useMemo, useState } from "react";
import LaunchCard from "../components/LaunchCard";
import { CardSkeletons, EmptyState } from "../components/Placeholders";
import "../LaunchLab.css";
import { IS_MAINNET, useAlgorand } from "../hooks/useAlgorand";
import { formatUnits } from "../launchpad/amounts";
import { fetchVestigeAssets } from "../launchpad/vestigeApi";
import { launchNetwork } from "../launchpad/config";
import { clearDirectoryCache, loadRecentLaunches } from "../launchpad/directory";
import { shortAddress } from "../launchpad/format";
import { biggestPools, biggestThisWeek, topCreators } from "../launchpad/leaders";
import { creatorHash, filterLaunches, sortLaunches, tokenHash } from "../launchpad/tokenView";

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

const VIEWS = [
  { id: "pools", label: "Biggest pools" },
  { id: "week", label: "This week" },
  { id: "creators", label: "Top creators" },
];
const algo = (micro) => Number(formatUnits(micro, 6)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Recent launches, or the rankings (biggest pools, this week's launches, top creators), as cards. Loads when its tab is first opened and again after 45 seconds. */
export default function DirectoryPage({ mode, active }) {
  const { algodClient } = useAlgorand();
  const [state, setState] = useState({ status: "idle", items: [], round: 0, total: 0n, error: "" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState("pools");
  const [showCancelled, setShowCancelled] = useState(false);
  const [market, setMarket] = useState(() => new Map());
  const copy = COPY[mode];
  const configured = launchNetwork.launchpadAppId !== 0n;

  const load = async (fresh = false) => {
    if (!configured) return;
    if (fresh) clearDirectoryCache();
    setState((old) => ({ ...old, status: "loading", error: "" }));
    try {
      const result = await loadRecentLaunches({ algodClient, config: launchNetwork, limit: 100 });
      setState({ status: "ready", items: result.items, round: result.round, total: result.total, error: "" });
      // Logos come from Vestige after the list is already on screen; without them the cards keep their coloured marks.
      if (IS_MAINNET) fetchVestigeAssets(result.items.filter((item) => item.status === 2n).map((item) => item.assetId)).then(setMarket);
    } catch (cause) {
      setState((old) => ({ ...old, status: "error", error: cause?.message || String(cause) }));
    }
  };

  useEffect(() => {
    if (active) load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const showingCreators = mode === "popular" && view === "creators";
  const creators = useMemo(() => topCreators(state.items), [state.items]);
  const visible = useMemo(() => {
    if (mode === "popular") return filterLaunches(view === "week" ? biggestThisWeek(state.items, state.round) : biggestPools(state.items), { query });
    return sortLaunches(filterLaunches(state.items, { query, showCancelled }), sort);
  }, [state.items, state.round, query, showCancelled, sort, mode, view]);
  const empty = showingCreators ? creators.length === 0 : visible.length === 0;

  return (
    <section className="launchlab-page directory" hidden={!active}>
      <div className="instant-hero">
        <div className="af-section-eyebrow">{copy.eyebrow}</div>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
      </div>
      {!configured && <div className="instant-warning">No launchpad application is configured for this build.</div>}
      {state.error && <div className="instant-error">Could not load launches: {state.error}</div>}
      {mode === "popular" ? (
        <div className="segmented" role="group" aria-label="Ranking">
          {VIEWS.map((item) => (
            <button key={item.id} type="button" className={view === item.id ? "is-active" : ""} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>
          ))}
        </div>
      ) : null}
      <div className="directory-controls">
        {showingCreators ? null : (
          <input type="search" className="directory-search" placeholder="Search name, ticker or asset ID" aria-label="Search launches" value={query} onChange={(event) => setQuery(event.target.value)} />
        )}
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
        <span>{state.status === "loading" ? "Loading…" : state.status === "ready" ? `${state.total.toString()} launch${state.total === 1n ? "" : "es"} in total${query && !showingCreators ? ` · ${visible.length} match${visible.length === 1 ? "" : "es"}` : ""}` : ""}</span>
        <button className="af-btn-ghost" disabled={state.status === "loading"} onClick={() => load(true)}>Refresh</button>
      </div>
      {state.status === "loading" && state.items.length === 0 ? <CardSkeletons /> : null}
      {state.status === "ready" && empty ? (
        query && !showingCreators
          ? <EmptyState title="Nothing matches that search" text="Try a different name, ticker or asset ID." />
          : <EmptyState title={view === "week" && mode === "popular" ? "Nothing launched this week yet" : showingCreators ? "No creators to rank yet" : copy.empty} text="Launching takes two approvals in Pera and about a minute." href="#launch" cta="Launch a token" />
      ) : null}
      {showingCreators ? (
        <ol className="creator-list" aria-label="Top creators">
          {creators.map((creator, index) => (
            <li key={creator.address}>
              <span className="launch-rank">{index + 1}</span>
              <a className="creator-address" href={creatorHash(creator.address)} title={creator.address}>{shortAddress(creator.address)}</a>
              <span>{creator.launched} launched</span>
              <span>{algo(creator.totalPool)} ALGO in pools</span>
              <span className="creator-best">Best: <a href={tokenHash(creator.best.assetId)}>{creator.best.name}</a></span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="launch-grid">
          {visible.map((item, index) => (
            <LaunchCard key={item.assetId.toString()} item={item} round={state.round} rank={mode === "popular" ? index + 1 : null} image={market.get(item.assetId.toString())?.image ?? ""} />
          ))}
        </ul>
      )}
    </section>
  );
}
