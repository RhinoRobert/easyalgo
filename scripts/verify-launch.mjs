// Read-only: shows where every liquidity token of a finished launch went, straight from the chain, and whether 80% really sits in the ARC-54 burn account.
//
//   npm run verify:launch -- <asset id>        e.g.  npm run verify:launch -- 3753533790
import algosdk from "algosdk";
import { NETWORKS } from "../src/launchpad/config.js";
import { LAUNCH_TYPE, decodeLaunch, launchBoxName, readBox } from "../src/launchpad/launchpadClient.js";
import { formatUnits } from "../src/launchpad/amounts.js";
import { readTinymanPoolState } from "../src/launchpad/tinymanAdapter.js";

const assetId = BigInt(process.argv[2] ?? "");
const appId = BigInt(process.argv[3] ?? "3753531793");
const algod = new algosdk.Algodv2("", "https://mainnet-api.algonode.cloud", 443);
const config = { ...NETWORKS.mainnet, launchpadAppId: appId };
const appAddress = algosdk.getApplicationAddress(Number(appId)).toString();
const burnAddress = algosdk.getApplicationAddress(Number(config.arc54AppId)).toString();

const record = decodeLaunch(await readBox(algod, appId, launchBoxName(assetId), LAUNCH_TYPE));
if (!record) { console.error(`No launch record for asset ${assetId} in app ${appId}`); process.exitCode = 1; }
else if (record.status !== 2n) { console.error(`Asset ${assetId} is not a finished launch (status ${record.status})`); process.exitCode = 1; }
else {
  const holding = async (address, id) => {
    const info = await algod.accountInformation(address).do();
    return BigInt((info.assets ?? []).find((a) => BigInt(a.assetId) === BigInt(id))?.amount ?? 0n);
  };
  const pool = await readTinymanPoolState({ algodClient: algod, poolAddress: record.poolAddress, tinymanAppId: config.tinymanAppId });
  const lp = record.lpAssetId;
  const atBurn = await holding(burnAddress, lp);
  const atApp = await holding(appAddress, lp);
  const received = pool.issuedPoolTokens - 1_000n;
  const pct = (part) => `${(Number(part * 100_000n / received) / 1000).toFixed(3)}%`;
  console.log(`Launch of asset ${assetId}  (LP token ${lp}, pool ${record.poolAddress})`);
  console.log(`  liquidity tokens issued by the pool (minus 1,000 Tinyman keeps for good): ${formatUnits(received)}`);
  console.log(`  at the ARC-54 burn account ${burnAddress}`);
  console.log(`      holds ${formatUnits(atBurn)}  = ${pct(atBurn)}   (the contract recorded ${formatUnits(record.burnedLp)})`);
  console.log(`  creator's 10%: recorded ${formatUnits(record.creatorLp)} (${record.creatorLpClaimed === 1n ? "claimed" : "still held by the launchpad"})`);
  console.log(`  platform's 10%: recorded ${formatUnits(record.platformLp)}`);
  console.log(`  held by the launchpad app right now: ${formatUnits(atApp)}`);
  const ok = atBurn === record.burnedLp && record.burnedLp * 100n >= received * 79n && record.burnedLp * 100n <= received * 81n
    && record.burnedLp + record.creatorLp + record.platformLp === received;
  console.log(ok ? "\nOK  80% (to rounding) is in the ARC-54 burn account and the three parts add up exactly." : "\nMISMATCH: investigate before trusting this launch.");
  process.exitCode = ok ? 0 : 1;
}
