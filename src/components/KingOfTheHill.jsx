import { useEffect, useState } from "react";
import "../LaunchLab.css";
import { explorerAddrUrl, explorerAssetUrl, explorerTxUrl, IS_MAINNET, useAlgorand } from "../hooks/useAlgorand";
import { formatUnits } from "../launchpad/amounts";
import { launchNetwork } from "../launchpad/config";
import { loadHillStats } from "../launchpad/directory";
import { shortAddress } from "../launchpad/format";
import { vestigeAssetUrl } from "../launchpad/links";
import { tokenHash } from "../launchpad/tokenView";

function Crown() {
  return (
    <svg className="king-crown" viewBox="0 0 64 48" width="44" height="33" aria-hidden="true" focusable="false">
      <path d="M4 40 L10 12 L22 26 L32 6 L42 26 L54 12 L60 40 Z" fill="currentColor" />
      <rect x="4" y="42" width="56" height="5" rx="2" fill="currentColor" />
    </svg>
  );
}

const algo = (micro) => Number(formatUnits(micro, 6)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** The launch page's headline: how many tokens exist and who holds the crown, with a nudge to beat it. All of it is read from the chain. */
export default function KingOfTheHill({ onChallenge }) {
  const { algodClient } = useAlgorand();
  const [state, setState] = useState({ status: "loading", data: null });
  const configured = launchNetwork.launchpadAppId !== 0n;

  useEffect(() => {
    if (!configured) return undefined;
    let cancelled = false;
    loadHillStats({ algodClient, config: launchNetwork })
      .then((data) => { if (!cancelled) setState({ status: "ready", data }); })
      .catch((error) => {
        // The banner hides itself rather than show an error to visitors, but the reason is kept in the console for whoever looks.
        console.warn("King of the hill unavailable:", error);
        if (!cancelled) setState({ status: "error", data: null });
      });
    return () => { cancelled = true; };
  }, [algodClient, configured]);

  if (!configured || state.status === "error") return null;
  const data = state.data;
  const king = data?.king ?? null;
  return (
    <section className="king" aria-label="King of the hill">
      <div className="king-stats">
        <div><strong>{data ? data.tokensCreated.toString() : "…"}</strong><span>tokens created</span></div>
      </div>
      <div className="king-main">
        <div className="king-badge"><Crown /><span>King of the hill</span></div>
        {state.status === "loading" ? (
          <p className="king-sub">Looking up the crown…</p>
        ) : king ? (
          <>
            <div className="king-title">
              <strong>{king.name}</strong>
              {king.unit ? <span className="king-unit">{king.unit}</span> : null}
            </div>
            <div className="king-figures">
              <span className="king-tvl">{algo(king.tvlMicroAlgo)} ALGO</span>
              <span className="king-sub">in its pool · launched by {shortAddress(king.launcher)}</span>
            </div>
            <p className="king-challenge">
              Beat <strong>{algo(king.tvlMicroAlgo)} ALGO</strong> of pool value to take the crown.{" "}
              {onChallenge ? <button type="button" className="king-cta" onClick={onChallenge}>Launch your challenger ↓</button> : null}
            </p>
            <div className="king-links">
              {IS_MAINNET ? <a className="trade-button" href={vestigeAssetUrl(king.assetId)} target="_blank" rel="noopener noreferrer" aria-label={`Trade ${king.name} on Vestige`}>Trade now <span aria-hidden="true">↗</span></a> : null}
              <a href={tokenHash(king.assetId)}>Safety checklist</a>
              <a href={explorerAssetUrl(king.assetId)} target="_blank" rel="noreferrer noopener">Asset {king.assetId.toString()} ↗</a>
              <a href={explorerAddrUrl(king.poolAddress)} target="_blank" rel="noreferrer noopener">Pool ↗</a>
              {king.terminalTxId ? <a className="burn-link" href={explorerTxUrl(king.terminalTxId)} target="_blank" rel="noreferrer noopener">Burn LP ↗</a> : null}
            </div>
          </>
        ) : (
          <>
            <p className="king-empty">The crown is empty.</p>
            <p className="king-challenge">The launch with the most liquidity in its pool is crowned here. <strong>The first launch takes it.</strong>{" "}
              {onChallenge ? <button type="button" className="king-cta" onClick={onChallenge}>Launch yours ↓</button> : null}
            </p>
          </>
        )}
      </div>
    </section>
  );
}