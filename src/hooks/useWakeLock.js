import { useEffect } from "react";

/**
 * Keeps the screen awake while `active` is true. A phone that locks while you are approving in Pera can drop the wallet connection and leave a launch
 * half done. The browser releases the lock itself whenever the page is hidden (for example while Pera is in front), so it is asked for again on return.
 * Browsers without the feature, or that refuse it, are simply left alone.
 */
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.wakeLock) return undefined;
    let lock = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== "visible" || lock) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (stopped) { next.release().catch(() => {}); return; }
        lock = next;
        lock.addEventListener("release", () => { lock = null; });
      } catch { /* refused (low battery, unsupported context): nothing to do */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    acquire();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
      lock = null;
    };
  }, [active]);
}