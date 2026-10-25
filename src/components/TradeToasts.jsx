import { useEffect, useState, useSyncExternalStore } from "react";
import { IS_MAINNET, useAlgorand } from "../hooks/useAlgorand";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { useTradeAlerts } from "../hooks/useTradeAlerts";
import { getAlertsOn, setAlertsOn, subscribeAlerts } from "../launchpad/alertPrefs";
import { launchNetwork } from "../launchpad/config";
import { shortAddress } from "../launchpad/format";
import { formatAlgo, nextToast } from "../launchpad/tradeFeed";
import { tokenHash } from "../launchpad/tokenView";
import TokenBadge from "./TokenBadge";

const SHOW_MS = 8_000;
const GAP_MS = 700;
const LEAVE_MS = 300;

export function useAlertsOn() {
  return useSyncExternalStore(subscribeAlerts, getAlertsOn, () => true);
}

/** The plain on/off link for the page footer. */
export function AlertsToggle() {
  const on = useAlertsOn();
  if (!IS_MAINNET) return null;
  return (
    <button type="button" className="alerts-toggle" onClick={() => setAlertsOn(!on)} aria-pressed={on}>
      Trade alerts: {on ? "on" : "off"}
    </button>
  );
}

/**
 * A wide banner under the navigation, on every page, when a launched token is traded. One at a time, it slides away by itself after a few seconds (it
 * waits while the pointer is over it), and a busy moment becomes a single summary. The whole banner opens the token's page. It never takes focus and can
 * be dismissed or muted here, or muted from the footer.
 */
export default function TradeToasts() {
  const { algodClient } = useAlgorand();
  const { account } = usePeraWallet();
  const enabled = useAlertsOn() && IS_MAINNET && launchNetwork.launchpadAppId !== 0n;
  const { queue, setQueue } = useTradeAlerts({ enabled, algodClient, config: launchNetwork });
  const [current, setCurrent] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => { if (!enabled) { setCurrent(null); setLeaving(false); } }, [enabled]);

  // take the next one a moment after the last one left
  useEffect(() => {
    if (current || !queue.length) return undefined;
    const timer = setTimeout(() => {
      const { toast, rest } = nextToast(queue);
      setQueue(rest);
      setCurrent(toast);
    }, GAP_MS);
    return () => clearTimeout(timer);
  }, [current, queue, setQueue]);

  // leave by itself after a while, unless the pointer is on it
  useEffect(() => {
    if (!current || paused || leaving) return undefined;
    const timer = setTimeout(() => setLeaving(true), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current, paused, leaving]);

  // the slide-away, then gone
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => { setCurrent(null); setLeaving(false); setPaused(false); }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (!enabled || !current) return null;
  const href = current.kind === "summary" && !current.assetId ? "#recent" : tokenHash(current.assetId);
  const mine = current.kind === "trade" && Boolean(account) && current.address === account;
  const side = current.kind === "trade" ? current.side : "summary";
  return (
    <div className={`trade-banner-wrap${leaving ? " trade-banner-wrap--leaving" : ""}`} role="status" aria-live="polite">
      <div className="trade-banner-slot">
        <div key={current.key} className={`trade-banner trade-banner--${side}`}
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
          <a className="trade-banner-link" href={href} onClick={() => setLeaving(true)}>
            {current.kind === "trade" ? <TokenBadge assetId={current.assetId} unit={current.ticker} name={current.name} image={current.image} /> : <span className="trade-banner-count" aria-hidden="true">{current.count}</span>}
            <span className="trade-banner-text">
              {current.kind === "summary" ? (
                <>
                  <strong>{current.count} new trades</strong>
                  <small>{current.tokens === 1 ? `on ${current.name}` : `across ${current.tokens} tokens`}</small>
                </>
              ) : (
                <>
                  <strong>{mine ? "You" : current.address ? shortAddress(current.address) : "Someone"} {current.side === "buy" ? "bought" : "sold"} <em>{formatAlgo(current.algo)} ALGO</em> of {current.ticker || current.name}</strong>
                  <small>{current.name}{current.ticker && current.name !== current.ticker ? ` (${current.ticker})` : ""} · just now</small>
                </>
              )}
            </span>
            <span className="trade-banner-cta" aria-hidden="true">{current.kind === "summary" && !current.assetId ? "See launches" : "View token"} →</span>
          </a>
          <div className="trade-banner-actions">
            <button type="button" className="trade-banner-close" onClick={() => setLeaving(true)} aria-label="Dismiss">✕</button>
            <button type="button" className="trade-banner-mute" onClick={() => setAlertsOn(false)}>Mute</button>
          </div>
        </div>
      </div>
    </div>
  );
}
