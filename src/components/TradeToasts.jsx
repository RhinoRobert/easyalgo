import { useEffect, useState, useSyncExternalStore } from "react";
import { IS_MAINNET, useAlgorand } from "../hooks/useAlgorand";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { useTradeAlerts } from "../hooks/useTradeAlerts";
import { getAlertsOn, setAlertsOn, subscribeAlerts } from "../launchpad/alertPrefs";
import { launchNetwork } from "../launchpad/config";
import { shortAddress } from "../launchpad/format";
import { formatAlgo, nextToast } from "../launchpad/tradeFeed";
import { tokenHash } from "../launchpad/tokenView";

const SHOW_MS = 6_000;
const GAP_MS = 700;

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
 * A small notice in the corner when a launched token is traded, for everyone on the site. One at a time, gone by itself after a few seconds (it waits
 * while the pointer is over it), and a busy moment becomes a single summary. It never takes focus and can be muted here or in the footer.
 */
export default function TradeToasts() {
  const { algodClient } = useAlgorand();
  const { account } = usePeraWallet();
  const enabled = useAlertsOn() && IS_MAINNET && launchNetwork.launchpadAppId !== 0n;
  const { queue, setQueue } = useTradeAlerts({ enabled, algodClient, config: launchNetwork });
  const [current, setCurrent] = useState(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => { if (!enabled) setCurrent(null); }, [enabled]);

  // take the next toast a moment after the last one left
  useEffect(() => {
    if (current || !queue.length) return undefined;
    const timer = setTimeout(() => {
      const { toast, rest } = nextToast(queue);
      setQueue(rest);
      setCurrent(toast);
    }, GAP_MS);
    return () => clearTimeout(timer);
  }, [current, queue, setQueue]);

  useEffect(() => {
    if (!current || paused) return undefined;
    const timer = setTimeout(() => setCurrent(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current, paused]);

  if (!enabled || !current) return null;
  const href = current.kind === "summary" ? (current.assetId ? tokenHash(current.assetId) : "#recent") : tokenHash(current.assetId);
  const mine = current.kind === "trade" && Boolean(account) && current.address === account;
  return (
    <div className="trade-toast-wrap" role="status" aria-live="polite">
      <div key={current.key} className={`trade-toast${current.kind === "trade" ? ` trade-toast--${current.side}` : ""}`}
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        <span className="trade-toast-dot" aria-hidden="true" />
        <a className="trade-toast-text" href={href} onClick={() => setCurrent(null)}>
          {current.kind === "summary" ? (
            <>
              <strong>{current.count} new trades</strong>
              <small>{current.tokens === 1 ? `on ${current.name}` : `across ${current.tokens} tokens`}</small>
            </>
          ) : (
            <>
              <strong>{mine ? "You" : current.address ? shortAddress(current.address) : "Someone"} {current.side === "buy" ? "bought" : "sold"} {formatAlgo(current.algo)} ALGO of {current.ticker || current.name}</strong>
              <small>{current.name}{current.ticker && current.name !== current.ticker ? ` (${current.ticker})` : ""} · just now</small>
            </>
          )}
        </a>
        <button type="button" className="trade-toast-close" onClick={() => setCurrent(null)} aria-label="Dismiss">✕</button>
        <button type="button" className="trade-toast-mute" onClick={() => setAlertsOn(false)}>Mute</button>
      </div>
    </div>
  );
}
