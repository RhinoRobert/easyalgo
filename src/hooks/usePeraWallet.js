import { useState, useEffect, useCallback } from "react";
import { PeraWalletConnect } from "@perawallet/connect";

const IS_MAINNET = import.meta.env.VITE_NETWORK === "mainnet";

const peraWallet = new PeraWalletConnect({
  shouldShowSignTxnToast: true,
  chainId: IS_MAINNET ? 416001 : 416002,
});

export function usePeraWallet() {
  const [account, setAccount] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  // Reconnect on page reload if session exists
  useEffect(() => {
    peraWallet.reconnectSession().then((accounts) => {
      if (accounts.length) {
        setAccount(accounts[0]);
        peraWallet.connector?.on("disconnect", disconnect);
      }
    });
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError("");
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out — open Pera Wallet and try again")), 20000)
      );
      const accounts = await Promise.race([peraWallet.connect(), timeout]);
      setAccount(accounts[0]);
      peraWallet.connector?.on("disconnect", disconnect);
      return accounts[0];
    } catch (err) {
      if (err?.data?.type !== "CONNECT_MODAL_CLOSED") {
        console.error("Pera connect error:", err);
      }
      setConnectionError(
        err?.data?.type === "CONNECT_MODAL_CLOSED"
          ? "Pera connection was canceled."
          : err?.message || "Pera Wallet could not connect. Try again."
      );
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    peraWallet.disconnect();
    setAccount(null);
    setConnectionError("");
  }, []);

  const signAndSend = useCallback(
    async (algodClient, txns) => {
      if (!account) throw new Error("Wallet not connected");

      // Each txn wrapped for Pera: { txn, signers }
      const txnsToSign = txns.map((txn) => ({ txn, signers: [account] }));

      const signedTxns = await peraWallet.signTransaction([txnsToSign]);
      const { txId } = await algodClient.sendRawTransaction(signedTxns).do();

      // Wait for confirmation
      await waitForConfirmation(algodClient, txId, 12);
      return txId;
    },
    [account]
  );

  const signAndSubmit = useCallback(
    async (algodClient, signerTxns, maxRounds = 12) => {
      if (!account) throw new Error("Wallet not connected");
      const signed = await peraWallet.signTransaction([signerTxns], account);
      if (!signed?.length) throw new Error("Wallet returned no signed transactions");
      const response = await algodClient.sendRawTransaction(signed).do();
      const txId = response.txId ?? response.txid ?? signerTxns[0].txn.txID().toString();
      const confirmation = await waitForConfirmation(algodClient, txId, maxRounds);
      return { txId, confirmation, signed };
    },
    [account]
  );

  // Tinyman supplies LogicSig/pre-signed transactions alongside wallet-owned
  // transactions. Pera honors each SignerTransaction.signers list, so it signs
  // only the connected account's entries and leaves protocol signatures alone.
  const tinymanSigner = useCallback(
    async (txGroups) => {
      if (!account) throw new Error("Wallet not connected");
      return peraWallet.signTransaction(txGroups, account);
    },
    [account]
  );

  return {
    account,
    isConnecting,
    connectionError,
    connect,
    disconnect,
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
