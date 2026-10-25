import { useEffect, useState } from "react";
import LaunchRow from "../components/LaunchRow";
import "../LaunchLab.css";
import { useAlgorand } from "../hooks/useAlgorand";
import { launchNetwork } from "../launchpad/config";
import { clearDirectoryCache, loadPopularLaunches, loadRecentLaunches } from "../launchpad/directory";

const COPY = {
  recent: {
    eyebrow: "Recent launches",
    title: "The newest launches",
    text: "Every launch made through the launchpad, newest first. Each token starts with the same 1 ALGO of PNET and its full supply in a Tinyman pool.",
    empty: "No launches yet.",
  },
  popular: {
    eyebrow: "Popular launches",
    title: "Ranked by pool value",
    text: "Launches ranked by what their Tinyman pool holds right now, both sides counted in ALGO. Every launch starts at about the same size, so growth since launch is what moves a token up. Based on the newest 100 launches.",
    empty: "No live launches to rank yet.",
  },
};

/** Recent or popular launches. Loads the first time its tab is opened and again whenever it is opened after 45 seconds. */
export default function DirectoryPage({ mode, active }) {
  const { algodClient } = useAlgorand();
  const [state, setState] = useState({ status: "idle", items: [], round: 0, total: 0n, scanned: 0, error: "" });
  const copy = COPY[mode];
  const configured = launchNetwork.launchpadAppId !== 0n;

  const load = async (fresh = false) => {
    if (!configured) return;
    if (fresh) clearDirectoryCache();
    setState((old) => ({ ...old, status: "loading", error: "" }));
    try {
      const result = mode === "popular"
        ? await loadPopularLaunches({ algodClient, config: launchNetwork })
        : await loadRecentLaunches({ algodClient, config: launchNetwork, limit: 20 });
      setState({ status: "ready", items: result.items, round: result.round, total: result.total, scanned: result.scanned ?? result.items.length, error: "" });
    } catch (cause) {
      setState((old) => ({ ...old, status: "error", error: cause?.message || String(cause) }));
    }
  };

  useEffect(() => {
    if (active) load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="launchlab-page directory" hidden={!active}>
      <div className="instant-hero">
        <div className="af-section-eyebrow">{copy.eyebrow}</div>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
      </div>
      {!configured && <div className="instant-warning">No launchpad application is configured for this build.</div>}
      {state.error && <div className="instant-error">Could not load launches: {state.error}</div>}
      <div className="directory-bar">
        <span>{state.status === "loading" ? "Loading…" : state.status === "ready" ? `${state.total.toString()} launch${state.total === 1n ? "" : "es"} in total` : ""}</span>
        <button className="af-btn-ghost" disabled={state.status === "loading"} onClick={() => load(true)}>Refresh</button>
      </div>
      {state.status === "ready" && state.items.length === 0 ? <p className="field-hint">{copy.empty}</p> : null}
      <ol className="launch-list">
        {state.items.map((item, index) => (
          <LaunchRow key={item.assetId.toString()} item={item} round={state.round} rank={mode === "popular" ? index + 1 : null} />
        ))}
      </ol>
    </section>
  );
}
