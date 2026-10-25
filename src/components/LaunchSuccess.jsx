import { IS_MAINNET } from "../hooks/useAlgorand";
import { vestigeAssetUrl } from "../launchpad/links";
import { shareOnXUrl, tokenHash } from "../launchpad/tokenView";

/** Shown when a launch has finished: what happened and the three things a creator wants to do next. */
export default function LaunchSuccess({ name, unit, assetId, burnedPct, pageUrl }) {
  return (
    <section className="launch-success" role="status" aria-label="Launch complete">
      <span className="launch-success-mark" aria-hidden="true">✓</span>
      <div className="launch-success-text">
        <strong>{name || "Your token"} is live</strong>
        <small>Its pool is open on Tinyman{burnedPct ? ` and ${burnedPct.toFixed(0)}% of the liquidity is burned for good` : ""}.</small>
      </div>
      <div className="launch-success-actions">
        <a className="trade-button" href={tokenHash(assetId)}>Open token page</a>
        {IS_MAINNET ? <a className="trade-button trade-button--ghost" href={vestigeAssetUrl(assetId)} target="_blank" rel="noopener noreferrer">Trade on Vestige <span aria-hidden="true">↗</span></a> : null}
        <a className="trade-button trade-button--ghost" href={shareOnXUrl({ name, unit, assetId, burnedPct, pageUrl })} target="_blank" rel="noopener noreferrer">Share on X <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}
