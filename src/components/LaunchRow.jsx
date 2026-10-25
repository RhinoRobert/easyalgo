import { IS_MAINNET, explorerAddrUrl, explorerAssetUrl, explorerTxUrl } from "../hooks/useAlgorand";
import { vestigeAssetUrl } from "../launchpad/links";
import { formatUnits } from "../launchpad/amounts";
import { roundsAgo, shortAddress } from "../launchpad/format";
import { tokenHash } from "../launchpad/tokenView";

const STATUS_LABEL = { 1n: "In progress", 2n: "Live", 3n: "Cancelled" };

/** One launch. Everything from the chain is shown as plain text; the token's own URL is never turned into a link. */
export default function LaunchRow({ item, round, rank, children }) {
  const finished = item.status === 2n;
  // The share of the pool's liquidity tokens sitting in the burn account, read from the contract's own record (80.0% to rounding).
  const lpTotal = (item.burnedLp ?? 0n) + (item.creatorLp ?? 0n) + (item.platformLp ?? 0n);
  const burnedShare = lpTotal > 0n ? (Number((item.burnedLp * 1000n) / lpTotal) / 10).toFixed(1) : null;
  return (
    <li className={`launch-row launch-row--${finished ? "live" : item.status === 3n ? "cancelled" : "pending"}`}>
      {rank ? <span className="launch-rank">{rank}</span> : null}
      <div className="launch-main">
        <div className="launch-title">
          <strong>{item.name}</strong>
          {item.unit ? <span className="launch-unit">{item.unit}</span> : null}
          <span className="launch-status">{STATUS_LABEL[item.status] ?? "Unknown"}</span>
        </div>
        <div className="launch-meta">
          {finished ? <a href={tokenHash(item.assetId)}>Token page</a> : null}
          <a href={explorerAssetUrl(item.assetId)} target="_blank" rel="noreferrer noopener">Asset {item.assetId.toString()} ↗</a>
          {item.poolAddress ? <a href={explorerAddrUrl(item.poolAddress)} target="_blank" rel="noreferrer noopener">Pool ↗</a> : null}
          {finished && burnedShare ? <span className="launch-burned">{burnedShare}% of liquidity burned</span> : null}
          {finished && item.terminalTxId ? (
            <a
              className="burn-link"
              href={explorerTxUrl(item.terminalTxId)}
              target="_blank"
              rel="noreferrer noopener"
              title={`The transaction that sent ${formatUnits(item.burnedLp)} liquidity tokens (80%) to the ARC-54 burn account, where they can never be withdrawn`}
            >
              Burn LP ↗
            </a>
          ) : null}
          {item.launcher ? <span title={item.launcher}>by {shortAddress(item.launcher)}</span> : null}
          {finished && item.terminalRound ? <span>{roundsAgo(round, item.terminalRound)}</span> : null}
          {item.url ? <span className="launch-url" title="Written by the token's creator; shown as plain text only">{item.url}</span> : null}
        </div>
      </div>
      <div className="launch-figures">
        {finished ? (
          <>
            <strong>{formatUnits(item.tvlMicroAlgo)} ALGO</strong>
            <small>in the pool</small>
            {IS_MAINNET ? (
              <a className="trade-button" href={vestigeAssetUrl(item.assetId)} target="_blank" rel="noopener noreferrer" aria-label={`Trade ${item.name} on Vestige`}>
                Trade now <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </>
        ) : (
          <small>{item.status === 3n ? "no pool" : "not live yet"}</small>
        )}
      </div>
      {children ? <div className="launch-actions">{children}</div> : null}
    </li>
  );
}
