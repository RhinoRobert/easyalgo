import test from "node:test";
import assert from "node:assert/strict";
import { countLaunched } from "../src/launchpad/directory.js";

const item = (status) => ({ status });

test("the headline counts tokens that fully launched: cancelled launches are not included", () => {
  assert.equal(countLaunched(3n, [item(2n), item(2n), item(3n)]), 2n);
  assert.equal(countLaunched(2, [item(2n), item(2n)]), 2n);
  assert.equal(countLaunched(0n, []), 0n);
  assert.equal(countLaunched(1n, [item(3n)]), 0n);
  assert.equal(countLaunched(1n, [item(3n), item(3n)]), 0n, "never negative");
});
