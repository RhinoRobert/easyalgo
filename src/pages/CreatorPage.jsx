import algosdk from "algosdk";
import { useEffect, useMemo, useState } from "react";
import LaunchCard from "../components/LaunchCard";
import { CardSkeletons, EmptyState } from "../components/Placeholders";
import TokenBadge from "../components/TokenBadge";
import "../LaunchLab.css";
import { IS_MAINNET, explorerAddrUrl, useAlgorand } from "../hooks/useAlgorand";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { formatUnits } from "../launchpad/amounts";
import { launchNetwork } from "../launchpad/config";
import { loadRecentLaunches } from "../launchpad/directory";
import { shortAddress } from "../launchpad/format";
import { creatorSummary } from "../launchpad/leaders";
import { fetchVestigeAssets } from "../launchpad/vestigeApi";

const algo = (micro) => Number(formatUnits(micro, 6)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
// A stable colour for a wallet, from its letters
const hueOf = (address) => BigInt([...address].reduce((sum, char) => sum + char.charCodeAt(0), 0));

/** Everything one wallet has launched: its live tokens and what their pools hold, from the same chain data as the other lists. */
export default function CreatorPage({ address }) {
  const { algodClient } = useAlgorand();
  const { account } = usePeraWallet();
  const [state, setState] = useState({ status: "loading", items: [], round: 0, error: "" });
  const [market, setMarket] = useState(() => new Map());
  const valid = algosdk.isValidAddress(address);
  const configured = launchNetwork.launchpadAppId !== 0n;

  useEffect(() => {
    document.title = `Algorand token creator ${shortAddress(address)} | PNET LaunchLab`;
  }, [address]);

  useEffect(() => {
    if (!configured || !valid) return undefined;
    let cancelled = false;
    setState({ status: "loading", items: [], round: 0, error: "" });
    loadRecentLaunches({ algodClient, config: launchNetwork, limit: 100 })
      .then((result) => {
        if (cancelled) return;
        setState({ status: "ready", items: result.items, round: result.round, error: "" });
        const mine = result.items.filter((item) => item.launcher === address && item.status === 2n).map((item) => item.assetId);
        if (IS_MAINNET && mine.length) fetchVestigeAssets(mine).then((rows) => { if (!cancelled) setMarket(rows); });
      })
      .catch((cause) => { if (!cancelled) setState({ status: "error", items: [], round: 0, error: cause?.message || String(cause) }); });
    return () => { cancelled = true; };
  }, [algodClient, address, configured, valid]);

  const summary = useMemo(() => creatorSummary(state.items, address), [state.items, address]);
  const isYou = Boolean(account) && account === address;

  return (
    <section className="launchlab-page directory">
      <div className="token-page">
        <a className="token-back" href="#popular">← Rankings</a>
        <header className="token-head">
          <TokenBadge assetId={hueOf(address)} unit={address.slice(0, 2)} name={address} size="lg" />
          <div className="token-head-text">
            <h1>Creator <span className="launch-unit">{shortAddress(address)}</span></h1>
            <p className="token-sub">
              {valid ? <a href={explorerAddrUrl(address)} target="_blank" rel="noreferrer noopener" title={address}>View wallet on the explorer ↗</a> : "This is not a valid Algorand address."}
              {isYou ? <> · <strong>This is your wallet.</strong> <a href="#mine">Your launches and actions</a></> : null}
            </p>
          </div>
        </header>

        {!configured && <div className="instant-warning">No launchpad application is configured for this build.</div>}
        {state.status === "error" && <div className="instant-error">Could not load launches: {state.error}</div>}
        {state.status === "loading" && valid ? <CardSkeletons count={3} /> : null}

        {valid && state.status === "ready" ? (
          <>
            <div className="token-stats">
              <div><span>Tokens launched</span><strong>{summary.launched}</strong></div>
              <div><span>Pools together</span><strong>{algo(summary.totalPool)} ALGO</strong></div>
              <div><span>Biggest pool</span><strong>{summary.best ? `${algo(summary.best.tvlMicroAlgo)} ALGO` : "n/a"}</strong></div>
              <div><span>Cancelled</span><strong>{summary.cancelled}</strong></div>
            </div>
            {summary.live.length === 0 ? (
              <EmptyState title="No live launches from this wallet" text="Either it has not launched anything here, or its launches are older than the newest 100." href="#launch" cta="Launch a token" />
            ) : (
              <ul className="launch-grid">
                {summary.live.map((item) => (
                  <LaunchCard key={item.assetId.toString()} item={item} round={state.round} image={market.get(item.assetId.toString())?.image ?? ""} />
                ))}
              </ul>
            )}
            <p className="field-hint">Counts the newest 100 launches on this launchpad.</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
