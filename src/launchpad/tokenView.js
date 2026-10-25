// Pure helpers behind the token page and the launch cards: routing, the safety checklist, price figures, search and sort, and the share link.
// Nothing here touches the network, so every rule can be tested on its own. Everything that comes from the chain is shown as plain text.
import { poolTvlMicroAlgo, safeText } from "./format.js";

const UINT64_MAX = (1n << 64n) - 1n;
const ROLES = ["manager", "reserve", "freeze", "clawback"];

/** `#token/<asset id>` opens a token page and `#creator/<wallet>` a creator page; anything else is a tab id. An id that is not valid is treated as neither. */
export function parseRoute(hash, pathname = "") {
  const id = String(hash ?? "").replace(/^#/, "");
  // A token's own address (`/token/<id>/`, the page a shared link opens) is the route while there is no `#` part; a `#` part always wins.
  const fromPath = id === "" ? /^\/token\/(\d{1,20})\/?$/.exec(String(pathname)) : null;
  const match = /^token\/(\d{1,20})$/.exec(id) ?? fromPath;
  if (match) {
    const assetId = BigInt(match[1]);
    if (assetId > 0n && assetId <= UINT64_MAX) return { tab: "token", assetId, address: null };
  }
  const creator = /^creator\/([A-Z2-7]{58})$/.exec(id);
  if (creator) return { tab: "creator", assetId: null, address: creator[1] };
  return { tab: /^(token|creator)\//.test(id) ? "" : id, assetId: null, address: null };
}

export const tokenHash = (assetId) => `#token/${BigInt(assetId)}`;
export const creatorHash = (address) => `#creator/${address}`;

/** Share of the pool's liquidity tokens that went to the burn account, in percent with one decimal, or null when there is no pool. */
export function burnedPercent(launch) {
  const total = (launch?.burnedLp ?? 0n) + (launch?.creatorLp ?? 0n) + (launch?.platformLp ?? 0n);
  if (total <= 0n) return null;
  return Number((launch.burnedLp * 1000n) / total) / 10;
}

const isSet = (address) => Boolean(address) && !/^A{58}$/.test(String(address)) && address !== "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

/**
 * The checklist shown on a token page. Each line is decided from chain data that the caller read, never from a claim:
 *   asset        the token's on-chain parameters (manager, reserve, freeze, clawback, creator)
 *   launch       the launchpad's own record of the launch (null when there is none)
 *   appAddress   the launchpad contract's account
 *   appTokenHolding   how much of the token the launchpad still holds
 *   poolIsCanonical   the recorded pool is the Tinyman pool derived from this token and PNET
 *   burnHolding  how many of the pool's liquidity tokens the ARC-54 burn account holds
 * Status is "pass", "fail" or "info" (true but worth knowing, such as the creator's own share of the liquidity tokens).
 */
export function buildSafetyChecks({ asset, launch, appAddress, appTokenHolding, poolIsCanonical, burnHolding }) {
  const checks = [];
  const open = ROLES.filter((role) => isSet(asset?.[role]));
  const madeByLaunchpad = asset?.creator === appAddress;
  checks.push(open.length === 0 && madeByLaunchpad
    ? { id: "locked", status: "pass", title: "The token cannot be changed", detail: "No manager, reserve, freeze or clawback address, and it was created by the launchpad contract. The supply is fixed and nobody can freeze, claw back or mint." }
    : { id: "locked", status: "fail", title: "The token can be changed", detail: open.length ? `Still has: ${open.join(", ")}.` : "It was not created by the launchpad contract." });

  if (!launch || launch.status !== 2n) return checks;

  checks.push(appTokenHolding === 0n
    ? { id: "supply", status: "pass", title: "Nothing held back by the launchpad", detail: "The launchpad contract holds none of this token: all of it went into the pool." }
    : { id: "supply", status: "fail", title: "The launchpad still holds some of the supply", detail: `${appTokenHolding.toString()} base units are still with the contract.` });

  checks.push(poolIsCanonical
    ? { id: "pool", status: "pass", title: "Official Tinyman pool", detail: "The liquidity is in the Tinyman v2 pool derived from this token and PNET, not a lookalike.", link: { type: "addr", id: launch.poolAddress } }
    : { id: "pool", status: "fail", title: "Pool does not match", detail: "The recorded pool is not the canonical Tinyman pool for this token and PNET." });

  const percent = burnedPercent(launch);
  const burnedOk = percent !== null && percent >= 79 && burnHolding >= launch.burnedLp;
  checks.push(burnedOk
    ? { id: "burn", status: "pass", title: `${percent.toFixed(1)}% of the liquidity is burned`, detail: "Held by the ARC-54 burn contract, which has no way to give it back.", link: launch.terminalTxId ? { type: "tx", id: launch.terminalTxId, label: "Burn transaction" } : null }
    : { id: "burn", status: "fail", title: "Burned liquidity does not match", detail: "The burn account holds fewer liquidity tokens than the launch recorded." });

  checks.push({
    id: "creator", status: "info", title: "Creator keeps 10% of the liquidity tokens",
    detail: launch.creatorLpClaimed === 1n ? "They have claimed it, so they can withdraw that share of the pool." : "Held by the launchpad until the creator claims it. Claiming lets them withdraw that share of the pool.",
  });
  checks.push({ id: "platform", status: "info", title: "Platform keeps 10% of the liquidity tokens", detail: "Held in tracked escrow by the launchpad contract." });
  return checks;
}

const num = (value) => Number(value);

/** Price, market cap and pool value from the pool's reserves and the PNET/ALGO source pool. Display figures only. */
export function tokenStats({ assetId, total, decimals, pool, source }) {
  const id = BigInt(assetId);
  const tokenReserve = pool.asset1Id === id ? pool.asset1Reserve : pool.asset2Reserve;
  const pnetReserve = pool.asset1Id === id ? pool.asset2Reserve : pool.asset1Reserve;
  const tvlMicroAlgo = poolTvlMicroAlgo({ pnetReserve, sourceAlgoReserve: source.algoReserve, sourcePnetReserve: source.pnetReserve });
  const scale = 10 ** Number(decimals ?? 0);
  const pnetValueMicro = source.pnetReserve > 0n ? (num(pnetReserve) * num(source.algoReserve)) / num(source.pnetReserve) : 0;
  const priceAlgo = tokenReserve > 0n ? pnetValueMicro / (num(tokenReserve) / scale) / 1e6 : 0;
  const marketCapAlgo = priceAlgo * (num(total) / scale);
  return { tokenReserve, pnetReserve, tvlMicroAlgo, priceAlgo, marketCapAlgo };
}

export function formatPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1) return value.toFixed(4);
  const digits = Math.min(12, Math.max(4, 2 - Math.floor(Math.log10(value))));
  return value.toFixed(digits);
}

export function formatCompact(value) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

/** Holders sorted by balance with their share of the total supply and a label for the addresses the launchpad knows. Zero balances are dropped. */
export function rankHolders({ balances, total, labels = {}, limit = 20 }) {
  const supply = BigInt(total);
  return balances
    .map((entry) => ({ address: String(entry.address), amount: BigInt(entry.amount) }))
    .filter((entry) => entry.amount > 0n)
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1))
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      percent: supply > 0n ? Number((entry.amount * 10000n) / supply) / 100 : 0,
      label: labels[entry.address] ?? "",
    }));
}

/** Search by name, unit or asset id; cancelled launches are hidden unless asked for. */
export function filterLaunches(items, { query = "", showCancelled = false } = {}) {
  const needle = String(query).trim().toLowerCase();
  return items.filter((item) => {
    if (!showCancelled && item.status === 3n) return false;
    if (!needle) return true;
    return String(item.name).toLowerCase().includes(needle)
      || String(item.unit ?? "").toLowerCase().includes(needle)
      || item.assetId.toString().includes(needle);
  });
}

const compareBig = (a, b) => (a === b ? 0 : a > b ? 1 : -1);

export function sortLaunches(items, sort = "newest") {
  const list = [...items];
  if (sort === "pool") return list.sort((a, b) => compareBig(b.tvlMicroAlgo ?? 0n, a.tvlMicroAlgo ?? 0n) || compareBig(b.assetId, a.assetId));
  if (sort === "oldest") return list.sort((a, b) => compareBig(a.assetId, b.assetId));
  return list.sort((a, b) => compareBig(b.assetId, a.assetId));
}

/** A pre-filled post for X. The text only claims what the launchpad's record shows (the burn line appears when the launch burned at least 79%). */
export function shareOnXUrl({ name, unit, assetId, burnedPct, pageUrl }) {
  const title = safeText(name, 40) || `Asset ${assetId}`;
  const ticker = safeText(unit, 12).replace(/[^A-Za-z0-9]/g, "");
  const burn = burnedPct !== null && burnedPct !== undefined && burnedPct >= 79 ? ` ${burnedPct.toFixed(0)}% of its liquidity is burned.` : "";
  const text = `${title}${ticker ? ` ($${ticker})` : ""} just launched on PNET LaunchLab.${burn}`;
  // The token's own page, so the post's preview shows this token (its title and description) and not the site's general card.
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { origin = String(pageUrl).replace(/[#?].*$/, "").replace(/\/+$/, ""); }
  const link = `${origin}/token/${BigInt(assetId)}/`;
  return `https://x.com/intent/post?${new URLSearchParams({ text, url: link }).toString()}`;
}

/** A stable colour and one- or two-letter mark for a token with no logo of its own. */
export function placeholderBadge({ assetId, unit, name }) {
  const mark = safeText(unit || name || "?", 4).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return { mark, hue: Number(BigInt(assetId) % 360n) };
}
