import algosdk from "algosdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { PLATFORM_WALLET } from "./config.js";
import { TRUSTED_LAUNCHPAD_BUILD } from "./deploymentTrust.js";

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new Uint8Array(value || []);
}

function hex(value) {
  return [...sha256(bytes(value))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function globalState(params) {
  const result = {};
  for (const item of params.globalState ?? params["global-state"] ?? []) {
    const key = new TextDecoder().decode(bytes(item.key));
    const value = item.value;
    result[key] = Number(value.type) === 2 ? BigInt(value.uint) : bytes(value.bytes);
  }
  return result;
}

function schemaValue(schema, camel, raw) {
  return Number(schema?.[camel] ?? schema?.[raw] ?? -1);
}

function equalBytes(left, right) {
  return left?.length === right?.length && left.every((value, index) => value === right[index]);
}

export async function attestLaunchpadApplication(algodClient, config) {
  const app = await algodClient.getApplicationByID(Number(config.launchpadAppId)).do();
  const params = app.params;
  if (params.creator?.toString() !== PLATFORM_WALLET) throw new Error("Launchpad App ID was not created by the platform authority");
  if (hex(params.approvalProgram ?? params["approval-program"])
      !== TRUSTED_LAUNCHPAD_BUILD.approvalBytecodeSha256
      || hex(params.clearStateProgram ?? params["clear-state-program"])
      !== TRUSTED_LAUNCHPAD_BUILD.clearBytecodeSha256) {
    throw new Error("Launchpad App ID bytecode does not match the reviewed build");
  }
  const globalSchema = params.globalStateSchema ?? params["global-state-schema"];
  const localSchema = params.localStateSchema ?? params["local-state-schema"];
  if (schemaValue(globalSchema, "numUint", "num-uint") !== TRUSTED_LAUNCHPAD_BUILD.globalInts
      || schemaValue(globalSchema, "numByteSlice", "num-byte-slice") !== TRUSTED_LAUNCHPAD_BUILD.globalBytes
      || schemaValue(localSchema, "numUint", "num-uint") !== TRUSTED_LAUNCHPAD_BUILD.localInts
      || schemaValue(localSchema, "numByteSlice", "num-byte-slice") !== TRUSTED_LAUNCHPAD_BUILD.localBytes
      || Number(params.extraProgramPages ?? params["extra-program-pages"] ?? 0)
        !== TRUSTED_LAUNCHPAD_BUILD.extraPages) {
    throw new Error("Launchpad App ID schema differs from the reviewed build");
  }
  const state = globalState(params);
  const uint = (key) => BigInt(state[key] ?? -1);
  if (uint("init") !== 1n
      || uint("pnet") !== BigInt(config.pnetAssetId)
      || uint("tinyman") !== BigInt(config.tinymanAppId)
      || uint("vestige") !== BigInt(config.vestigeAppId)
      || uint("arc54") !== BigInt(config.arc54AppId)
      || !equalBytes(state.source, algosdk.decodeAddress(config.sourcePool).publicKey)
      || !equalBytes(state.burn, algosdk.decodeAddress(config.arc54Address).publicKey)) {
    throw new Error("Launchpad App ID is uninitialized or has untrusted protocol configuration");
  }
  return {
    appId: BigInt(config.launchpadAppId),
    creator: params.creator.toString(),
    approvalSha256: TRUSTED_LAUNCHPAD_BUILD.approvalBytecodeSha256,
  };
}
