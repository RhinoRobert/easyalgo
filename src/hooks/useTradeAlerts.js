import { useEffect, useState } from "react";
import { readRecentRecords } from "../launchpad/directory";
import { MAX_WATCHED, POLL_MS, collectNewTrades } from "../launchpad/tradeFeed";
import { fetchVestigeAssets } from "../launchpad/vestigeApi";

const WATCH_REFRESH_MS = 5 * 60_000;
const MAX_QUEUE = 12;

/**
 * Watches the newest finished launches for trades and returns them as a queue. It starts from the moment the page is open (nothing old is replayed),
 * pauses while the tab is hidden, and a failed poll just waits for the next one.
 */
export function useTradeAlerts({ enabled, algodClient, config }) {
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (!enabled) { setQueue([]); return undefined; }
    let stopped = false;
    let timer;
    let watched = [];
    let watchedAt = 0;
    let previous = null;
    let lastPoll = 0;
    const seen = new Set();

    const poll = async () => {
      if (stopped) return;
      try {
        if (document.visibilityState !== "visible") {
          previous = null; // after being away, start again from the present instead of replaying what was missed
        } else {
          if (!watched.length || Date.now() - watchedAt > WATCH_REFRESH_MS) {
            const { records } = await readRecentRecords({ algodClient, config, limit: MAX_WATCHED });
            watched = records.filter((record) => record.status === 2n).map((record) => record.assetId);
            watchedAt = Date.now();
          }
          const current = watched.length ? await fetchVestigeAssets(watched) : new Map();
          const now = Math.floor(Date.now() / 1000);
          if (previous && current.size) {
            const trades = await collectNewTrades({ previous, current, sinceSeconds: lastPoll, seen });
            if (!stopped && trades.length) setQueue((old) => [...old, ...trades].slice(-MAX_QUEUE));
          }
          if (current.size) { previous = current; lastPoll = now; }
        }
      } catch { /* try again at the next poll */ }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled, algodClient, config]);

  return { queue, setQueue };
}
