export const SESSION_VERSION = 5;
// Two wallet approvals: "start" (create the token and buy PNET) and "finish" (pool, liquidity, LP split, Vestige).
export const LAUNCH_STEPS = ["quote", "start", "finish"];

const bigintReplacer = (_key, value) => typeof value === "bigint" ? `${value}n` : value;
const bigintReviver = (_key, value) => typeof value === "string" && /^\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value;

function emptyStep(status = "pending") {
  return { status, txId: null, transactionIds: [], confirmedRound: null };
}

export function createLaunchSession({ network, wallet, form, quote }) {
  return {
    version: SESSION_VERSION,
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${wallet.slice(0, 8)}`,
    network,
    wallet,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    form,
    quote,
    assetId: null,
    poolAddress: null,
    lpAssetId: null,
    actualPnetOutput: null,
    burnedLp: null,
    creatorLp: null,
    platformLp: null,
    terminalStatus: null,
    steps: {
      ...Object.fromEntries(LAUNCH_STEPS.map((name) => [name, emptyStep()])),
      quote: emptyStep("confirmed"),
    },
  };
}

export function sessionKey(network, wallet) {
  return `pnet-launchpad-v3:${SESSION_VERSION}:${network}:${wallet}`;
}

export function saveSession(session, storage = globalThis.localStorage) {
  const next = { ...session, updatedAt: Date.now() };
  storage.setItem(sessionKey(next.network, next.wallet), JSON.stringify(next, bigintReplacer));
  return next;
}

export function loadSession(network, wallet, storage = globalThis.localStorage) {
  const raw = storage.getItem(sessionKey(network, wallet));
  if (!raw) return null;
  const parsed = JSON.parse(raw, bigintReviver);
  if (parsed.version !== SESSION_VERSION || parsed.network !== network || parsed.wallet !== wallet) return null;
  return parsed;
}

export function updateStep(session, name, update) {
  if (!LAUNCH_STEPS.includes(name)) throw new Error(`Unknown launch step: ${name}`);
  return {
    ...session,
    steps: {
      ...session.steps,
      [name]: { ...session.steps[name], ...update },
    },
  };
}

export function confirmStep(session, name, confirmation = {}) {
  if (session.steps[name]?.status === "confirmed") return session;
  return updateStep(session, name, {
    status: "confirmed",
    txId: confirmation.txId ?? session.steps[name]?.txId ?? null,
    transactionIds: confirmation.transactionIds ?? session.steps[name]?.transactionIds ?? [],
    confirmedRound: confirmation.confirmedRound == null ? null : Number(confirmation.confirmedRound),
  });
}

export function nextPendingStep(session) {
  if (session.terminalStatus === "cancelled") return null;
  return LAUNCH_STEPS.find((name) => session.steps[name]?.status !== "confirmed") ?? null;
}

export async function reconcilePendingTransactions(session, algodClient) {
  let current = session;
  for (const name of LAUNCH_STEPS) {
    const step = current.steps[name];
    if (!step?.txId || step.status === "confirmed") continue;
    try {
      const pending = await algodClient.pendingTransactionInformation(step.txId).do();
      const round = pending.confirmedRound ?? pending["confirmed-round"];
      if (round) current = confirmStep(current, name, { txId: step.txId, confirmedRound: round });
    } catch {
      // The next chain snapshot remains authoritative; local pending state is
      // only a hint and must never cause a transaction to be replayed.
    }
  }
  return current;
}

export function reconcileSessionFromChain(session, snapshot) {
  let current = { ...session };
  const pending = snapshot?.pending ?? null;
  const launch = snapshot?.launch ?? null;
  if (pending) {
    // A pending record only exists after the start call: the token is created and the PNET is escrowed.
    current.assetId = pending.assetId;
    current.actualPnetOutput = pending.pnetOutput || null;
    current = confirmStep(current, "start", { txId: pending.createTxId, confirmedRound: pending.createdRound });
  }
  if (snapshot?.pool?.exists) {
    current.poolAddress = snapshot.pool.address;
    current.lpAssetId = snapshot.pool.lpAssetId;
  }
  if (launch) {
    current.assetId = launch.assetId;
    current.actualPnetOutput = launch.pnetSeed;
    current.poolAddress = launch.poolAddress || current.poolAddress;
    current.lpAssetId = launch.lpAssetId || current.lpAssetId;
    current.burnedLp = launch.burnedLp;
    current.creatorLp = launch.creatorLp;
    current.platformLp = launch.platformLp;
    current.terminalStatus = launch.status === 3n ? "cancelled" : "complete";
    current = confirmStep(current, "start", { txId: launch.createTxId, confirmedRound: launch.createdRound });
    if (launch.status === 2n) {
      current = confirmStep(current, "finish", { txId: launch.terminalTxId, confirmedRound: launch.terminalRound });
    }
  }
  return current;
}