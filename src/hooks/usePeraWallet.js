import { useCallback, useEffect, useSyncExternalStore } from "react";
import { PeraWalletConnect } from "@perawallet/connect";

const IS_MAINNET = import.meta.env.VITE_NETWORK === "mainnet";
const CONNECT_TIMEOUT_MS = 120_000;

const peraWallet = new PeraWalletConnect({
  shouldShowSignTxnToast: true,
  chainId: IS_MAINNET ? 416001 : 416002,
});

// One shared wallet state for the whole app (the header and the page read the same connection), outside React so every hook instance agrees.
let state = { account: null, isConnecting: false, connectionError: "" };
const listeners = new Set();
const setState = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => state;

let reconnectStarted = false;
function reconnectOnce() {
  if (reconnectStarted) return;
  reconnectStarted = true;
  // A session that already exists comes back after a reload, so the wallet stays connected until it is disconnected.
  peraWallet.reconnectSession().then((accounts) => {
    if (accounts.length) {
      setState({ account: accounts[0] });
      peraWallet.connector?.on("disconnect", disconnect);
    }
  }).catch(() => {});
}

async function connect() {
  setState({ isConnecting: true, connectionError: "" });
  try {
    // Long enough to pick up a phone, open Pera and approve: a 20 s limit expired before anyone could scan the code.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out — open Pera Wallet and try again")), CONNECT_TIMEOUT_MS)
    );
    const accounts = await Promise.race([peraWallet.connect(), timeout]);
    setState({ account: accounts[0] });
    peraWallet.connector?.on("disconnect", disconnect);
    return accounts[0];
  } catch (err) {
    if (err?.data?.type !== "CONNECT_MODAL_CLOSED") {
      console.error("Pera connect error:", err);
    }
    setState({
      connectionError: err?.data?.type === "CONNECT_MODAL_CLOSED"
        ? "Pera connection was canceled."
        : err?.message || "Pera Wallet could not connect. Try again.",
    });
    return null;
  } finally {
    setState({ isConnecting: false });
  }
}

function disconnect() {
  peraWallet.disconnect();
  setState({ account: null, connectionError: "" });
}

async function signAndSend(algodClient, txns) {
  const { account } = state;
  if (!account) throw new Error("Wallet not connected");

  // Each txn wrapped for Pera: { txn, signers }
  const txnsToSign = txns.map((txn) => ({ txn, signers: [account] }));

  const signedTxns = await peraWallet.signTransaction([txnsToSign]);
  const { txId } = await algodClient.sendRawTransaction(signedTxns).do();

  // Wait for confirmation
  await waitForConfirmation(algodClient, txId, 12);
  return txId;
}

// `presigned` maps a group index to a blob signed without the wallet (the Tinyman pool's own LogicSig transaction). Those
// entries carry `signers: []`, so Pera is asked only for the wallet's transactions and the blobs are merged back in order.
async function signAndSubmit(algodClient, signerTxns, maxRounds = 12, presigned = {}) {
  const { account } = state;
  if (!account) throw new Error("Wallet not connected");
  const walletSigned = await peraWallet.signTransaction([signerTxns], account);
  const walletCount = signerTxns.length - Object.keys(presigned).length;
  if (!walletSigned?.length || walletSigned.length !== walletCount) {
    throw new Error("Wallet returned an unexpected number of signed transactions");
  }
  let next = 0;
  const signed = signerTxns.map((_, index) => presigned[index] ?? walletSigned[next++]);
  const response = await algodClient.sendRawTransaction(signed).do();
  const txId = response.txId ?? response.txid ?? signerTxns.at(-1).txn.txID().toString();
  const confirmation = await waitForConfirmation(algodClient, txId, maxRounds);
  return { txId, confirmation, signed };
}

// Tinyman lists the pool LogicSig address as the signer of its own transactions
// (the SDK signs those itself afterwards). Pera Connect expects a wallet
// signature for every transaction with a non-empty signers list, so those
// entries are sent with an empty list: the wallet is asked only for the
// connected account's transactions, and the SDK reads those signatures back.
async function tinymanSigner(txGroups) {
  const { account } = state;
  if (!account) throw new Error("Wallet not connected");
  const walletOnly = txGroups.map((group) => group.map((entry) => (
    entry.signers?.includes(account) ? entry : { ...entry, signers: [] }
  )));
  return peraWallet.signTransaction(walletOnly, account);
}

export function usePeraWallet() {
  const { account, isConnecting, connectionError } = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(reconnectOnce, []);
  const stableConnect = useCallback(connect, []);
  const stableDisconnect = useCallback(disconnect, []);
  return {
    account,
    isConnecting,
    connectionError,
    connect: stableConnect,
    disconnect: stableDisconnect,
    signAndSend,
    signAndSubmit,
    tinymanSigner,
  };
}

export async function waitForConfirmation(algodClient, txId, rounds = 12) {
  const status = await algodClient.status().do();
  let lastRound = Number(status.lastRound ?? status["last-round"]);
  for (let remaining = Number(rounds); remaining > 0; remaining -= 1) {
    const pending = await algodClient.pendingTransactionInformation(txId).do();
    const confirmedRound = Number(pending.confirmedRound ?? pending["confirmed-round"] ?? 0);
    if (confirmedRound > 0) {
      return pending;
    }
    const poolError = pending.poolError ?? pending["pool-error"];
    if (poolError) {
      throw new Error(`Pool error: ${poolError}`);
    }
    lastRound += 1;
    await algodClient.statusAfterBlock(lastRound).do();
  }
  throw new Error(`Transaction ${txId} was not confirmed within ${rounds} rounds`);
}
