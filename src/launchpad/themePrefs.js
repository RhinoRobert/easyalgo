// The colour theme: "auto" follows the system setting, or the visitor pins "dark" or "light". Kept in this browser only; /theme.js applies it
// before first paint (same storage key), and this module keeps the page in step when the choice changes.
const KEY = "pnet-launchlab:theme";
export const THEME_CHOICES = ["auto", "dark", "light"];
const COLOURS = { dark: "#08071a", light: "#f3f6fb" };
const listeners = new Set();
let memory = null;

export function getTheme() {
  if (memory !== null) return memory;
  try {
    const saved = window.localStorage.getItem(KEY);
    memory = saved === "dark" || saved === "light" ? saved : "auto";
  } catch { memory = "auto"; }
  return memory;
}

function apply(choice) {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", choice);
  const system = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const colour = COLOURS[choice === "auto" ? system : choice];
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", colour));
}

export function setTheme(choice) {
  memory = THEME_CHOICES.includes(choice) ? choice : "auto";
  try {
    if (memory === "auto") window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, memory);
  } catch { /* the choice still holds for this visit */ }
  apply(memory);
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The theme being shown right now, whether it was pinned or follows the system. */
export function effectiveTheme() {
  const pinned = document.documentElement.getAttribute("data-theme");
  if (pinned === "dark" || pinned === "light") return pinned;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** The header button: pin the opposite of what is shown. The footer still offers "auto" to follow the system again. */
export function toggleTheme() {
  setTheme(effectiveTheme() === "light" ? "dark" : "light");
}
