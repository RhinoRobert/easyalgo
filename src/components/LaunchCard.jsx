import { IS_MAINNET } from "../hooks/useAlgorand";
import { formatUnits } from "../launchpad/amounts";
import { roundsAgo } from "../launchpad/format";
import { vestigeAssetUrl } from "../launchpad/links";
import { burnedPercent, tokenHash } from "../launchpad/tokenView";
import TokenBadge from "./TokenBadge";

const algo = (micro) => Number(formatUnits(micro, 6)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** One launch as a card for the Recent and Popular grids. The whole card opens the token page; Trade now goes to Vestige. */
export default function LaunchCard({ item, round, rank }) {
  const finished = item.status === 2n;
  const burned = finished ? burnedPercent(item) : null;
  const href = tokenHash(item.assetId);
  return (
    <li className={`launch-card${finished ? "" : " launch-card--cancelled"}`}>
      {rank ? <span className="launch-card-rank">{rank}</span> : null}
      <a className="launch-card-main" href={href} aria-label={`${item.name}: open token page`}>
        <TokenBadge assetId={item.assetId} unit={item.unit} name={item.name} />
        <span className="launch-card-title">
          <strong>{item.name}</strong>
          {item.unit ? <span className="launch-unit">{item.unit}</span> : null}
        </span>
        {finished ? (
          <span className="launch-card-figure"><strong>{algo(item.tvlMicroAlgo)} ALGO</strong><small>in the pool</small></span>
        ) : (
          <span className="launch-card-figure"><small>cancelled, no pool</small></span>
        )}
        <span className="launch-card-meta">
          {burned !== null ? <span className="launch-burned">{burned.toFixed(0)}% burned</span> : null}
          {item.terminalRound ? <span>{roundsAgo(round, item.terminalRound)}</span> : null}
        </span>
      </a>
      {finished && IS_MAINNET ? (
        <a className="trade-button" href={vestigeAssetUrl(item.assetId)} target="_blank" rel="noopener noreferrer" aria-label={`Trade ${item.name} on Vestige`}>
          Trade now <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </li>
  );
}
