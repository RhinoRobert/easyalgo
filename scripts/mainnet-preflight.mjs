// Read-only MainNet readiness check for deploying PNET Instant Launchpad v3. It signs nothing and sends nothing: it reads public chain state and
// tells you the next action. Re-run it after each step.
//
//   npm run preflight:mainnet
import { createHash } from "node:crypto";
import algosdk from "algosdk";
import { readPool } from "../src/launchpad/tinymanAdapter.js";
import { NETWORKS, PLATFORM_WALLET, INITIALIZE_FUNDING } from "../src/launchpad/config.js";
import { TRUSTED_LAUNCHPAD_BUILD as BUILD } from "../src/launchpad/deploymentTrust.js";

const main = NETWORKS.mainnet;
const client = new algosdk.Algodv2("", "https://mainnet-api.algonode.cloud", 443);
const algo = (micro) => `${(Number(micro) / 1e6).toFixed(6)} ALGO`;
const mark = (ok) => (ok ? "✔" : "✖");
const sha256hex = (b64) => createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");

// What the deployment costs the platform authority, from the contract's own numbers (docs/CONTRACT_DEPLOYMENT_READINESS.md).
const APP_CREATE_MBR = 100_000n + 28_500n * BigInt(BUILD.globalInts) + 50_000n * BigInt(BUILD.globalBytes) + 100_000n * BigInt(BUILD.extraPages);
const OPT_IN_MBR = 100_000n;
const FEES = { optIn: 1_000n, create: 1_000n, initialize: 3_000n };

const acct = await client.accountInformation(PLATFORM_WALLET).do();
const balance = BigInt(acct.amount);
const minBalance = BigInt(acct.minBalance);
const spendable = balance - minBalance;
const holdsPnet = (acct.assets ?? []).some((a) => BigInt(a.assetId) === main.pnetAssetId);

// Has the reviewed contract already been created by this account? (compare the on-chain approval program with the trusted build hash)
let existing = [];
for (const app of acct.createdApps ?? []) {
  const params = app.params;
  const approval = Buffer.from(params.approvalProgram).toString("base64");
  if (sha256hex(approval) === BUILD.approvalBytecodeSha256) existing.push(Number(app.id));
}

console.log("PNET Instant Launchpad v3: MainNet readiness (read-only)\n");
console.log(`platform authority   ${PLATFORM_WALLET}`);
console.log(`  balance            ${algo(balance)}   minimum ${algo(minBalance)}   spendable ${algo(spendable)}`);
console.log(`  opted in to PNET   ${mark(holdsPnet)} (asset ${main.pnetAssetId})`);
console.log(`  reviewed contract already created by it: ${existing.length ? "YES, app " + existing.join(", ") : "no"}\n`);

let protocolOk = true;
for (const [label, id] of [["Tinyman v2 validator", main.tinymanAppId], ["Vestige", main.vestigeAppId], ["ARC-54", main.arc54AppId], ["legacy launchpad (must stay untouched)", BigInt(3_609_729_732)], ["unfinishable v2 launchpad (never use)", BigInt(3_753_482_671)]]) {
  try { await client.getApplicationByID(Number(id)).do(); console.log(`  ${mark(true)} ${label} ${id}`); }
  catch { protocolOk = false; console.log(`  ${mark(false)} ${label} ${id} NOT FOUND`); }
}
try { await client.getAssetByID(Number(main.pnetAssetId)).do(); console.log(`  ${mark(true)} PNET asset ${main.pnetAssetId}`); } catch { protocolOk = false; console.log(`  ${mark(false)} PNET asset not found`); }
const pool = await readPool({ algodClient: client, validatorAppId: main.tinymanAppId, assetA: main.pnetAssetId, assetB: 0n });
const poolOk = pool.address === main.sourcePool && pool.exists;
console.log(`  ${mark(poolOk)} pinned PNET/ALGO source pool ${pool.address} (${pool.exists ? "ready" : "not created"})\n`);

// What is still to be paid, by step.
const steps = [];
if (!holdsPnet) steps.push(["1. opt the authority in to PNET", OPT_IN_MBR + FEES.optIn, "0.1 ALGO stays as the PNET holding minimum balance"]);
if (!existing.length) {
  steps.push(["2. create the application", APP_CREATE_MBR + FEES.create, `minimum balance for ${BUILD.globalInts} uints, ${BUILD.globalBytes} byte slices and ${BUILD.extraPages} extra pages, locked for good (no delete route)`]);
  steps.push(["3. initialize it (pay the app)", INITIALIZE_FUNDING + FEES.initialize, "0.5 ALGO goes INTO the contract: its PNET holding minimum balance and a 0.3 ALGO safety cushion (no withdrawal route)"]);
}
const needed = steps.reduce((sum, s) => sum + s[1], 0n);
console.log("still to pay from the authority's spendable ALGO:");
for (const [name, cost, note] of steps) console.log(`  ${name.padEnd(36)} ${algo(cost).padStart(15)}   ${note}`);
console.log(`  ${"TOTAL".padEnd(36)} ${algo(needed).padStart(15)}`);
const shortfall = needed > spendable ? needed - spendable : 0n;
console.log(`  spendable now ${algo(spendable)} -> ${shortfall ? "SEND AT LEAST " + algo(shortfall) + " (about " + algo(shortfall + 500_000n) + " leaves a fee buffer)" : "enough"}\n`);

let next;
if (!protocolOk || !poolOk) next = "A pinned MainNet dependency is missing or the source pool is not ready: do NOT deploy. Re-check before anything else.";
else if (existing.length) next = `The reviewed contract already exists (app ${existing[0]}). Do not deploy another: run prepare-initialize / verify-record for it, or set VITE_LAUNCHPAD_APP_ID=${existing[0]}.`;
else if (shortfall) next = `Step A: send at least ${algo(shortfall)} to ${PLATFORM_WALLET}.`;
else if (!holdsPnet) next = "Step B: in Pera, with the authority account, add asset 3169177585 (PNET).";
else next = "Ready. Run: python -m launchpad_v3.deploy prepare-create mainnet <authority> (with the two MainNet confirmation variables set), then sign it in the app's deployment console.";
console.log(`NEXT: ${next}`);
