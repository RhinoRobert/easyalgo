import { useEffect, useState } from "react";
import "../LaunchLab.css";
import { explorerAddrUrl, explorerAppUrl, explorerAssetUrl, useAlgorand } from "../hooks/useAlgorand";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { formatUnits } from "../launchpad/amounts";
import { PLATFORM_WALLET, configurationIssues, launchNetwork } from "../launchpad/config";
import { clearDirectoryCache, loadDeferredPnetLaunches, loadOperations } from "../launchpad/directory";
import { roundsAgo, shortAddress } from "../launchpad/format";
import {
  accountHasAsset,
  buildOptInGroup,
  buildReleaseAllocationGroup,
  buildReleaseCancelledPnetGroup,
} from "../launchpad/launchpadClient";
import { simulateSignerGroup } from "../launchpad/simulation";

const KIND = { 1n: "Cancelled launch: platform's half of the token", 2n: "Platform's 10% of the liquidity tokens" };

function friendly(cause) {
  const text = cause?.message || String(cause);
  if (/reject|declin|cancel|denied|closed/i.test(text)) return "The approval was cancelled in Pera Wallet. Nothing was sent.";
  return text;
}

/**
 * Operations: read-only for everyone (it is all public chain data). The controls only work for the platform authority wallet, and the
 * contract enforces that too, so disabling them here is a convenience and not the protection.
 */
export default function OperationsPage({ active }) {
  const { algodClient } = useAlgorand();
  const { account, connect, isConnecting, signAndSubmit } = usePeraWallet();
  const [state, setState] = useState({ status: "idle", data: null, deferred: [], error: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const configured = launchNetwork.launchpadAppId !== 0n;
  const isAuthority = account === PLATFORM_WALLET;
  const launchingEnabled = configurationIssues().length === 0;

  const load = async () => {
    if (!configured) return;
    clearDirectoryCache();
    setState((old) => ({ ...old, status: "loading", error: "" }));
    try {
      const [data, deferred] = await Promise.all([
        loadOperations({ algodClient, config: launchNetwork }),
        loadDeferredPnetLaunches({ algodClient, config: launchNetwork }),
      ]);
      setState({ status: "ready", data, deferred, error: "" });
    } catch (cause) {
      setState((old) => ({ ...old, status: "error", error: cause?.message || String(cause) }));
    }
  };

  useEffect(() => {
    if (active) load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (group) => {
    await simulateSignerGroup(algodClient, group);
    return signAndSubmit(algodClient, group, 16);
  };

  const releaseAllocation = async (allocation) => {
    const key = `alloc-${allocation.launchAssetId}`;
    setBusy(key);
    setNotice("");
    try {
      // The contract pays only to an account already holding the asset, and it needs a group of its own, so opting in is a separate step.
      if (!(await accountHasAsset(algodClient, account, allocation.holdingAssetId))) {
        setNotice("First approval: let your wallet hold this asset. The release follows.");
        await submit(await buildOptInGroup({ algodClient, wallet: account, assetId: allocation.holdingAssetId }));
      }
      await submit(await buildReleaseAllocationGroup({
        algodClient, config: launchNetwork, wallet: account, launchAssetId: allocation.launchAssetId,
        holdingAssetId: allocation.holdingAssetId, receiver: account, amount: allocation.remaining,
      }));
      setNotice("Released to your wallet.");
      await load();
    } catch (cause) {
      setNotice(friendly(cause));
    } finally {
      setBusy("");
    }
  };

  const releaseDeferred = async (launch) => {
    const key = `pnet-${launch.assetId}`;
    setBusy(key);
    setNotice("");
    try {
      await submit(await buildReleaseCancelledPnetGroup({ algodClient, config: launchNetwork, wallet: account, launchAssetId: launch.assetId }));
      setNotice("Deferred PNET released to your wallet.");
      await load();
    } catch (cause) {
      setNotice(friendly(cause));
    } finally {
      setBusy("");
    }
  };

  const data = state.data;
  const lock = !isAuthority ? "Connect the platform authority wallet to use this" : "";
  return (
    <section className="launchlab-page directory" hidden={!active}>
      <div className="instant-hero">
        <div className="af-section-eyebrow">Operations</div>
        <h1>Launchpad operations</h1>
        <p>Health of the contract and its source pool, launches that need attention, and what the platform is owed. Anyone can read this: it is all public chain data. The controls work only for the platform authority wallet.</p>
      </div>
      {!configured && <div className="instant-warning">No launchpad application is configured for this build.</div>}
      {state.error && <div className="instant-error">Could not load operations data: {state.error}</div>}
      {notice && <div className="instant-warning">{notice}</div>}
      {!isAuthority && (
        <div className="instant-card ops-lock">
          <p>{account ? `Connected as ${shortAddress(account)}, which is not the platform authority. Controls are switched off.` : "Controls are switched off until the platform authority wallet is connected."}</p>
          {!account && <button className="af-btn-ghost" disabled={isConnecting} onClick={connect}>{isConnecting ? "Opening Pera…" : "Connect Pera"}</button>}
        </div>
      )}
      <div className="directory-bar">
        <span>{state.status === "loading" ? "Loading…" : data ? `Read at round ${data.round}` : ""}</span>
        <button className="af-btn-ghost" disabled={state.status === "loading" || Boolean(busy)} onClick={load}>Refresh</button>
      </div>

      {data && (
        <>
          {data.alerts.length > 0 && (
            <div className="instant-error" role="alert">
              <strong>Needs attention</strong>
              <ul>{data.alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul>
            </div>
          )}
          <div className="instant-grid ops-grid">
            <div className="instant-card">
              <h2>Contract</h2>
              <div className="instant-summary"><span>Application</span><strong><a href={explorerAppUrl(launchNetwork.launchpadAppId)} target="_blank" rel="noreferrer noopener">{launchNetwork.launchpadAppId.toString()} ↗</a></strong></div>
              <div className="instant-summary"><span>Address</span><strong><a href={explorerAddrUrl(data.appAddress)} target="_blank" rel="noreferrer noopener">{shortAddress(data.appAddress)} ↗</a></strong></div>
              <div className="instant-summary"><span>Initialized</span><strong>{data.initialized ? "yes" : "NO"}</strong></div>
              <div className="instant-summary"><span>Launches recorded</span><strong>{data.totalLaunches.toString()}</strong></div>
              <div className="instant-summary"><span>Cancel delay</span><strong>{data.cancelDelay.toString()} rounds</strong></div>
              <div className="instant-summary"><span>Launching on this site</span><strong>{launchingEnabled ? "enabled" : "off"}</strong></div>
            </div>
            <div className="instant-card">
              <h2>Balances</h2>
              <div className="instant-summary"><span>App ALGO</span><strong>{formatUnits(data.appBalanceMicroAlgo)}</strong></div>
              <div className="instant-summary"><span>Free after deposits (cushion 0.3)</span><strong>{formatUnits(data.freeMicroAlgo)}</strong></div>
              <div className="instant-summary"><span>PNET held</span><strong>{formatUnits(data.pnetHeld)}</strong></div>
              <div className="instant-summary"><span>PNET escrowed for pending launches</span><strong>{formatUnits(data.reservedPnet)}</strong></div>
              <div className="instant-summary"><span>PNET owed to the platform</span><strong>{formatUnits(data.deferredPnet)}</strong></div>
            </div>
            <div className="instant-card">
              <h2>Source pool (PNET / ALGO)</h2>
              <div className="instant-summary"><span>PNET reserve</span><strong>{formatUnits(data.source.pnetReserve)}</strong></div>
              <div className="instant-summary"><span>ALGO reserve</span><strong>{formatUnits(data.source.algoReserve)}</strong></div>
              <div className="instant-summary"><span>1 ALGO buys</span><strong>{formatUnits(data.oneAlgoSwap.expectedPnet)} PNET</strong></div>
              <div className="instant-summary"><span>Price impact of a launch</span><strong>{(Number(data.oneAlgoSwap.priceImpactBps) / 100).toFixed(2)}% (refused above 5%)</strong></div>
            </div>
          </div>

          <section className="instant-lifecycle">
            <h2>Launches in progress ({data.pendingLaunches.length})</h2>
            {data.pendingLaunches.length === 0 ? <p className="field-hint">None.</p> : (
              <ul className="ops-list">
                {data.pendingLaunches.map((launch) => {
                  const stuck = BigInt(data.round) - launch.swapRound > data.cancelDelay;
                  return (
                    <li key={launch.assetId.toString()}>
                      <span>Asset <a href={explorerAssetUrl(launch.assetId)} target="_blank" rel="noreferrer noopener">{launch.assetId.toString()} ↗</a> by {shortAddress(launch.launcher)}</span>
                      <span>started {roundsAgo(data.round, launch.swapRound)}{stuck ? " · past the cancel delay" : ""}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="instant-lifecycle">
            <h2>Owed to the platform</h2>
            {data.allocations.length === 0 && state.deferred.length === 0 ? <p className="field-hint">Nothing waiting to be released.</p> : null}
            <ul className="ops-list">
              {data.allocations.map((allocation) => (
                <li key={allocation.launchAssetId.toString()}>
                  <span>{allocation.meta.name} · {KIND[allocation.kind] ?? "Allocation"}<br /><small>{formatUnits(allocation.remaining)} of asset {allocation.holdingAssetId.toString()}</small></span>
                  <button className="af-btn-ghost" disabled={!isAuthority || Boolean(busy)} title={lock} onClick={() => releaseAllocation(allocation)}>
                    {busy === `alloc-${allocation.launchAssetId}` ? "Working…" : "Release to my wallet"}
                  </button>
                </li>
              ))}
              {state.deferred.map((launch) => (
                <li key={`pnet-${launch.assetId}`}>
                  <span>{launch.name} · PNET deferred from a cancelled launch<br /><small>{formatUnits(launch.cancelPlatformPnetRemaining)} PNET</small></span>
                  <button className="af-btn-ghost" disabled={!isAuthority || Boolean(busy)} title={lock} onClick={() => releaseDeferred(launch)}>
                    {busy === `pnet-${launch.assetId}` ? "Working…" : "Release deferred PNET"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
