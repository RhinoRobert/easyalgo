import { useCallback, useEffect, useMemo, useState } from "react";
import "../LaunchLab.css";
import { explorerAddrUrl, useAlgorand } from "../hooks/useAlgorand";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { shortAddress } from "../launchpad/format";
import { simulateSignerGroup } from "../launchpad/simulation";
import { MAX_NOTE_BYTES, POST_AMOUNT, POST_FEE, buildPostGroup, buildThread, draftBytes, loadThread, timeAgo } from "../launchpad/social";

const COST_ALGO = Number(POST_AMOUNT + POST_FEE) / 1e6;

function friendly(cause) {
  const text = cause?.message || String(cause);
  if (/reject|declin|cancel|denied|closed/i.test(text)) return "The approval was cancelled in Pera Wallet. Nothing was sent.";
  if (/overspend|below min/i.test(text)) return "The wallet does not hold enough spendable ALGO to post.";
  return text;
}

function Post({ post, launcher, onReply, reply = false }) {
  return (
    <li className={`thread-post${reply ? " thread-post--reply" : ""}`}>
      <div className="thread-post-head">
        <a href={explorerAddrUrl(post.sender)} target="_blank" rel="noreferrer noopener" title={post.sender}>{shortAddress(post.sender)}</a>
        {post.sender === launcher ? <span className="holder-label">Creator</span> : null}
        {post.replyTo ? <span className="thread-replyto">↩ {shortAddress(post.replyTo)}</span> : null}
        <span className="thread-time">{timeAgo(post.time)}</span>
      </div>
      {/* Posts are written by anyone: shown as plain text, never as links or markup. */}
      <p className="thread-body">{post.body}</p>
      <button type="button" className="thread-reply" onClick={() => onReply(post)}>Reply</button>
    </li>
  );
}

/** The conversation under a token: posts and replies stored on Algorand, read with the indexer and written by the poster's own wallet. */
export default function TokenThread({ assetId, launcher }) {
  const { algodClient, indexerClient } = useAlgorand();
  const { account, connect, isConnecting, signAndSubmit } = usePeraWallet();
  const [state, setState] = useState({ status: "loading", posts: [], complete: true, error: "" });
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await loadThread({ indexerClient, assetId });
      // a post just sent may not be in the indexer yet: keep it until the indexer has it
      setState((old) => {
        const known = new Set(result.posts.map((post) => post.txId));
        const pending = old.posts.filter((post) => post.local && !known.has(post.txId));
        return { status: "ready", posts: [...pending, ...result.posts], complete: result.complete, error: "" };
      });
    } catch (cause) {
      setState((old) => ({ ...old, status: "error", error: cause?.message || String(cause) }));
    }
  }, [indexerClient, assetId]);

  useEffect(() => { load(); }, [load]);

  const threads = useMemo(() => buildThread(state.posts), [state.posts]);
  const bytes = useMemo(() => { try { return draftBytes({ assetId, body, parent: replyTo?.txId }); } catch { return 0; } }, [assetId, body, replyTo]);
  const tooLong = bytes > MAX_NOTE_BYTES;

  const post = async () => {
    setError("");
    setNotice("");
    if (!account) { await connect(); return; }
    setBusy(true);
    try {
      const group = await buildPostGroup({ algodClient, wallet: account, assetId, body, parent: replyTo?.txId ?? null });
      await simulateSignerGroup(algodClient, group);
      const { txId } = await signAndSubmit(algodClient, group, 12);
      setState((old) => ({ ...old, posts: [{ txId, sender: account, time: Math.floor(Date.now() / 1000), body: body.trim(), parent: replyTo?.txId ?? null, local: true }, ...old.posts] }));
      setBody("");
      setReplyTo(null);
      setNotice("Posted on Algorand.");
      setTimeout(load, 6000);
    } catch (cause) {
      setError(friendly(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="instant-card token-thread" aria-label="Replies">
      <h2>Replies</h2>
      <div className="thread-compose">
        {replyTo ? (
          <div className="thread-replying">↩ Replying to {shortAddress(replyTo.sender)}
            <button type="button" className="thread-cancel" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button>
          </div>
        ) : null}
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} disabled={busy}
          placeholder={account ? "Say something about this token" : "Connect your wallet to post"} aria-label="Write a post" />
        <div className="thread-compose-bar">
          <span className={tooLong ? "thread-count thread-count--over" : "thread-count"}>{bytes}/{MAX_NOTE_BYTES}</span>
          <span className="field-hint">{COST_ALGO.toFixed(4)} ALGO</span>
          <button className="af-cta-btn" onClick={post} disabled={busy || isConnecting || (Boolean(account) && (!body.trim() || tooLong))}>
            {busy ? "Posting…" : account ? (replyTo ? "Post reply" : "Post") : isConnecting ? "Opening Pera…" : "Connect Pera"}
          </button>
        </div>
        {notice && <div className="instant-warning">{notice}</div>}
        {error && <div className="instant-error">{error}</div>}
      </div>

      {state.status === "loading" ? <p className="field-hint">Loading replies…</p> : null}
      {state.status === "error" ? <div className="instant-error">Could not load replies: {state.error}</div> : null}
      {state.status === "ready" && threads.length === 0 ? <p className="field-hint">No posts yet. Be the first.</p> : null}
      <ul className="thread-list">
        {threads.map((thread) => (
          <li key={thread.post.txId} className="thread">
            <ul>
              <Post post={thread.post} launcher={launcher} onReply={setReplyTo} />
              {thread.replies.map((reply) => <Post key={reply.txId} post={reply} launcher={launcher} onReply={setReplyTo} reply />)}
            </ul>
          </li>
        ))}
      </ul>
      {state.status === "ready" && !state.complete ? <p className="field-hint">Showing the newest 300 posts.</p> : null}
      <p className="field-hint">Posts are public and permanent transactions on Algorand, sent from your own wallet. Anyone can post; nothing here is checked or endorsed, and this site may hide posts it finds abusive.</p>
    </section>
  );
}
