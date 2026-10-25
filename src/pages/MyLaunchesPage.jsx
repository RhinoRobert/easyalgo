import { useEffect, useState } from "react";
import LaunchRow from "../components/LaunchRow";
import { CardSkeletons, EmptyState } from "../components/Placeholders";
import "../LaunchLab.css";
import { IS_MAINNET, useAlgorand } from "../hooks/useAlgorand";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { CANCEL_DELAY_ROUNDS, launchNetwork } from "../launchpad/config";
import { clearDirectoryCache, loadMyLaunches } from "../launchpad/directory";
import { buildCancelGroup, buildClaimLpGroup, buildVestigeGroup } from "../launchpad/launchpadClient";
import { vestigeManagerUrl } from "../launchpad/links";
import { simulateSignerGroup } from "../launchpad/simulation";

function friendly(cause) {
  const text = cause?.message || String(cause);
  if (/reject|declin|cancel|denied|closed/i.test(text)) return "The approval was cancelled in Pera Wallet. Nothing was sent.";
  return text;
}

/** The connected wallet's launches, with the actions each one still allows (claim LP, Vestige access, cancel). */
export default function MyLaunchesPage({ active }) {
  const { algodClient, indexerClient } = useAlgorand();
  const { account, connect, isConnecting, signAndSubmit } = usePeraWallet();
  const [state, setState] = useState({ status: "idle", items: [], round: 0, error: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const configured = launchNetwork.launchpadAppId !== 0n;

  const load = async () => {
    if (!configured || !account) return;
    clearDirectoryCache();
    setState((old) => ({ ...old, status: "loading", error: "" }));
    try {
      const result = await loadMyLaunches({ algodClient, indexerClient, config: launchNetwork, wallet: account });
      setState({ status: "ready", items: result.items, round: result.round, error: "" });
    } catch (cause) {
      setState((old) => ({ ...old, status: "error", error: cause?.message || String(cause) }));
    }
  };

  useEffect(() => {
    if (active && account) load();
  }, [active, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label, key, build) => {
    setBusy(key);
    setNotice("");
    try {
      const group = await build();
      await simulateSignerGroup(algodClient, group);
      await signAndSubmit(algodClient, group, 16);
      setNotice(`${label} confirmed.`);
      await load();
    } catch (cause) {
      setNotice(friendly(cause));
    } finally {
      setBusy("");
    }
  };

  const base = { algodClient, config: launchNetwork, wallet: account };

  return (
    <section className="launchlab-page directory" hidden={!active}>
      <div className="instant-hero">
        <div className="af-section-eyebrow">My launches</div>
        <h1>Your launches</h1>
        <p>Every launch started from your connected wallet, read straight from the chain, with whatever you can still do with each one.</p>
      </div>
      {!configured && <div className="instant-warning">No launchpad application is configured for this build.</div>}
      {!account ? (
        <div className="instant-card">
          <p>Connect your wallet to see your launches.</p>
          <button className="af-cta-btn" disabled={isConnecting} onClick={connect}>{isConnecting ? "Opening Pera…" : "Connect Pera"}</button>
        </div>
      ) : (
        <>
          <div className="directory-bar">
            <span>{state.status === "loading" ? "Loading…" : state.status === "ready" ? `${state.items.length} launch${state.items.length === 1 ? "" : "es"}` : ""}</span>
            <button className="af-btn-ghost" disabled={state.status === "loading" || Boolean(busy)} onClick={load}>Refresh</button>
          </div>
          {state.error && <div className="instant-error">Could not load your launches: {state.error}</div>}
          {notice && <div className="instant-warning">{notice}</div>}
          {state.status === "loading" && state.items.length === 0 ? <CardSkeletons count={2} /> : null}
          {state.status === "ready" && state.items.length === 0 ? (
            <EmptyState title="You have not launched anything with this wallet yet" text="Your launches, and what you can still do with each, will appear here." href="#launch" cta="Launch your first token" />
          ) : null}
          <ol className="launch-list">
            {state.items.map((item) => {
              const id = item.assetId.toString();
              const cancelOpen = item.pending && BigInt(state.round) >= BigInt(item.swapRound) + BigInt(CANCEL_DELAY_ROUNDS);
              return (
                <LaunchRow key={id} item={item} round={state.round}>
                  {item.pending ? (
                    <>
                      <a className="af-btn-ghost link-button" href="#launch">Continue launch</a>
                      <button className="af-btn-ghost" disabled={!cancelOpen || Boolean(busy)} title={cancelOpen ? "" : "Cancellation opens a little over two hours after the first approval"}
                        onClick={() => act("Cancellation", `cancel-${id}`, () => buildCancelGroup({ ...base, assetId: item.assetId }))}>
                        {busy === `cancel-${id}` ? "Working…" : "Cancel launch"}
                      </button>
                    </>
                  ) : null}
                  {item.status === 2n && item.creatorLpClaimed === 0n ? (
                    <button className="af-btn-ghost" disabled={Boolean(busy)} onClick={() => act("Claiming your LP", `claim-${id}`, () => buildClaimLpGroup({ ...base, assetId: item.assetId, lpAssetId: item.lpAssetId }))}>
                      {busy === `claim-${id}` ? "Working…" : "Claim my LP"}
                    </button>
                  ) : null}
                  {IS_MAINNET && item.status === 2n && item.vestigeGranted === 1n ? (
                    <a className="af-btn-ghost link-button" href={vestigeManagerUrl(item.assetId)} target="_blank" rel="noopener noreferrer">
                      Edit on Vestige <span aria-hidden="true">↗</span>
                    </a>
                  ) : null}
                  {item.status === 2n && item.vestigeGranted === 0n ? (
                    <button className="af-btn-ghost" disabled={Boolean(busy)} onClick={() => act("Vestige access", `vestige-${id}`, () => buildVestigeGroup({ ...base, assetId: item.assetId }))}>
                      {busy === `vestige-${id}` ? "Working…" : "Grant Vestige access"}
                    </button>
                  ) : null}
                </LaunchRow>
              );
            })}
          </ol>
          {IS_MAINNET && state.items.some((item) => item.status === 2n) ? (
            <p className="field-hint">After launch you can add a logo (must be 50x50), description and links to your token on Vestige.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
