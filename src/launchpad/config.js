import algosdk from "algosdk";

// Vite injects import.meta.env in the browser.  Node's test runner does not,
// so keep configuration importable in both environments without weakening any
// of the MainNet gates below.
const env = import.meta.env ?? {};

export const PLATFORM_WALLET = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E";
export const LEGACY_MAINNET_APP_ID = 3_609_729_732;
// v2 (2026-10-24) can never finalize a launch (contract defect); it must never be configured again.
export const BROKEN_V2_MAINNET_APP_ID = 3_753_482_671;
export const EXACT_ALGO_INPUT = 1_000_000n;
// Mirrors contracts/launchpad_v3/contract.py (a test reads both and compares them).
export const INITIALIZE_FUNDING = 500_000n;
export const PENDING_BOX_MBR = 66_900n;
export const LAUNCH_START_FUNDING = 1_359_600n;
export const LP_HOLDING_MBR = 100_000n;
export const ARC54_LP_HOLDING_MBR = 100_000n;
export const VESTIGE_FUNDING = 100_000n;
export const CANCEL_DELAY_ROUNDS = 3_000;
export const SAFETY_RESERVE = 250_000n;
// The contract accepts a quote up to 60 rounds old; the app refreshes its own quote well inside that.
export const QUOTE_MAX_ROUNDS = 40;
export const QUOTE_MAX_AGE_MS = 110_000;
export const MAINNET_ENABLE_PHRASE = "I_ACCEPT_CONTROLLED_MAINNET_CANARY";

const envBigInt = (name, fallback = 0n) => {
  const raw = env[name];
  return raw ? BigInt(raw) : fallback;
};

export const NETWORKS = {
  localnet: {
    label: "LocalNet",
    algod: { server: env.VITE_LOCALNET_ALGOD || "http://localhost", port: Number(env.VITE_LOCALNET_ALGOD_PORT || 4001), token: env.VITE_LOCALNET_ALGOD_TOKEN || "a".repeat(64) },
    indexer: { server: env.VITE_LOCALNET_INDEXER || "http://localhost", port: Number(env.VITE_LOCALNET_INDEXER_PORT || 8980), token: env.VITE_LOCALNET_INDEXER_TOKEN || "a".repeat(64) },
    launchpadAppId: envBigInt("VITE_LAUNCHPAD_APP_ID"),
    pnetAssetId: envBigInt("VITE_LAUNCHPAD_PNET_ID"),
    tinymanAppId: envBigInt("VITE_TINYMAN_V2_APP_ID"),
    vestigeAppId: envBigInt("VITE_VESTIGE_APP_ID"),
    arc54AppId: envBigInt("VITE_ARC54_APP_ID"),
    sourcePool: env.VITE_TINYMAN_SOURCE_POOL || "",
    arc54Address: env.VITE_ARC54_ADDRESS || "",
    tinymanNetwork: "testnet",
  },
  testnet: {
    label: "TestNet",
    algod: { server: "https://testnet-api.algonode.cloud", port: 443, token: "" },
    indexer: { server: "https://testnet-idx.algonode.cloud", port: 443, token: "" },
    launchpadAppId: envBigInt("VITE_LAUNCHPAD_APP_ID"),
    pnetAssetId: envBigInt("VITE_LAUNCHPAD_PNET_ID"),
    tinymanAppId: 148_607_000n,
    vestigeAppId: 743_122_411n,
    arc54AppId: 497_806_551n,
    sourcePool: env.VITE_TINYMAN_SOURCE_POOL || "",
    arc54Address: "3TKF2GMZJ5VZ4BQVQGC72BJ63WFN4QBPU2EUD4NQYHFLC3NE5D7GXHXYOQ",
    tinymanNetwork: "testnet",
  },
  mainnet: {
    label: "MainNet",
    algod: { server: "https://mainnet-api.algonode.cloud", port: 443, token: "" },
    indexer: { server: "https://mainnet-idx.algonode.cloud", port: 443, token: "" },
    launchpadAppId: envBigInt("VITE_LAUNCHPAD_APP_ID"),
    pnetAssetId: 3_169_177_585n,
    tinymanAppId: 1_002_541_853n,
    vestigeAppId: 3_129_810_607n,
    arc54AppId: 1_257_620_981n,
    sourcePool: "ANESQRCMZ5KWZFKDGESLJEWQLRCVUZU725FJL7NO3BMKJEYMAB3TR56R3E",
    sourcePoolLpAssetId: 3_169_269_012n,
    arc54Address: "BNFIREKGRXEHCFOEQLTX3PU5SUCMRKDU7WHNBGZA4SXPW42OAHZBP7BPHY",
    tinymanNetwork: "mainnet",
  },
};

export const launchNetworkName = ["localnet", "testnet", "mainnet"].includes(env.VITE_NETWORK)
  ? env.VITE_NETWORK
  : "testnet";
export const launchNetwork = NETWORKS[launchNetworkName];

if (!algosdk.isValidAddress(PLATFORM_WALLET)) throw new Error("Invalid platform wallet configuration");
if (launchNetworkName === "mainnet"
    && [BigInt(LEGACY_MAINNET_APP_ID), BigInt(BROKEN_V2_MAINNET_APP_ID)].includes(launchNetwork.launchpadAppId)) {
  throw new Error("The launchpad must never target the legacy MainNet App 3609729732 or the unfinishable v2 App 3753482671");
}

export function configurationIssues(config = launchNetwork) {
  const issues = [];
  if (config.launchpadAppId === 0n) issues.push("VITE_LAUNCHPAD_APP_ID is not configured");
  if (config.pnetAssetId === 0n) issues.push("VITE_LAUNCHPAD_PNET_ID is not configured");
  if (config.tinymanAppId === 0n) issues.push("Tinyman v2 app is not configured");
  if (config.vestigeAppId === 0n) issues.push("Vestige app is not configured");
  if (config.arc54AppId === 0n) issues.push("ARC-54 app is not configured");
  if (!algosdk.isValidAddress(config.sourcePool || "")) issues.push("Tinyman ALGO/PNET source pool is not configured");
  if (!algosdk.isValidAddress(config.arc54Address || "")) issues.push("ARC-54 address is not configured");
  if (launchNetworkName === "mainnet" && env.VITE_ENABLE_MAINNET_LAUNCHPAD !== MAINNET_ENABLE_PHRASE) {
    issues.push("MainNet launch signing is disabled until the controlled-canary gate is enabled");
  }
  return issues;
}

export function arc54Address(config = launchNetwork) {
  return algosdk.getApplicationAddress(Number(config.arc54AppId));
}

