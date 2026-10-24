import React, { useEffect, useMemo, useState } from "react";
import algosdk from "algosdk";
import LaunchpadDeploymentConsole from "../components/LaunchpadDeploymentConsole";
import { usePeraWallet } from "../hooks/usePeraWallet";
import "../LaunchLab.css";
import {
  explorerAddrUrl,
  explorerAppUrl,
  explorerAssetUrl,
  explorerTxUrl,
  useAlgorand,
} from "../hooks/useAlgorand";
import { formatUnits, parseDisplaySupply } from "../launchpad/amounts";
import {
  CANCEL_DELAY_ROUNDS,
  configurationIssues,
  launchNetwork,
  launchNetworkName,
} from "../launchpad/config";
import { buildLaunchQuote, quoteIsExpired } from "../launchpad/quote";
import { attestLaunchpadApplication } from "../launchpad/attestation";
import { simulateSignerGroup } from "../launchpad/simulation";
import {
  bootstrapTinymanV2Pool,
  discoverTinymanV2Pool,
  poolSnapshot,
  readTinymanPoolState,
  readTinymanSourcePool,
  tinymanBootstrapCost,
} from "../launchpad/tinymanAdapter";
import {
  assetIdFromCreateConfirmation,
  buildCancelGroup,
  buildCreateAssetGroup,
  buildFinalizeGroup,
  buildRecoveryOptIns,
  buildSwapPnetGroup,
  buildVestigeGroup,
  readLaunchSnapshot,
  verifyCompletedLaunch,
} from "../launchpad/launchpadClient";
import {
  confirmStep,
  createLaunchSession,
  LAUNCH_STEPS,
  loadSession,
  nextPendingStep,
  reconcilePendingTransactions,
  reconcileSessionFromChain,
  saveSession,
  updateStep,
} from "../launchpad/session";

const encoder = new TextEncoder();
const SHOW_DEPLOYMENT_CONSOLE = import.meta.env.DEV
  && import.meta.env.VITE_SHOW_DEPLOYMENT_CONSOLE === "LOCAL_ONLY";
const STEP_LABELS = {
  quote: "Quote exact launch costs",
  asset_create: "Create immutable six-decimal ASA",
  pnet_swap: "Swap exactly 1 ALGO into PNET",
  pool_bootstrap: "Bootstrap deterministic Tinyman v2 pool",
  finalize: "Pool 100% supply and split LP 80 / 10 / 10",
  vestige: "Grant retryable Vestige metadata access",
};

function roundOf(value) {
  return Number(value?.confirmedRound ?? value?.["confirmed-round"] ?? 0);
}

function currentRound(status) {
  return Number(status?.lastRound ?? status?.["last-round"] ?? 0);
}

function validateForm(form) {
  const name = form.name.trim();
  const unitName = form.unitName.trim().toUpperCase();
  const url = form.url.trim();
  if (!name || encoder.encode(name).length > 32) throw new Error("Name must be 1–32 UTF-8 bytes");
  if (!/^[A-Z0-9]{1,8}$/.test(unitName)) throw new Error("Unit name must be 1–8 uppercase letters or digits");
  if (encoder.encode(url).length > 96) throw new Error("URL must be at most 96 UTF-8 bytes");
  return { ...form, name, unitName, url, totalRaw: parseDisplaySupply(form.displaySupply) };
}

function actionLabel(step, busy) {
  if (busy) return "Waiting for wallet or chain confirmation…";
  return {
    quote: "Build exact launch quote",
    asset_create: "Sign asset creation",
    pnet_swap: "Sign exact 1 ALGO Tinyman swap",
    pool_bootstrap: "Sign Tinyman pool bootstrap",
    finalize: "Sign atomic liquidity + LP split",
    vestige: "Sign Vestige access grant",
  }[step] || "Launch complete";
}

function TinymanAutoPool({ account, connect, connectionError, isConnecting, tinymanSigner, signAndSubmit }) {
  const { algodClient } = useAlgorand();
  const [form, setForm] = useState({ name: "", unitName: "", displaySupply: "1000000", url: "" });
  const [session, setSession] = useState(null);
  const [chain, setChain] = useState(null);
  const [verification, setVerification] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attestation, setAttestation] = useState({ status: "pending", error: "" });
  const issues = useMemo(() => configurationIssues(), []);
  const step = session ? nextPendingStep(session) : "quote";

  useEffect(() => {
    if (launchNetwork.launchpadAppId === 0n) return undefined;
    let cancelled = false;
    setAttestation({ status: "checking", error: "" });
    attestLaunchpadApplication(algodClient, launchNetwork)
      .then(() => { if (!cancelled) setAttestation({ status: "verified", error: "" }); })
      .catch((cause) => {
        if (!cancelled) setAttestation({ status: "failed", error: cause?.message || String(cause) });
      });
    return () => { cancelled = true; };
  }, [algodClient]);

  const persist = (next) => {
    const saved = saveSession(next);
    setSession(saved);
    return saved;
  };

  const simulateAndSubmit = async (group, maxRounds = 12) => {
    const simulation = await simulateSignerGroup(algodClient, group);
    setNotice(
      `Simulation passed: ${simulation.transactionCount} outer transactions, `
      + `${simulation.appBudgetConsumed} app budget consumed. Open Pera to sign the exact group.`,
    );
    return signAndSubmit(algodClient, group, maxRounds);
  };

  const refreshFromChain = async (baseSession) => {
    if (!baseSession || !account || launchNetwork.launchpadAppId === 0n) return baseSession;
    const pendingReconciled = await reconcilePendingTransactions(baseSession, algodClient);
    const snapshot = await readLaunchSnapshot({
      algodClient,
      config: launchNetwork,
      wallet: account,
      assetId: pendingReconciled.assetId,
    });
    let pool = { ready: false };
    const assetId = snapshot.pending?.assetId ?? snapshot.launch?.assetId ?? pendingReconciled.assetId;
    if (assetId) {
      try {
        const found = await discoverTinymanV2Pool({
          algodClient,
          network: launchNetwork.tinymanNetwork,
          pnetAssetId: launchNetwork.pnetAssetId,
          launchedAssetId: assetId,
        });
        pool = poolSnapshot(found);
      } catch {
        pool = { ready: false };
      }
    }
    const reconciled = reconcileSessionFromChain(pendingReconciled, { ...snapshot, pool });
    setChain({ ...snapshot, pool });
    if (snapshot.asset) {
      const expectedCreator = algosdk.getApplicationAddress(Number(launchNetwork.launchpadAppId));
      if (!snapshot.asset.immutable || snapshot.asset.creator !== expectedCreator) {
        throw new Error("Chain recovery found an ASA that is not immutable or was not created by launchpad v2");
      }
    }
    if (snapshot.launch?.status === 2n && snapshot.launch.poolAddress) {
      const poolState = await readTinymanPoolState({
        algodClient,
        poolAddress: snapshot.launch.poolAddress,
        tinymanAppId: launchNetwork.tinymanAppId,
      });
      setVerification(await verifyCompletedLaunch({
        algodClient,
        config: launchNetwork,
        wallet: account,
        snapshot,
        poolState,
      }));
    }
    return persist(reconciled);
  };

  useEffect(() => {
    if (!account || issues.length || launchNetwork.launchpadAppId === 0n) return;
    let cancelled = false;
    (async () => {
      try {
        const local = loadSession(launchNetworkName, account);
        if (cancelled) return;
        if (local) {
          setForm(local.form);
          await refreshFromChain(local);
          return;
        }
        // localStorage is only a convenience.  Recover a pending launch or the
        // wallet's newest terminal directory record directly from app boxes.
        const snapshot = await readLaunchSnapshot({
          algodClient,
          config: launchNetwork,
          wallet: account,
        });
        const recoveredAssetId = snapshot.pending?.assetId ?? snapshot.launch?.assetId ?? null;
        if (!recoveredAssetId || !snapshot.asset) return;
        const recoveredForm = {
          name: snapshot.asset.name,
          unitName: snapshot.asset.unitName,
          displaySupply: formatUnits(snapshot.asset.total),
          url: snapshot.asset.url,
          totalRaw: snapshot.asset.total,
        };
        const recovered = {
          ...createLaunchSession({
            network: launchNetworkName,
            wallet: account,
            form: recoveredForm,
            quote: null,
          }),
          assetId: recoveredAssetId,
        };
        setForm(recoveredForm);
        await refreshFromChain(recovered);
        setNotice("Recovered launch progress from on-chain boxes; local browser state was not required.");
      } catch (cause) {
        if (!cancelled) setError(`Recovery check: ${cause?.message || cause}`);
      }
    })();
    return () => { cancelled = true; };
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  const computeQuote = async (validatedForm = validateForm(form), assetAlreadyCreated = false) => {
    const [status, source, walletInfo] = await Promise.all([
      algodClient.status().do(),
      readTinymanSourcePool({
        algodClient,
        sourcePool: launchNetwork.sourcePool,
        tinymanAppId: launchNetwork.tinymanAppId,
        pnetAssetId: launchNetwork.pnetAssetId,
      }),
      algodClient.accountInformation(account).do(),
    ]);
    const quote = buildLaunchQuote({
      currentRound: currentRound(status),
      totalRaw: validatedForm.totalRaw,
      sourcePoolState: source,
      tinymanBootstrapCost: tinymanBootstrapCost(1_000n),
    });
    const amount = BigInt(walletInfo.amount);
    const minimum = BigInt(walletInfo.minBalance ?? walletInfo["min-balance"] ?? 0);
    const alreadyPaid = assetAlreadyCreated
      ? quote.itemizedAlgo.assetAndDirectoryMbr + quote.itemizedAlgo.createGroupFees
      : 0n;
    const remainingRequired = quote.requiredWalletBalance - alreadyPaid;
    if (amount - minimum < remainingRequired) {
      throw new Error(`Spendable wallet balance is below the remaining quoted ${formatUnits(remainingRequired)} ALGO requirement`);
    }
    return { quote, validatedForm };
  };

  const quoteLaunch = async () => {
    const { quote, validatedForm } = await computeQuote();
    const next = createLaunchSession({
      network: launchNetworkName,
      wallet: account,
      form: validatedForm,
      quote,
    });
    setForm(validatedForm);
    persist(next);
    setNotice("Quote locked for ten rounds or two minutes. Review it before creating the ASA.");
  };

  const runNext = async () => {
    setError("");
    setNotice("");
    if (!account) { await connect(); return; }
    if (issues.length) { setError(issues.join("; ")); return; }
      if (attestation.status !== "verified") {
        setError(attestation.error || "The configured launchpad App ID has not passed bytecode attestation");
        return;
      }
    setBusy(true);
    try {
      if (!session || step === "quote") {
        await quoteLaunch();
        return;
      }
      let current = await refreshFromChain(session);
      const next = nextPendingStep(current);
      if (!next) return;

      if (["asset_create", "pnet_swap"].includes(next)) {
        const status = await algodClient.status().do();
        if (quoteIsExpired(current.quote, currentRound(status))) {
          const refreshed = await computeQuote(current.form, next === "pnet_swap");
          current = persist({ ...current, quote: refreshed.quote });
          setNotice("The quote expired and was refreshed. Review the new output, then click again to sign.");
          return;
        }
      }

      current = persist(updateStep(current, next, { status: "signing" }));
      if (next === "asset_create") {
        const group = await buildCreateAssetGroup({
          algodClient,
          appId: launchNetwork.launchpadAppId,
          wallet: account,
          form: current.form,
        });
        const appTxId = group.at(-1).txn.txID().toString();
        current = persist(updateStep(current, next, { status: "submitting", txId: appTxId }));
        await simulateAndSubmit(group);
        const confirmation = await algodClient.pendingTransactionInformation(appTxId).do();
        const assetId = assetIdFromCreateConfirmation(confirmation);
        current = persist({
          ...confirmStep(current, next, { txId: appTxId, confirmedRound: roundOf(confirmation) }),
          assetId,
        });
      } else if (next === "pnet_swap") {
        const group = await buildSwapPnetGroup({
          algodClient,
          config: launchNetwork,
          wallet: account,
          assetId: current.assetId,
          quote: current.quote,
        });
        const appTxId = group.at(-1).txn.txID().toString();
        current = persist(updateStep(current, next, { status: "submitting", txId: appTxId }));
        const result = await simulateAndSubmit(group);
        current = persist(confirmStep(current, next, {
          txId: appTxId,
          confirmedRound: roundOf(result.confirmation),
        }));
      } else if (next === "pool_bootstrap") {
        const result = await bootstrapTinymanV2Pool({
          algodClient,
          network: launchNetwork.tinymanNetwork,
          walletAddress: account,
          pnetAssetId: launchNetwork.pnetAssetId,
          launchedAssetId: current.assetId,
          launchedUnitName: current.form.unitName,
          initiatorSigner: tinymanSigner,
          onProgress: (event) => {
            setSession((old) => old ? updateStep(old, next, { status: event.status }) : old);
          },
        });
        const snapshot = poolSnapshot(result.pool);
        current = persist({
          ...confirmStep(current, next, { transactionIds: result.transactionIds }),
          poolAddress: snapshot.address,
          lpAssetId: snapshot.lpAssetId,
        });
      } else if (next === "finalize") {
        const group = await buildFinalizeGroup({
          algodClient,
          config: launchNetwork,
          wallet: account,
          assetId: current.assetId,
          poolAddress: current.poolAddress,
          lpAssetId: current.lpAssetId,
        });
        const appTxId = group.at(-1).txn.txID().toString();
        current = persist(updateStep(current, next, { status: "submitting", txId: appTxId }));
        const result = await simulateAndSubmit(group, 16);
        current = persist(confirmStep(current, next, {
          txId: appTxId,
          confirmedRound: roundOf(result.confirmation),
        }));
      } else if (next === "vestige") {
        const group = await buildVestigeGroup({
          algodClient,
          config: launchNetwork,
          wallet: account,
          assetId: current.assetId,
        });
        const appTxId = group.at(-1).txn.txID().toString();
        current = persist(updateStep(current, next, { status: "submitting", txId: appTxId }));
        const result = await simulateAndSubmit(group);
        current = persist(confirmStep(current, next, {
          txId: appTxId,
          confirmedRound: roundOf(result.confirmation),
        }));
      }
      await refreshFromChain(current);
    } catch (cause) {
      console.error(cause);
      setError(cause?.message || String(cause));
      // Do not mark an uncertain submission as pending.  A timeout can occur
      // after the network accepted the group; the next click first rebuilds
      // status from boxes/pool state and only retries when chain state proves
      // the step did not complete.
    } finally {
      setBusy(false);
    }
  };

  const cancelLaunch = async () => {
    if (!session?.assetId) return;
    setBusy(true);
    setError("");
    try {
      const optIns = await buildRecoveryOptIns({
        algodClient, config: launchNetwork, wallet: account, assetId: session.assetId,
        status: chain?.pending?.status,
      });
      if (optIns.length) await simulateAndSubmit(optIns);
      const group = await buildCancelGroup({
        algodClient, config: launchNetwork, wallet: account, assetId: session.assetId,
        status: chain?.pending?.status,
      });
      await simulateAndSubmit(group);
      await refreshFromChain(session);
    } catch (cause) {
      setError(cause?.message || String(cause));
    } finally {
      setBusy(false);
    }
  };

  const startAnother = () => {
    setSession(null);
    setChain(null);
    setVerification(null);
    setError("");
    setNotice("");
  };

  const quote = session?.quote;
  const terminal = session?.terminalStatus;
  const cancelRound = chain?.pending
    ? Number(chain.pending.status === 0n ? chain.pending.createdRound : chain.pending.swapRound)
      + CANCEL_DELAY_ROUNDS
    : null;

  return (
    <section className="launchlab-page instant-launch">
      <div className="instant-hero">
        <div className="af-section-eyebrow">PNET Instant Launchpad v2</div>
        <h1>One asset. One Tinyman pool. Verifiable liquidity.</h1>
        <p>
          Your wallet funds an immutable ASA and exactly one ALGO of PNET. The contract pools
          the complete supply and measured PNET output, sends 80% of LP to ARC-54, gives you
          10%, and retains 10% in tracked platform escrow.
        </p>
        <div className="instant-badges">
          <span className="instant-network">{launchNetwork.label}</span>
          <span className="instant-prototype">Contract-enforced · resumable · no loose creator ASA</span>
        </div>
      </div>

      {issues.length > 0 && <div className="instant-warning">Signing disabled: {issues.join("; ")}</div>}
      {attestation.status === "failed" && <div className="instant-error">App attestation failed: {attestation.error}</div>}

      <div className="instant-grid">
        <div className="instant-card">
          <h2>Launch details</h2>
          <label>Asset name<input disabled={!!session} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={32} placeholder="Profit Network Asset" /></label>
          <label>Unit name<input disabled={!!session} value={form.unitName} onChange={(e) => setForm({ ...form, unitName: e.target.value.toUpperCase() })} maxLength={8} placeholder="TOKEN" /></label>
          <label>Display supply<input disabled={!!session} value={form.displaySupply} onChange={(e) => setForm({ ...form, displaySupply: e.target.value })} inputMode="decimal" /></label>
          <label>Optional asset URL<input disabled={!!session} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="ipfs://… or https://…" /></label>
          <div className="instant-summary"><span>ALGO swapped</span><strong>Exactly 1 ALGO</strong></div>
          <div className="instant-summary"><span>ASA placed in pool</span><strong>100%</strong></div>
          <div className="instant-summary"><span>LP ownership</span><strong>80% burn · 10% creator · 10% platform</strong></div>
          <button
            className="af-cta-btn"
            disabled={
              !account
                ? busy || isConnecting
                : busy || issues.length > 0 || attestation.status !== "verified" || terminal === "cancelled"
            }
            onClick={runNext}
          >
            {!account ? (isConnecting ? "Opening Pera…" : "Connect Pera") : actionLabel(step, busy)}
          </button>
          {connectionError && <div className="instant-error">{connectionError}</div>}
          {terminal && <button className="af-btn-ghost" onClick={startAnother}>Prepare another launch</button>}
          <p className="field-hint">Every signing request is a bounded, inspectable group. Confirmed chain state is checked before the next group is built.</p>
        </div>

        <div className="instant-card">
          <h2>Chain-backed progress</h2>
          {LAUNCH_STEPS.map((name) => {
            const state = session?.steps?.[name];
            const status = state?.status || "pending";
            return (
              <div className={`instant-step instant-step--${status}`} key={name}>
                <span>{status === "confirmed" ? "✓" : status === "pending" ? "○" : "…"}</span>
                <div><strong>{STEP_LABELS[name]}</strong><small>{status}</small></div>
              </div>
            );
          })}
          {notice && <div className="instant-warning">{notice}</div>}
          {error && <div className="instant-error">{error}</div>}
        </div>
      </div>

      {quote && (
        <section className="instant-lifecycle" aria-label="Exact launch quote">
          <div className="instant-lifecycle-heading">
            <div><div className="af-section-eyebrow">Wallet quote</div><h2>Exact inputs and conservative reserves</h2></div>
            <p>Expires at round {quote.expiresRound} or {new Date(quote.expiresAt).toLocaleTimeString()}.</p>
          </div>
          <div className="instant-grid">
            <div className="instant-card">
              <div className="instant-summary"><span>Expected PNET</span><strong>{formatUnits(quote.expectedPnet)} PNET</strong></div>
              <div className="instant-summary"><span>Contract minimum PNET</span><strong>{formatUnits(quote.minimumPnet)} PNET</strong></div>
              <div className="instant-summary"><span>Price impact</span><strong>{quote.priceImpactPct.toFixed(2)}%</strong></div>
              <div className="instant-summary"><span>Pool token seed</span><strong>{formatUnits(quote.tokenSeed)}</strong></div>
              <div className="instant-summary"><span>Estimated creator LP</span><strong>{quote.estimatedLpSplit.creatorLp.toString()}</strong></div>
              <div className="instant-summary"><span>Estimated platform LP</span><strong>{quote.estimatedLpSplit.platformLp.toString()}</strong></div>
            </div>
            <div className="instant-card">
              {Object.entries(quote.itemizedAlgo).map(([name, amount]) => (
                <div className="instant-summary" key={name}><span>{name.replaceAll(/([A-Z])/g, " $1")}</span><strong>{formatUnits(amount)} ALGO</strong></div>
              ))}
              <div className="instant-summary"><span>Required spendable balance</span><strong>{formatUnits(quote.requiredWalletBalance)} ALGO</strong></div>
            </div>
          </div>
        </section>
      )}

      {session?.assetId && (
        <section className="instant-lifecycle" aria-label="Launch receipt">
          <div className="instant-lifecycle-heading">
            <div><div className="af-section-eyebrow">Permanent receipt</div><h2>ASA #{session.assetId.toString()}</h2></div>
            <p>{terminal === "complete" ? "Liquidity launch complete." : terminal === "cancelled" ? "Launch permanently canceled." : "Launch in progress; safe to close and resume."}</p>
          </div>
          <div className="instant-receipt">
            <a href={explorerAppUrl(launchNetwork.launchpadAppId)} target="_blank" rel="noreferrer">Launchpad app ↗</a>
            <a href={explorerAssetUrl(session.assetId)} target="_blank" rel="noreferrer">Immutable ASA ↗</a>
            {session.poolAddress && <a href={explorerAddrUrl(session.poolAddress)} target="_blank" rel="noreferrer">Tinyman pool ↗</a>}
            {session.lpAssetId && <a href={explorerAssetUrl(session.lpAssetId)} target="_blank" rel="noreferrer">LP asset ↗</a>}
            {Object.values(session.steps).flatMap((item) => [item.txId, ...(item.transactionIds || [])]).filter(Boolean).map((txId) => (
              <a key={txId} href={explorerTxUrl(txId)} target="_blank" rel="noreferrer">Transaction {txId.slice(0, 8)}… ↗</a>
            ))}
          </div>
          {verification && <div className="instant-trust-note"><strong>All {Object.keys(verification).length} acceptance checks passed on chain.</strong><span>Immutable ASA, exact reserves, LP conservation, ARC-54 balance, creator balance, and platform escrow were independently read back.</span></div>}
          {cancelRound && !terminal && <div className="instant-warning">If the launch remains impossible, recovery becomes available at round {cancelRound}. Before the swap, cancellation returns the full ASA; after the swap, it returns half of the ASA and PNET. Cancellation permanently prevents completion.<button className="af-btn-ghost" disabled={busy} onClick={cancelLaunch}>Attempt timed cancellation</button></div>}
        </section>
      )}

      <div className="instant-trust-note">
        <strong>Liquidity and initial price are not promises of value, profit, or permanent TVL.</strong>
        <span>Vestige authorization runs only after liquidity completion and can be retried without risking pooled funds.</span>
      </div>
      {SHOW_DEPLOYMENT_CONSOLE && (
        <LaunchpadDeploymentConsole
          account={account}
          algodClient={algodClient}
          signAndSubmit={signAndSubmit}
        />
      )}
    </section>
  );
}

export default function LaunchLabPage() {
  const wallet = usePeraWallet();
  return (
    <TinymanAutoPool
      account={wallet.account}
      connect={wallet.connect}
      connectionError={wallet.connectionError}
      isConnecting={wallet.isConnecting}
      tinymanSigner={wallet.tinymanSigner}
      signAndSubmit={wallet.signAndSubmit}
    />
  );
}
