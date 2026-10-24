import { useMemo } from "react";
import algosdk from "algosdk";
import { launchNetwork, launchNetworkName } from "../launchpad/config";

const TESTNET = {
  algod:   { server: "https://testnet-api.algonode.cloud", port: 443, token: "" },
  indexer: { server: "https://testnet-idx.algonode.cloud", port: 443, token: "" },
};
const MAINNET = {
  algod:   { server: "https://mainnet-api.algonode.cloud", port: 443, token: "" },
  indexer: { server: "https://mainnet-idx.algonode.cloud", port: 443, token: "" },
};
const NET = launchNetworkName === "localnet" ? launchNetwork : import.meta.env.VITE_NETWORK === "mainnet" ? MAINNET : TESTNET;
export const IS_MAINNET = launchNetworkName === "mainnet";
export const NETWORK_LABEL = launchNetwork.label;

export function explorerTxUrl(txId) {
  const base = IS_MAINNET
    ? "https://explorer.perawallet.app/tx/"
    : "https://testnet.explorer.perawallet.app/tx/";
  return base + txId;
}
export function explorerAddrUrl(addr) {
  const base = IS_MAINNET
    ? "https://explorer.perawallet.app/address/"
    : "https://testnet.explorer.perawallet.app/address/";
  return base + addr;
}
export function explorerAssetUrl(assetId) {
  const base = IS_MAINNET
    ? "https://explorer.perawallet.app/asset/"
    : "https://testnet.explorer.perawallet.app/asset/";
  return base + assetId;
}
export function explorerAppUrl(appId) {
  const base = IS_MAINNET
    ? "https://explorer.perawallet.app/application/"
    : "https://testnet.explorer.perawallet.app/application/";
  return base + appId;
}

export const PLATFORM_WALLET = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E";
// Fail fast at module load — if this address is ever typo'd during a wallet rotation, every fee txn would fail
if (!algosdk.isValidAddress(PLATFORM_WALLET)) throw new Error("PLATFORM_WALLET address is invalid");

export const MAINNET_IDX = "https://mainnet-idx.algonode.cloud";

// Fee model: user pays COGS (actual Algorand cost) + platform takes 50% of COGS on top
// Total = COGS * 1.5

// Campaign listing: COGS = 0.5 ALGO (contract opt-in MBR + tx fees)
export const LISTING_COGS           = 500_000;
export const LISTING_PLATFORM       = Math.round(LISTING_COGS * 0.5);          // 0.25 ALGO
export const LISTING_FEE_MICROALGO  = LISTING_COGS + LISTING_PLATFORM;         // 0.75 ALGO total

// Token Launchpad: COGS = 0.1 ALGO (ASA creation MBR)
export const MINT_COGS              = 100_000;
export const MINT_PLATFORM          = Math.round(MINT_COGS * 0.5);             // 0.05 ALGO
export const MINT_FEE_MICROALGO     = MINT_COGS + MINT_PLATFORM;               // 0.15 ALGO total

// MultiSender: COGS = per-txn network fees (calculated at runtime)
export const MULTISEND_FEE_PER_TXN  = 1_000;  // 0.001 ALGO per txn (Algorand base fee)

// AlgoSocial: COGS = 0.001 ALGO (single tx network fee)
export const SOCIAL_COGS            = 1_000;
export const SOCIAL_PLATFORM        = Math.round(SOCIAL_COGS * 0.5);           // 500 microALGO
export const SOCIAL_TOTAL           = SOCIAL_COGS + SOCIAL_PLATFORM;           // 0.0015 ALGO total

// Legacy alias
export const COGS_MICROALGO         = LISTING_COGS;
export const PLATFORM_FEE_MICROALGO = LISTING_PLATFORM;

export const PNET_ASSET_ID = 3169177585;
export const PNET_DECIMALS = 6;

export function getPnetTier(rawBalance) {
  const pnet = rawBalance / 10 ** PNET_DECIMALS;
  if (pnet >= 100_000) return { tier: 4, label: "Diamond", discount: 0.75, color: "#60A5FA", emoji: "💎" };
  if (pnet >= 10_000)  return { tier: 3, label: "Gold",    discount: 0.50, color: "#FBBF24", emoji: "🥇" };
  if (pnet >= 1_000)   return { tier: 2, label: "Silver",  discount: 0.25, color: "#94A3B8", emoji: "🥈" };
  if (pnet >= 100)     return { tier: 1, label: "Bronze",  discount: 0.10, color: "#D97706", emoji: "🥉" };
  return { tier: 0, label: null, discount: 0, color: null, emoji: null };
}

export function useAlgorand() {
  const algodClient = useMemo(
    () => new algosdk.Algodv2(NET.algod.token, NET.algod.server, NET.algod.port),
    []
  );
  const indexerClient = useMemo(
    () => new algosdk.Indexer(NET.indexer.token, NET.indexer.server, NET.indexer.port),
    []
  );
  return { algodClient, indexerClient };
}

export async function getCampaignStatus(algodClient, appId) {
  const app = await algodClient.getApplicationByID(appId).do();
  const state = {};
  for (const kv of app.params["global-state"]) {
    const key = atob(kv.key);
    if (kv.value.type === 1) {
      const raw = Uint8Array.from(atob(kv.value.bytes), (c) => c.charCodeAt(0));
      // Keep raw bytes for address fields; decode everything else as text
      state[key] = key === "creator" ? raw : new TextDecoder().decode(raw);
    } else {
      state[key] = kv.value.uint;
    }
  }
  return {
    title:       state["title"]       ?? "",
    description: state["description"] ?? "",
    goal:        state["goal"]        ?? 0,
    raised:      state["raised"]      ?? 0,
    deadline:    state["deadline"]    ?? 0,
    withdrawn:   !!state["withdrawn"],
    cancelled:   !!state["cancelled"],
    creator:     state["creator"] instanceof Uint8Array
      ? algosdk.encodeAddress(state["creator"])
      : "",
    appAddress: algosdk.getApplicationAddress(appId),
  };
}

function getSelector(signature) {
  return algosdk.ABIMethod.fromSignature(signature).getSelector();
}

function pinnedSp(sp) {
  // Pin fee to 1000 microALGO flat — prevents fee manipulation from a compromised node
  return { ...sp, fee: 1000, flatFee: true };
}

export async function buildDonateTxns(algodClient, appId, senderAddr, microAlgoAmount) {
  const sp      = pinnedSp(await algodClient.getTransactionParams().do());
  const appAddr = algosdk.getApplicationAddress(appId);

  const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: senderAddr, to: appAddr, amount: microAlgoAmount, suggestedParams: sp,
  });
  const callTxn = algosdk.makeApplicationCallTxnFromObject({
    from: senderAddr, appIndex: appId,
    onCompletion: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [getSelector("donate(pay)void")],
    suggestedParams: sp,
  });

  algosdk.assignGroupID([payTxn, callTxn]);
  return [payTxn, callTxn];
}

export async function buildOptInTxn(algodClient, appId, senderAddr) {
  const sp = pinnedSp(await algodClient.getTransactionParams().do());
  return algosdk.makeApplicationOptInTxnFromObject({
    from: senderAddr, appIndex: appId, suggestedParams: sp,
  });
}

export async function buildListingFeeTxn(algodClient, senderAddr) {
  const sp = pinnedSp(await algodClient.getTransactionParams().do());
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from:   senderAddr,
    to:     PLATFORM_WALLET,
    amount: LISTING_FEE_MICROALGO,
    note:   new TextEncoder().encode("ConservationFund platform listing"),
    suggestedParams: sp,
  });
}

export async function verifyCampaignApp(algodClient, appId) {
  let app;
  try {
    app = await algodClient.getApplicationByID(appId).do();
  } catch {
    throw new Error("App not found on this network");
  }
  const keys     = (app.params["global-state"] || []).map((kv) => atob(kv.key));
  const required = ["creator", "title", "goal", "deadline", "raised"];
  if (!required.every((k) => keys.includes(k))) {
    throw new Error("This App ID is not a ConservationFund contract");
  }
  return getCampaignStatus(algodClient, appId);
}

