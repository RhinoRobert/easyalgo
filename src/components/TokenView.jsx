import { IS_MAINNET, explorerAddrUrl, explorerAppUrl, explorerAssetUrl, explorerTxUrl } from "../hooks/useAlgorand";
import { formatUnits } from "../launchpad/amounts";
import { launchNetwork } from "../launchpad/config";
import { roundsAgo, shortAddress } from "../launchpad/format";
import { vestigeAssetUrl, vestigeManagerUrl } from "../launchpad/links";
import { burnedPercent, formatCompact, formatPrice, shareOnXUrl } from "../launchpad/tokenView";
import TokenBadge from "./TokenBadge";

const MARK = { pass: "✓", fail: "✕", info: "i" };
const algo = (micro) => Number(formatUnits(micro, 6)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function linkFor(link) {
  if (!link?.id) return null;
  if (link.type === "tx") return { href: explorerTxUrl(link.id), label: link.label ?? "Transaction" };
  if (link.type === "addr") return { href: explorerAddrUrl(link.id), label: "Pool" };
  return null;
}

/** The token page, drawn from data the loader read. `account` is the connected wallet (only used to show the creator their Vestige link). */
export default function TokenView({ detail, account, pageUrl, market = null, children = null }) {
  const { launch, asset, stats, holders, checks, round } = detail;
  const finished = launch.status === 2n;
  const burned = finished ? burnedPercent(launch) : null;
  const isCreator = Boolean(account) && account === launch.launcher;
  const failing = checks.filter((check) => check.status === "fail").length;
  const id = detail.assetId;
  return (
    <div className="token-page">
      <a className="token-back" href="#recent">← All launches</a>
      <header className="token-head">
        <TokenBadge assetId={id} unit={asset.unit} name={asset.name} size="lg" image={market?.image ?? ""} />
        <div className="token-head-text">
          <h1>{asset.name} {asset.unit ? <span className="launch-unit">{asset.unit}</span> : null}</h1>
          <p className="token-sub">
            {finished ? "Live" : launch.status === 3n ? "Cancelled" : "In progress"} · launched {roundsAgo(round, launch.terminalRound || launch.createdRound)} · by <a href={explorerAddrUrl(launch.launcher)} target="_blank" rel="noreferrer noopener">{shortAddress(launch.launcher)}</a> · asset {id.toString()}
          </p>
          {asset.url ? <p className="token-url" title="Written by the token's creator; shown as plain text only">{asset.url}</p> : null}
        </div>
        <div className="token-actions">
          {finished && IS_MAINNET ? <a className="trade-button" href={vestigeAssetUrl(id)} target="_blank" rel="noopener noreferrer">Trade now <span aria-hidden="true">↗</span></a> : null}
          {finished ? (
            <a className="af-btn-ghost link-button" href={shareOnXUrl({ name: asset.name, unit: asset.unit, assetId: id, burnedPct: burned, pageUrl })} target="_blank" rel="noopener noreferrer">Share on X <span aria-hidden="true">↗</span></a>
          ) : null}
          {IS_MAINNET && finished && isCreator && launch.vestigeGranted === 1n ? (
            <a className="af-btn-ghost link-button" href={vestigeManagerUrl(id)} target="_blank" rel="noopener noreferrer">Edit on Vestige <span aria-hidden="true">↗</span></a>
          ) : null}
        </div>
      </header>

      {finished && stats ? (
        <div className="token-stats">
          <div><span>Pool value</span><strong>{algo(stats.tvlMicroAlgo)} ALGO</strong></div>
          <div><span>Price</span><strong>{formatPrice(stats.priceAlgo)} ALGO</strong></div>
          <div><span>Market cap</span><strong>{formatCompact(stats.marketCapAlgo)} ALGO</strong></div>
          <div><span>Liquidity burned</span><strong>{burned !== null ? `${burned.toFixed(1)}%` : "n/a"}</strong></div>
          {market?.volume1d != null ? <div><span>24h volume</span><strong>{algo(BigInt(Math.round(market.volume1d * 1e6)))} ALGO</strong></div> : null}
          {market?.change1d != null ? <div><span>24h change</span><strong className={market.change1d >= 0 ? "price-up" : "price-down"}>{market.change1d >= 0 ? "+" : ""}{market.change1d.toFixed(2)}%</strong></div> : null}
        </div>
      ) : null}
      {isCreator && finished && IS_MAINNET && market && !market.image ? (
        <p className="field-hint token-logo-hint">This token has no logo yet. Add one, a description and your links on Vestige (the Edit on Vestige button above) and they will show here.</p>
      ) : null}
      {children}

      <section className="instant-card token-checks" aria-label="Safety checklist">
        <h2>Safety checklist</h2>
        <p className="field-hint">{failing ? `${failing} check${failing === 1 ? "" : "s"} did not pass.` : "Read from the chain just now, not claimed."}</p>
        <ul>
          {checks.map((check) => {
            const link = linkFor(check.link);
            return (
              <li key={check.id} className={`token-check token-check--${check.status}`}>
                <span className="token-check-mark" aria-hidden="true">{MARK[check.status]}</span>
                <div>
                  <strong>{check.title}</strong>
                  <small>{check.detail}{link ? <> <a href={link.href} target="_blank" rel="noreferrer noopener">{link.label} ↗</a></> : null}</small>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {finished ? (
        <section className="instant-card token-holders" aria-label="Top holders">
          <h2>Top holders</h2>
          {holders.rows === null ? <p className="field-hint">The holder list could not be loaded right now.</p> : holders.rows.length === 0 ? <p className="field-hint">No holders found.</p> : (
            <ol>
              {holders.rows.map((row, index) => (
                <li key={row.address}>
                  <span className="holder-rank">{index + 1}</span>
                  <a href={explorerAddrUrl(row.address)} target="_blank" rel="noreferrer noopener" title={row.address}>{shortAddress(row.address)}</a>
                  {row.label ? <span className="holder-label">{row.label}</span> : <span />}
                  <strong>{row.percent.toFixed(2)}%</strong>
                </li>
              ))}
            </ol>
          )}
          {holders.rows && !holders.complete ? <p className="field-hint">Showing the largest of the first 3,000 holders.</p> : null}
        </section>
      ) : null}

      <div className="token-links">
        <a href={explorerAssetUrl(id)} target="_blank" rel="noreferrer noopener">Asset ↗</a>
        {launch.poolAddress ? <a href={explorerAddrUrl(launch.poolAddress)} target="_blank" rel="noreferrer noopener">Pool ↗</a> : null}
        {launch.lpAssetId ? <a href={explorerAssetUrl(launch.lpAssetId)} target="_blank" rel="noreferrer noopener">LP asset ↗</a> : null}
        <a href={explorerAddrUrl(detail.burnAddress)} target="_blank" rel="noreferrer noopener">Burn account ↗</a>
        <a href={explorerAppUrl(launchNetwork.launchpadAppId)} target="_blank" rel="noreferrer noopener">Launchpad contract ↗</a>
      </div>
    </div>
  );
}
