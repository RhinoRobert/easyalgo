// Display helpers. Everything read from the chain (token names, URLs, addresses) is untrusted text: it is cleaned here and always rendered as plain
// text, never as markup and never as a clickable link built from the token's own URL.

// Ranges of control, zero-width, line-separator and bidirectional-override characters, built from code points so the source stays plain ASCII.
const INVISIBLE_RANGES = ["0000-001F", "007F-009F", "00AD", "061C", "180E", "200B-200F", "2028-202E", "2060-206F", "FEFF", "FFF9-FFFB"];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map((range) => range.split("-").map((hex) => `\\u${hex}`).join("-")).join("")}]`, "g");

/** Plain, single-line text safe to show: control, zero-width and bidi-override characters removed, length capped. */
export function safeText(value, max = 48) {
  const text = String(value ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Multi-line plain text safe to show (a post): every line cleaned like safeText, at most one blank line in a row, length capped. */
export function safeParagraphs(value, max = 900) {
  const lines = String(value ?? "").split(/\r\n|\r|\n/).map((line) => safeText(line, max));
  const kept = [];
  for (const line of lines) {
    if (line === "" && (kept.length === 0 || kept.at(-1) === "")) continue;
    kept.push(line);
  }
  while (kept.at(-1) === "") kept.pop();
  const text = kept.join("\n");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function shortAddress(address) {
  const text = String(address ?? "");
  return text.length > 12 ? `${text.slice(0, 5)}…${text.slice(-5)}` : text;
}

/** Value of both sides of a constant-product pool, in microALGO, using the PNET/ALGO price of the pinned source pool. */
export function poolTvlMicroAlgo({ pnetReserve, sourceAlgoReserve, sourcePnetReserve }) {
  const pnet = BigInt(pnetReserve);
  const algo = BigInt(sourceAlgoReserve);
  const sourcePnet = BigInt(sourcePnetReserve);
  if (sourcePnet <= 0n) return 0n;
  return (2n * pnet * algo) / sourcePnet;
}

/** "about 3 h ago" from a round difference (Algorand rounds are about 2.8 s). */
export function roundsAgo(currentRound, round) {
  const rounds = Math.max(0, Number(currentRound) - Number(round));
  const seconds = rounds * 2.8;
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

/** Run `task` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
