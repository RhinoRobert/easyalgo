// Whether trade alerts are shown. Kept in this browser only (localStorage can be blocked: then the choice lasts until the page is closed).
const KEY = "pnet-launchlab:trade-alerts";
const listeners = new Set();
let memory = null;

export function getAlertsOn() {
  if (memory !== null) return memory;
  try { memory = window.localStorage.getItem(KEY) !== "off"; } catch { memory = true; }
  return memory;
}

export function setAlertsOn(on) {
  memory = Boolean(on);
  try { window.localStorage.setItem(KEY, memory ? "on" : "off"); } catch { /* the choice still holds for this visit */ }
  listeners.forEach((listener) => listener());
}

export function subscribeAlerts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
