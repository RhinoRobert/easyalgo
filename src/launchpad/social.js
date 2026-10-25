// Reply threads on token pages. A post is an ordinary Algorand payment to the platform wallet whose note carries the text, in the same format the
// AlgoSocial feed uses: `ALGSOC:` + JSON {v:1, body, ts, parent?}. This site adds one field, "t": the token's asset id, written first so the indexer
// can find a token's posts with a plain note-prefix search (AlgoSocial's own reader ignores the extra field). There is no server: posts are read from
// the indexer and written by the poster's own wallet. Everything read back is untrusted text and is shown as plain text only.
import algosdk from "algosdk";
import { PLATFORM_WALLET } from "./config.js";
import { safeParagraphs } from "./format.js";

export const SOCIAL_PREFIX = "ALGSOC:";
export const SOCIAL_RECEIVER = PLATFORM_WALLET;
export const POST_AMOUNT = 500n; // microALGO, the same price AlgoSocial charges
export const POST_FEE = 1_000n;
export const MAX_NOTE_BYTES = 900;
const MAX_BODY_CHARS = 800;
const PAGE = 100;
const MAX_PAGES = 3;
const TXID = /^[A-Z2-7]{52}$/;
const encoder = new TextEncoder();

/** Posts this site chooses not to show. They stay on chain; this only hides them here. Add transaction ids or wallet addresses. */
export const HIDDEN_POSTS = new Set([]);
export const HIDDEN_AUTHORS = new Set([]);

function tokenId(assetId) {
  const id = Number(assetId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Not a valid asset id");
  return id;
}

/** The note for a post. `now` is only a parameter so tests can fix the clock. */
export function encodePost({ assetId, body, parent = null, now = Date.now() }) {
  const text = String(body ?? "").trim();
  if (!text) throw new Error("Write something first");
  if (parent && !TXID.test(parent)) throw new Error("That reply points at an invalid post");
  const post = { v: 1, t: tokenId(assetId), body: text, ts: Math.floor(now / 1000) };
  if (parent) post.parent = parent;
  const note = encoder.encode(SOCIAL_PREFIX + JSON.stringify(post));
  if (note.length > MAX_NOTE_BYTES) throw new Error(`Too long: a post can use at most ${MAX_NOTE_BYTES} bytes on chain`);
  return note;
}

/** How many note bytes a draft would use, for the counter. Over the limit it still returns the true size instead of throwing. */
export function draftBytes({ assetId, body, parent = null }) {
  const post = { v: 1, t: tokenId(assetId), body: String(body ?? "").trim(), ts: 1_700_000_000 };
  if (parent) post.parent = parent;
  return encoder.encode(SOCIAL_PREFIX + JSON.stringify(post)).length;
}

/** The note prefix that matches only this token's posts. */
export function threadPrefix(assetId) {
  return encoder.encode(`${SOCIAL_PREFIX}{"v":1,"t":${tokenId(assetId)},`);
}

/** A post from a transaction note, or null when it is not a well-formed post. The text is cleaned for display. */
export function decodePost(note) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(note); } catch { return null; }
  if (!text.startsWith(SOCIAL_PREFIX)) return null;
  let data;
  try { data = JSON.parse(text.slice(SOCIAL_PREFIX.length)); } catch { return null; }
  if (!data || typeof data !== "object" || data.v !== 1 || typeof data.body !== "string") return null;
  const body = safeParagraphs(data.body, MAX_BODY_CHARS);
  if (!body) return null;
  return {
    body,
    ts: Number.isFinite(data.ts) ? data.ts : 0,
    parent: typeof data.parent === "string" && TXID.test(data.parent) ? data.parent : null,
    token: Number.isSafeInteger(data.t) ? data.t : null,
  };
}

/** One indexer transaction as a post for this token, or null: it must be a payment of at least the post price to the platform wallet. */
export function postFromTransaction(tx, assetId) {
  const payment = tx?.paymentTransaction;
  if (!payment || String(payment.receiver) !== SOCIAL_RECEIVER || BigInt(payment.amount ?? 0n) < POST_AMOUNT) return null;
  const decoded = decodePost(tx.note ?? new Uint8Array());
  if (!decoded || decoded.token !== Number(assetId)) return null;
  const sender = String(tx.sender);
  if (HIDDEN_POSTS.has(tx.id) || HIDDEN_AUTHORS.has(sender)) return null;
  return { txId: String(tx.id), sender, time: Number(tx.roundTime ?? 0) || decoded.ts, body: decoded.body, parent: decoded.parent };
}

/** The newest posts of a token's thread (up to three pages of 100). */
export async function loadThread({ indexerClient, assetId }) {
  const prefix = threadPrefix(assetId);
  const posts = [];
  let next;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let request = indexerClient.searchForTransactions().address(SOCIAL_RECEIVER).addressRole("receiver").txType("pay").notePrefix(prefix).limit(PAGE);
    if (next) request = request.nextToken(next);
    const response = await request.do();
    for (const tx of response.transactions ?? []) {
      const post = postFromTransaction(tx, assetId);
      if (post) posts.push(post);
    }
    next = response.nextToken;
    if (!next) return { posts, complete: true };
  }
  return { posts, complete: false };
}

/**
 * Posts grouped into threads: newest conversation first, replies oldest first under the post they answer. A reply to a reply stays in the same
 * thread and records who it answers; a reply whose parent is not among the loaded posts becomes a post of its own.
 */
export function buildThread(posts) {
  const byId = new Map();
  for (const post of posts) byId.set(post.txId, post);
  const rootOf = (post) => {
    let current = post;
    const seen = new Set([post.txId]);
    while (current.parent && byId.has(current.parent)) {
      // a loop of replies has no real root: the post stands on its own instead of disappearing
      if (seen.has(current.parent)) return post;
      seen.add(current.parent);
      current = byId.get(current.parent);
    }
    return current;
  };
  const threads = new Map();
  for (const post of byId.values()) {
    const key = rootOf(post).txId;
    if (!threads.has(key)) threads.set(key, { post: byId.get(key), replies: [] });
    if (key !== post.txId) threads.get(key).replies.push({ ...post, replyTo: post.parent === key ? null : byId.get(post.parent)?.sender ?? null });
  }
  const list = [...threads.values()];
  for (const thread of list) thread.replies.sort((a, b) => a.time - b.time);
  const latest = (thread) => Math.max(thread.post.time, ...thread.replies.map((reply) => reply.time));
  return list.sort((a, b) => latest(b) - latest(a));
}

/** One payment carrying the post, ready for the wallet to sign. */
export async function buildPostGroup({ algodClient, wallet, assetId, body, parent = null }) {
  const params = await algodClient.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: wallet,
    receiver: SOCIAL_RECEIVER,
    amount: POST_AMOUNT,
    note: encodePost({ assetId, body, parent }),
    suggestedParams: { ...params, fee: POST_FEE, flatFee: true },
  });
  return [{ txn, signers: [wallet] }];
}

/** "just now", "5m", "3h", "2d", or a date, from a time in seconds. */
export function timeAgo(seconds, nowMs = Date.now()) {
  const age = Math.floor(nowMs / 1000) - Number(seconds);
  if (!Number.isFinite(age) || age < 0 || !seconds) return "";
  if (age < 60) return "just now";
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  if (age < 86400) return `${Math.floor(age / 3600)}h`;
  if (age < 604800) return `${Math.floor(age / 86400)}d`;
  return new Date(Number(seconds) * 1000).toLocaleDateString();
}
