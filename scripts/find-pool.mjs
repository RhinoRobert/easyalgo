// Find the Tinyman v2 ALGO/<asset> pool on a network and print its address, status and reserves (read-only: no key, no transaction).
//
//   node scripts/find-pool.mjs testnet 764815173
//   node scripts/find-pool.mjs mainnet 3169177585
//
// The printed pool address is what VITE_TINYMAN_SOURCE_POOL / LAUNCHPAD_V3_SOURCE_POOL expect, and the asset is VITE_LAUNCHPAD_PNET_ID.
import algosdk from "algosdk";
import { poolUtils, tinymanJSSDKConfig } from "@tinymanorg/tinyman-js-sdk";

const [network, assetArg] = process.argv.slice(2);
const urls = { testnet: "https://testnet-api.algonode.cloud", mainnet: "https://mainnet-api.algonode.cloud" };
if (!urls[network] || !/^\d+$/.test(assetArg || "")) {
  console.error("usage: node scripts/find-pool.mjs <testnet|mainnet> <asset id>");
  process.exit(2);
}
tinymanJSSDKConfig.setClientName("pnetlauncher-find-pool");
const client = new algosdk.Algodv2("", urls[network], 443);
const asset = Number(assetArg);

const info = await poolUtils.v2.getPoolInfo({ client, network, asset1ID: asset, asset2ID: 0 });
console.log(`network ${network}, asset ${asset} / ALGO`);
const poolAddress = (info.account && typeof info.account.address === "function" ? info.account.address() : info.account?.address)?.toString();
console.log(`pool address : ${poolAddress ?? "(none)"}`);
console.log(`pool status  : ${info.status}`);
if (poolAddress && info.status && info.status !== "NOT_CREATED") {
  const address = poolAddress;
  const acct = await client.accountInformation(address).do();
  const state = Object.fromEntries(
    (acct.appsLocalState ?? []).filter((e) => BigInt(e.id) === BigInt(info.validatorAppID)).flatMap((e) =>
      (e.keyValue ?? []).map((kv) => [Buffer.from(kv.key).toString(), kv.value.uint])),
  );
  console.log(`asset_1 / asset_2 : ${state.asset_1_id} / ${state.asset_2_id}`);
  console.log(`reserves          : ${state.asset_1_reserves} (asset 1) / ${state.asset_2_reserves} (ALGO, microALGO)`);
  console.log(`LP asset          : ${state.pool_token_asset_id}`);
}
