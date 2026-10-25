import test from "node:test";
import assert from "node:assert/strict";
import algosdk from "algosdk";
import {
  MAX_NOTE_BYTES, POST_AMOUNT, SOCIAL_RECEIVER, buildPostGroup, buildThread, decodePost, draftBytes, encodePost, loadThread, postFromTransaction, threadPrefix, timeAgo,
} from "../src/launchpad/social.js";
import { safeParagraphs } from "../src/launchpad/format.js";

const PARENT = "X7XVVRYFX6NWM73P2EO3HIFPT2ATQCSJINT5ZTJZNMZHUKWQAGLA";
const text = (bytes) => new TextDecoder().decode(bytes);
const bytes = (value) => new TextEncoder().encode(value);

// AlgoSocial's own reader, copied from its published bundle: it must still accept a post made here.
function algoSocialDecode(noteBase64) {
  try {
    const note = atob(noteBase64);
    return note.startsWith("ALGSOC:") ? JSON.parse(note.slice("ALGSOC:".length)) : null;
  } catch { return null; }
}

test("a post is AlgoSocial's format with the token id first, so one prefix finds a token's posts", () => {
  const note = encodePost({ assetId: 3753533790n, body: "  hello  ", now: 1_786_709_000_000 });
  assert.equal(text(note), 'ALGSOC:{"v":1,"t":3753533790,"body":"hello","ts":1786709000}');
  assert.ok(text(note).startsWith(text(threadPrefix(3753533790n))));
  assert.ok(!text(note).startsWith(text(threadPrefix(375353379n))), "a shorter id must not match a longer one");
  const withParent = encodePost({ assetId: 5n, body: "hi", parent: PARENT, now: 1000 });
  assert.equal(JSON.parse(text(withParent).slice(7)).parent, PARENT);
  assert.ok(text(withParent).startsWith(text(threadPrefix(5n))));
});

test("AlgoSocial's own decoder still reads a post made here", () => {
  const note = encodePost({ assetId: 7n, body: "line one\nline two \u{1F680}", parent: PARENT, now: 5000 });
  const seen = algoSocialDecode(Buffer.from(note).toString("base64"));
  assert.equal(seen.v, 1);
  assert.equal(seen.parent, PARENT);
  assert.equal(seen.ts, 5);
});

test("drafts are checked before they are signed", () => {
  assert.throws(() => encodePost({ assetId: 5n, body: "   " }), /Write something/);
  assert.throws(() => encodePost({ assetId: 5n, body: "x", parent: "not-a-txid" }), /invalid post/);
  assert.throws(() => encodePost({ assetId: 0n, body: "x" }), /valid asset/);
  assert.throws(() => encodePost({ assetId: 5n, body: "x".repeat(MAX_NOTE_BYTES) }), /Too long/);
  assert.ok(encodePost({ assetId: 5n, body: "x".repeat(MAX_NOTE_BYTES - 60) }).length <= MAX_NOTE_BYTES);
  assert.ok(draftBytes({ assetId: 5n, body: "x".repeat(2000) }) > MAX_NOTE_BYTES, "the counter reports the true size instead of throwing");
});

test("decoding rejects anything that is not a well-formed post and cleans what it keeps", () => {
  assert.equal(decodePost(bytes("hello")), null);
  assert.equal(decodePost(bytes("ALGSOC:{not json")), null);
  assert.equal(decodePost(bytes('ALGSOC:{"v":2,"body":"x"}')), null);
  assert.equal(decodePost(bytes('ALGSOC:{"v":1,"body":5}')), null);
  assert.equal(decodePost(bytes('ALGSOC:{"v":1,"body":"   "}')), null);
  assert.equal(decodePost(new Uint8Array([0xff, 0xfe, 0xfd])), null);
  const post = decodePost(bytes('ALGSOC:{"v":1,"t":9,"body":"a\\u202Eb\\n\\n\\n\\nc","ts":4,"parent":"short"}'));
  assert.equal(post.body, "ab\n\nc");
  assert.equal(post.parent, null, "a malformed parent id is dropped");
  assert.equal(post.token, 9);
});

test("paragraph cleaning keeps line breaks but removes invisible and bidi characters", () => {
  assert.equal(safeParagraphs("\n\nhi​ there\r\n\r\n\r\nbye\n\n"), "hi there\n\nbye");
  assert.equal(safeParagraphs("x".repeat(20), 10).length, 10);
});

const tx = (overrides = {}) => ({
  id: "TXID1", sender: "SENDER", roundTime: 1_786_000_000,
  paymentTransaction: { receiver: SOCIAL_RECEIVER, amount: POST_AMOUNT },
  note: encodePost({ assetId: 5n, body: "hello", now: 1_786_000_000_000 }),
  ...overrides,
});

test("only paid posts to the platform wallet for this token are accepted", () => {
  assert.equal(postFromTransaction(tx(), 5n).body, "hello");
  assert.equal(postFromTransaction(tx(), 5n).time, 1_786_000_000, "the chain's round time is used, not the poster's own timestamp");
  assert.equal(postFromTransaction(tx(), 6n), null, "another token's post");
  assert.equal(postFromTransaction(tx({ paymentTransaction: { receiver: "OTHER", amount: POST_AMOUNT } }), 5n), null);
  assert.equal(postFromTransaction(tx({ paymentTransaction: { receiver: SOCIAL_RECEIVER, amount: POST_AMOUNT - 1n } }), 5n), null);
  assert.equal(postFromTransaction(tx({ paymentTransaction: undefined }), 5n), null);
});

test("threads: replies nest under their post, loops and orphans do not vanish", () => {
  const p = (txId, time, parent = null, sender = txId) => ({ txId, sender, time, body: txId, parent });
  const threads = buildThread([
    p("A", 10), p("B", 20, "A"), p("C", 30, "B"), p("D", 5), p("E", 40, "MISSING"),
    p("X", 50, "Y"), p("Y", 51, "X"),
  ]);
  const byRoot = Object.fromEntries(threads.map((t) => [t.post.txId, t.replies.map((r) => r.txId)]));
  assert.deepEqual(byRoot.A, ["B", "C"]);
  assert.equal(threads.find((t) => t.post.txId === "A").replies[1].replyTo, "B", "a reply to a reply records who it answers");
  assert.equal(threads.find((t) => t.post.txId === "A").replies[0].replyTo, null);
  assert.ok("D" in byRoot && "E" in byRoot, "orphans stand on their own");
  const seen = threads.flatMap((t) => [t.post.txId, ...t.replies.map((r) => r.txId)]);
  assert.deepEqual([...seen].sort(), ["A", "B", "C", "D", "E", "X", "Y"], "every post is shown exactly once, including a reply loop");
  assert.equal(threads[0].post.txId === "X" || threads[0].post.txId === "Y", true, "the most recently active conversation is first");
});

test("loadThread asks the indexer for this token's prefix, receiver and payments, and pages through results", async () => {
  const calls = [];
  const request = (page) => {
    const call = { page };
    calls.push(call);
    const builder = {
      address: (value) => { call.address = value; return builder; },
      addressRole: (value) => { call.role = value; return builder; },
      txType: (value) => { call.type = value; return builder; },
      notePrefix: (value) => { call.prefix = text(value); return builder; },
      limit: (value) => { call.limit = value; return builder; },
      nextToken: (value) => { call.next = value; return builder; },
      do: async () => (page === 0 ? { transactions: [tx()], nextToken: "more" } : { transactions: [tx({ id: "TXID2" }), tx({ id: "BAD", note: bytes("junk") })], nextToken: undefined }),
    };
    return builder;
  };
  let page = 0;
  const indexerClient = { searchForTransactions: () => request(page++) };
  const result = await loadThread({ indexerClient, assetId: 5n });
  assert.deepEqual(result.posts.map((post) => post.txId), ["TXID1", "TXID2"]);
  assert.equal(result.complete, true);
  assert.equal(calls[0].address, SOCIAL_RECEIVER);
  assert.equal(calls[0].role, "receiver");
  assert.equal(calls[0].type, "pay");
  assert.equal(calls[0].prefix, 'ALGSOC:{"v":1,"t":5,');
  assert.equal(calls[1].next, "more");
});

test("the post transaction is one payment of the post price plus a flat fee, signed by the poster", async () => {
  const wallet = algosdk.generateAccount().addr.toString();
  const algodClient = { getTransactionParams: () => ({ do: async () => ({ fee: 0n, minFee: 1000n, firstValid: 10n, lastValid: 1010n, genesisHash: new Uint8Array(32), genesisID: "mainnet-v1.0", flatFee: false }) }) };
  const group = await buildPostGroup({ algodClient, wallet, assetId: 5n, body: "hi", parent: PARENT });
  assert.equal(group.length, 1);
  const { txn, signers } = group[0];
  assert.deepEqual(signers, [wallet]);
  assert.equal(txn.type, "pay");
  assert.equal(txn.payment.receiver.toString(), SOCIAL_RECEIVER);
  assert.equal(txn.payment.amount, 500n);
  assert.equal(txn.fee, 1000n);
  assert.equal(txn.sender.toString(), wallet);
  assert.ok(text(txn.note).startsWith('ALGSOC:{"v":1,"t":5,"body":"hi"'));
});

test("relative time", () => {
  const now = 1_000_000_000_000;
  assert.equal(timeAgo(1_000_000_000 - 5, now), "just now");
  assert.equal(timeAgo(1_000_000_000 - 300, now), "5m");
  assert.equal(timeAgo(1_000_000_000 - 7200, now), "2h");
  assert.equal(timeAgo(1_000_000_000 - 172800, now), "2d");
  assert.equal(timeAgo(0, now), "");
});
