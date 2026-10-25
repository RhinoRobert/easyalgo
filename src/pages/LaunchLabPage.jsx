import React, { useEffect, useMemo, useState } from "react";
import algosdk from "algosdk";
import LaunchpadDeploymentConsole from "../components/LaunchpadDeploymentConsole";
import KingOfTheHill from "../components/KingOfTheHill";
import TokenBadge from "../components/TokenBadge";
import HowItWorks from "../components/HowItWorks";
import LaunchSuccess from "../components/LaunchSuccess";
import { burnedPercent, shareOnXUrl, tokenHash } from "../launchpad/tokenView";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { useWakeLock } from "../hooks/useWakeLock";
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
  MIN_SUPPLY_RAW,
} from "../launchpad/config";
import { buildLaunchQuote, estimatedLaunchCost, quoteIsExpired } from "../launchpad/quote";
import { attestLaunchpadApplication } from "../launchpad/attestation";
import { simulateSignerGroup } from "../launchpad/simulation";
import {
  readPool,
  readTinymanPoolState,
  readTinymanSourcePool,
  tinymanBootstrapCost,
} from "../launchpad/tinymanAdapter";
import {
  resolveStartedAsset,
  buildCancelGroup,
  buildClaimLpGroup,
  buildLaunchFinishGroup,
  buildLaunchStartGroup,
  buildVestigeGroup,
  readLaunchSnapshot,
  verifyCompletedLaunch,
} from "../launchpad/launchpadClient";
import {
  clearSession,
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
const SUPPLY_PRESETS = [
  { label: "1M", name: "1 million", value: "1000000" },
  { label: "100M", name: "100 million", value: "100000000" },
  { label: "1B", name: "1 billion", value: "1000000000" },
  { label: "1T", name: "1 trillion", value: "1000000000000" },
];
/** "1000000" as "1,000,000" for the preview; anything that is not a plain number is shown as typed. */
function prettySupply(text) {
  const value = Number(String(text).replaceAll(",", ""));
  return Number.isFinite(value) && value > 0 ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : (String(text).trim() || "0");
}

// What each step's internal status means to the person launching
const STEP_STATUS = {
  pending: "Not started",
  building: "Getting ready",
  signing: "Waiting for you in Pera",
  submitting: "Sending to the network",
  confirmed: "Done",
};
const STEP_LABELS = {
  quote: "Review the exact costs",
  start: "Approval 1 of 2: create your token and buy PNET",
  finish: "Approval 2 of 2: create the pool, add liquidity, split the LP",
};

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
  const totalRaw = parseDisplaySupply(form.displaySupply);
  if (totalRaw < MIN_SUPPLY_RAW) throw new Error("Supply must be at least 1 token (Tinyman cannot take a smaller first deposit)");
  return { ...form, name, unitName, url, totalRaw };
}

/** Plain-language text for the errors a person can actually meet. */
function friendlyError(cause) {
  const text = cause?.message || String(cause);
  if (/reject|declin|cancel|denied|closed/i.test(text)) {
    return "The approval was cancelled in Pera Wallet. Nothing was sent. Press Continue launch when you are ready.";
  }
  if (/overspend|below min/i.test(text)) return "The wallet does not hold enough spendable ALGO for this step.";
  return text;
}

function buttonLabel({ account, isConnecting, busy, session, step }) {
  if (!account) return isConnecting ? "Opening Pera…" : "Connect Pera";
  if (busy) return "Working… approve in Pera when it asks";
  if (!session) return "Launch token";
  if (!step) return "Launch complete";
  return "Continue launch";
}

function TinymanAutoPool({ account, connect, connectionError, isConnecting, signAndSubmit }) {
  const { algodClient } = useAlgorand();
  const [form, setForm] = useState({ name: "", unitName: "", displaySupply: "1000000", url: "" });
  const [session, setSession] = useState(null);
  const [chain, setChain] = useState(null);
  const [verification, setVerification] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attestation, setAttestation] = useState({ status: "pending", error: "" });
  const [round, setRound] = useState(0);
  const issues = useMemo(() => configurationIssues(), []);
  const step = session ? nextPendingStep(session) : "quote";
  useWakeLock(busy);

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

  const simulateAndSubmit = async (entries, presigned = {}, maxRounds = 16) => {
    const simulation = await simulateSignerGroup(algodClient, entries, presigned);
    setNotice(`Checked on chain: ${simulation.transactionCount} transactions will run exactly as shown. Open Pera Wallet to approve.`);
    return signAndSubmit(algodClient, entries, maxRounds, presigned);
  };

  const refreshFromChain = async (baseSession) => {
    if (!baseSession || !account || launchNetwork.launchpadAppId === 0n) return baseSession;
    const pendingReconciled = await reconcilePendingTransactions(baseSession, algodClient);
    const snapshot = await readLaunchSnapshot({
      algodClient,
      config: launchNetwork,
      wallet: account,
      assetId: pendingReconciled.assetId,
      scanDirectory: false, // a session that has no asset yet must not adopt the wallet's previous finished launch
    });
    const assetId = snapshot.pending?.assetId ?? snapshot.launch?.assetId ?? pendingReconciled.assetId;
    let pool = { exists: false };
    if (assetId) {
      pool = await readPool({
        algodClient,
        validatorAppId: launchNetwork.tinymanAppId,
        assetA: assetId,
        assetB: launchNetwork.pnetAssetId,
      });
    }
    const reconciled = reconcileSessionFromChain(pendingReconciled, { ...snapshot, pool });
    setChain({ ...snapshot, pool });
    if (snapshot.asset) {
      const expectedCreator = algosdk.getApplicationAddress(Number(launchNetwork.launchpadAppId)).toString();
      if (!snapshot.asset.immutable || snapshot.asset.creator !== expectedCreator) {
        throw new Error("Chain recovery found an ASA that is not immutable or was not created by the launchpad");
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
    const status = await algodClient.status().do();
    setRound(currentRound(status));
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
        // localStorage is only a convenience. Recover a pending launch or the wallet's newest record from the app's boxes.
        const snapshot = await readLaunchSnapshot({ algodClient, config: launchNetwork, wallet: account });
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
          ...createLaunchSession({ network: launchNetworkName, wallet: account, form: recoveredForm, quote: null }),
          assetId: recoveredAssetId,
        };
        setForm(recoveredForm);
        await refreshFromChain(recovered);
        setNotice("Recovered your launch from the chain; local browser state was not needed.");
      } catch (cause) {
        if (!cancelled) setError(`Recovery check: ${cause?.message || cause}`);
      }
    })();
    return () => { cancelled = true; };
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  const computeQuote = async (validatedForm) => {
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
      tinymanBootstrapCost: tinymanBootstrapCost(false),
    });
    const amount = BigInt(walletInfo.amount);
    const minimum = BigInt(walletInfo.minBalance ?? walletInfo["min-balance"] ?? 0);
    if (amount - minimum < quote.requiredWalletBalance) {
      throw new Error(`Spendable wallet balance is below the ${formatUnits(quote.requiredWalletBalance)} ALGO this launch needs`);
    }
    return quote;
  };

  /** Approval 1: create the token and buy PNET. */
  const runStart = async (current) => {
    const status = await algodClient.status().do();
    let working = current;
    if (quoteIsExpired(working.quote, currentRound(status))) {
      working = persist({ ...working, quote: await computeQuote(working.form) });
      setNotice("The quote was refreshed so the price is current.");
    }
    working = persist(updateStep(working, "start", { status: "signing" }));
    const group = await buildLaunchStartGroup({
      algodClient, config: launchNetwork, wallet: account, form: working.form, quote: working.quote,
    });
    const appTxId = group.at(-1).txn.txID().toString();
    working = persist(updateStep(working, "start", { status: "submitting", txId: appTxId }));
    const result = await simulateAndSubmit(group);
    const assetId = await resolveStartedAsset({ algodClient, config: launchNetwork, wallet: account, confirmation: result.confirmation });
    return persist({
      ...confirmStep(working, "start", { txId: appTxId, confirmedRound: Number(result.confirmation.confirmedRound ?? 0) }),
      assetId,
    });
  };

  /** Approval 2: pool, liquidity, LP split and Vestige access, in one atomic group. */
  const runFinish = async (current) => {
    const pool = await readPool({
      algodClient, validatorAppId: launchNetwork.tinymanAppId, assetA: current.assetId, assetB: launchNetwork.pnetAssetId,
    });
    let working = persist(updateStep(current, "finish", { status: "signing" }));
    let built = await buildLaunchFinishGroup({
      algodClient, config: launchNetwork, wallet: account, assetId: current.assetId, pool, grantVestige: true,
    });
    try {
      await simulateSignerGroup(algodClient, built.entries, built.presigned);
    } catch (firstError) {
      // Vestige is an outside dependency: if only that part is the problem the launch still goes ahead, and a separate retry follows.
      built = await buildLaunchFinishGroup({
        algodClient, config: launchNetwork, wallet: account, assetId: current.assetId, pool, grantVestige: false,
      });
      try {
        await simulateSignerGroup(algodClient, built.entries, built.presigned);
      } catch {
        throw firstError;
      }
      setNotice("Vestige access is not available right now, so the launch goes ahead without it. You can add it afterwards.");
    }
    const appTxId = built.entries.at(-1).txn.txID().toString();
    working = persist(updateStep(working, "finish", { status: "submitting", txId: appTxId }));
    const result = await simulateAndSubmit(built.entries, built.presigned, 20);
    return persist(confirmStep(working, "finish", {
      txId: appTxId, confirmedRound: Number(result.confirmation.confirmedRound ?? 0),
    }));
  };

  const launch = async () => {
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
      let current = session;
      if (!current) {
        const validated = validateForm(form);
        const quote = await computeQuote(validated);
        setForm(validated);
        current = persist(createLaunchSession({ network: launchNetworkName, wallet: account, form: validated, quote }));
      }
      current = await refreshFromChain(current);
      // Both approvals run back to back; the only interruptions are Pera's own prompts.
      for (let guard = 0; guard < 3; guard += 1) {
        const next = nextPendingStep(current);
        if (!next || next === "quote") break;
        current = next === "start" ? await runStart(current) : await runFinish(current);
        current = await refreshFromChain(current);
      }
      if (nextPendingStep(current) === null) setNotice("Launch complete. Everything below was read back from the chain.");
    } catch (cause) {
      console.error(cause);
      setError(friendlyError(cause));
      // An uncertain submission is never marked pending: the next click rebuilds from chain state first.
      try { await refreshFromChain(loadSession(launchNetworkName, account) ?? session); } catch { /* keep the message above */ }
    } finally {
      setBusy(false);
    }
  };

  const runSingle = async (label, buildGroup) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await simulateAndSubmit(await buildGroup());
      await refreshFromChain(session);
      setNotice(`${label} confirmed.`);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const claimLp = () => runSingle("Claiming your LP", () => buildClaimLpGroup({
    algodClient, config: launchNetwork, wallet: account, assetId: session.assetId, lpAssetId: chain.launch.lpAssetId,
  }));
  const retryVestige = () => runSingle("Vestige access", () => buildVestigeGroup({
    algodClient, config: launchNetwork, wallet: account, assetId: session.assetId,
  }));
  const cancelLaunch = () => runSingle("Cancellation", () => buildCancelGroup({
    algodClient, config: launchNetwork, wallet: account, assetId: session.assetId,
  }));

  const startAnother = () => {
    clearSession(launchNetworkName, account);
    setForm({ name: "", unitName: "", displaySupply: "1000000", url: "" });
    setSession(null);
    setChain(null);
    setVerification(null);
    setError("");
    setNotice("");
  };

  const quote = session?.quote;
  const terminal = session?.terminalStatus;
  const cancelRound = chain?.pending ? Number(chain.pending.swapRound) + CANCEL_DELAY_ROUNDS : null;
  const cancelOpen = cancelRound !== null && round >= cancelRound;
  const launchRecord = chain?.launch?.status === 2n ? chain.launch : null;

  return (
    <section className="launchlab-page instant-launch">
      <KingOfTheHill onChallenge={() => document.getElementById("launch-details")?.scrollIntoView({ behavior: "smooth", block: "start" })} />

      <div className="instant-hero">
        <div className="af-section-eyebrow">PNET Instant Launchpad v3</div>
        <h1>One asset. One Tinyman pool. Two approvals.</h1>
        <p>
          Name your token, approve twice in Pera, and it goes live on Tinyman with its whole supply in the pool.
          80% of the liquidity is burned, so it can never be pulled out.
        </p>
        <div className="instant-badges">
          <span className="instant-network">{launchNetwork.label}</span>
          <span className="instant-prototype">Beta</span>
          <span className="instant-prototype">Contract-enforced · resumable · no loose creator ASA</span>
        </div>
        <HowItWorks />
        <details className="hero-tech">
          <summary>What the contract does, exactly</summary>
          <p>
            Your wallet funds an immutable ASA and exactly one ALGO of PNET. The contract pools the complete
            supply and measured PNET output, sends 80% of LP to ARC-54, keeps 10% for you to claim, and retains 10% in
            tracked platform escrow.
          </p>
        </details>
      </div>

      {terminal === "complete" && session?.assetId && (
        <LaunchSuccess
          name={session.form.name} unit={session.form.unitName} assetId={session.assetId} burnedPct={burnedPercent(launchRecord)}
          pageUrl={`${window.location.origin}${window.location.pathname}`}
        />
      )}

      {issues.length > 0 && <div className="instant-warning">Signing disabled: {issues.join("; ")}</div>}
      {attestation.status === "failed" && <div className="instant-error">App attestation failed: {attestation.error}</div>}

      <div className="instant-grid">
        <div className="instant-card" id="launch-details">
          <h2>Launch details</h2>
          <label>Asset name<input disabled={!!session} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={32} placeholder="Profit Network Asset" autoComplete="off" />
            <small className="field-hint">What wallets and exchanges show. Up to 32 characters ({form.name.length}/32).</small></label>
          <label>Unit name<input disabled={!!session} value={form.unitName} onChange={(e) => setForm({ ...form, unitName: e.target.value.toUpperCase() })} maxLength={8} placeholder="TOKEN" autoComplete="off" />
            <small className="field-hint">The ticker, like a stock symbol: 1 to 8 letters or numbers.</small></label>
          <label>Display supply<input disabled={!!session} value={form.displaySupply} onChange={(e) => setForm({ ...form, displaySupply: e.target.value })} inputMode="decimal" />
            <span className="supply-chips" role="group" aria-label="Common supplies">
              {SUPPLY_PRESETS.map((preset) => (
                <button type="button" key={preset.value} className={`chip${form.displaySupply === preset.value ? " chip--active" : ""}`} disabled={!!session}
                  aria-label={preset.name} title={preset.name} aria-pressed={form.displaySupply === preset.value}
                  onClick={() => setForm({ ...form, displaySupply: preset.value })}>{preset.label}</button>
              ))}
            </span>
            <small className="field-hint">How many tokens exist in total. All of them go into the pool.</small></label>
          <label>Optional asset URL<input disabled={!!session} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="ipfs://… or https://…" autoComplete="off" />
            <small className="field-hint">A website for the token. It is fixed forever and shown only as plain text.</small></label>
          <div className="token-preview" aria-label="Preview of your token">
            <TokenBadge assetId={BigInt([...(form.unitName || form.name)].reduce((sum, char) => sum + char.charCodeAt(0), 0))} unit={form.unitName} name={form.name || "?"} />
            <strong>{form.name.trim() || "Your token name"} <span className="launch-unit">{form.unitName.trim() || "TICKER"}</span></strong>
            <small>{prettySupply(form.displaySupply)} supply · 100% into the pool · 80% of liquidity burned · token cannot be changed after launch</small>
          </div>
          <div className="instant-summary"><span>ALGO swapped</span><strong>Exactly 1 ALGO</strong></div>
          <div className="instant-summary"><span>ASA placed in pool</span><strong>100%</strong></div>
          <div className="instant-summary"><span>LP ownership</span><strong>80% burn · 10% creator · 10% platform</strong></div>
          <div className="instant-summary" title="Includes the 1 ALGO that becomes the pool's PNET, the Tinyman pool creation (about 1.06 ALGO), storage deposits and network fees. The wallet should also hold a small cushion.">
            <span>Estimated cost</span>
            <strong>about {Number(formatUnits(estimatedLaunchCost().spent, 6)).toFixed(2)} ALGO <small className="cost-note">(keep {Number(formatUnits(estimatedLaunchCost().keepAvailable, 6)).toFixed(0)} ALGO in the wallet)</small></strong>
          </div>
          <button
            className="af-cta-btn"
            disabled={
              !account
                ? busy || isConnecting
                : busy || issues.length > 0 || attestation.status !== "verified" || terminal === "cancelled" || (session && !step)
            }
            onClick={launch}
          >
            {buttonLabel({ account, isConnecting, busy, session, step })}
          </button>
          {connectionError && <div className="instant-error">{connectionError}</div>}
          {terminal && <button className="af-btn-ghost" onClick={startAnother}>Prepare another launch</button>}
          <p className="field-hint">Two Pera approvals in total. Each is simulated on chain first, so a launch that could not complete is refused before you sign.</p>
        </div>

        <div className="instant-card">
          <h2>Your launch</h2>
          <p className="field-hint">Two approvals in Pera. It is safe to close the page between them: it picks up where it stopped.</p>
          {LAUNCH_STEPS.map((name) => {
            const state = session?.steps?.[name];
            const status = state?.status || "pending";
            return (
              <div className={`instant-step instant-step--${status}`} key={name}>
                <span>{status === "confirmed" ? "✓" : status !== "pending" ? "…" : name === "start" ? 1 : name === "finish" ? 2 : "○"}</span>
                <div><strong>{STEP_LABELS[name]}</strong><small>{STEP_STATUS[status] ?? status}</small></div>
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
            <p>Valid until round {quote.expiresRound}; the app refreshes it by itself if it ages.</p>
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
            <p>{terminal === "complete" ? "Liquidity launch complete." : terminal === "cancelled" ? "Launch cancelled." : "Launch in progress; safe to close and resume."}</p>
          </div>
          <div className="instant-receipt">
            <a href={explorerAppUrl(launchNetwork.launchpadAppId)} target="_blank" rel="noreferrer">Launchpad app ↗</a>
            <a href={explorerAssetUrl(session.assetId)} target="_blank" rel="noreferrer">Immutable ASA ↗</a>
            {session.poolAddress && <a href={explorerAddrUrl(session.poolAddress)} target="_blank" rel="noreferrer">Tinyman pool ↗</a>}
            {session.lpAssetId && <a href={explorerAssetUrl(session.lpAssetId)} target="_blank" rel="noreferrer">LP asset ↗</a>}
            {terminal === "complete" && <a href={tokenHash(session.assetId)}>Token page and safety checklist</a>}
            {terminal === "complete" && (
              <a href={shareOnXUrl({ name: session.form.name, unit: session.form.unitName, assetId: session.assetId, burnedPct: burnedPercent(launchRecord), pageUrl: `${window.location.origin}${window.location.pathname}` })} target="_blank" rel="noopener noreferrer">Share on X ↗</a>
            )}
            {terminal === "complete" && session.steps.finish?.txId && <a href={explorerTxUrl(session.steps.finish.txId)} target="_blank" rel="noreferrer" title="The transaction that sent 80% of the liquidity tokens to the ARC-54 burn account">Burn LP (80%) ↗</a>}
            {Object.values(session.steps).flatMap((item) => [item.txId, ...(item.transactionIds || [])]).filter(Boolean).map((txId) => (
              <a key={txId} href={explorerTxUrl(txId)} target="_blank" rel="noreferrer">Transaction {txId.slice(0, 8)}… ↗</a>
            ))}
          </div>
          {verification && <div className="instant-trust-note"><strong>All {Object.keys(verification).length} acceptance checks passed on chain.</strong><span>Immutable ASA, exact reserves, LP conservation, ARC-54 balance and platform escrow were independently read back.</span></div>}
          {launchRecord && launchRecord.creatorLpClaimed === 0n && (
            <div className="instant-warning">
              Your 10% of the liquidity tokens is held safely by the contract. Claim them only if you want to withdraw liquidity.
              <button className="af-btn-ghost" disabled={busy} onClick={claimLp}>Claim my LP</button>
            </div>
          )}
          {launchRecord && launchRecord.vestigeGranted === 0n && (
            <div className="instant-warning">
              Vestige metadata access has not been granted yet.
              <button className="af-btn-ghost" disabled={busy} onClick={retryVestige}>Grant Vestige access</button>
            </div>
          )}
          {cancelRound && !terminal && (
            <div className="instant-warning">
              {cancelOpen
                ? "If the launch cannot finish, you can cancel now and get half of the token and half of the PNET back."
                : `If the launch cannot finish, cancellation opens at round ${cancelRound} (about ${Math.max(1, Math.ceil((cancelRound - round) * 2.8 / 60))} minutes from now).`}
              <button className="af-btn-ghost" disabled={busy || !cancelOpen} onClick={cancelLaunch}>Cancel this launch</button>
            </div>
          )}
        </section>
      )}

      <div className="instant-trust-note">
        <strong>Liquidity and initial price are not promises of value, profit, or permanent TVL.</strong>
        <span>Cancelling returns half of the escrowed token and PNET to you and the other half to the platform wallet, and prevents the launch from finishing.</span>
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
      signAndSubmit={wallet.signAndSubmit}
    />
  );
}
