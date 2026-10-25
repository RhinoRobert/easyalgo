// Read-only: confirms a deployed launchpad application is the reviewed build. Compares the on-chain programs, schema,
// creator and pinned configuration with the hashes bundled in src/launchpad/deploymentTrust.js (the same check the app runs).
//
//   node scripts/verify-deployed.mjs            # MainNet app from deployment record: 3753531793
//   node scripts/verify-deployed.mjs 123456     # another app id
import algosdk from "algosdk";
import { NETWORKS } from "../src/launchpad/config.js";
import { attestLaunchpadApplication } from "../src/launchpad/attestation.js";

const appId = BigInt(process.argv[2] ?? "3753531793");
const algod = new algosdk.Algodv2("", "https://mainnet-api.algonode.cloud", 443);
const config = { ...NETWORKS.mainnet, launchpadAppId: appId };
try {
  const result = await attestLaunchpadApplication(algod, config);
  console.log(`OK  app ${appId} matches the reviewed build`);
  console.log(`    creator  ${result.creator}`);
  console.log(`    approval ${result.approvalSha256}`);
} catch (error) {
  console.error(`FAIL  app ${appId}: ${error.message}`);
  process.exitCode = 1;
}