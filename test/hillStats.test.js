import test from "node:test";
import assert from "node:assert/strict";
import { countPendingBoxNames } from "../src/launchpad/directory.js";

const name = (prefix, length) => Uint8Array.from([prefix.charCodeAt(0), ...new Array(length - 1).fill(7)]);

test("tokens still waiting for their second approval are counted from the contract's box names", () => {
  const names = [name("p", 33), name("p", 33), name("l", 9), name("i", 9), name("a", 9), name("p", 9) /* not a wallet key */];
  assert.equal(countPendingBoxNames(names), 2);
  assert.equal(countPendingBoxNames([]), 0);
});