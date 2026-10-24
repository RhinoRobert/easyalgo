import { sha256 } from "@noble/hashes/sha2.js";

// Tinyman 5.1.4 uses exactly one Node crypto primitive in its browser bundle:
// createHash("sha256").update(Uint8Array).digest() when deriving a CID.  Keep
// the compatibility surface deliberately narrow instead of restoring a broad
// Node polyfill bundle to the production application.
export function createHash(algorithm) {
  if (String(algorithm).toLowerCase() !== "sha256") {
    throw new Error(`Unsupported browser hash algorithm: ${algorithm}`);
  }
  const hash = sha256.create();
  return {
    update(value) {
      hash.update(value instanceof Uint8Array ? value : new TextEncoder().encode(String(value)));
      return this;
    },
    digest() {
      return hash.digest();
    },
  };
}

export default { createHash };
