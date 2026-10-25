import test from "node:test";
import assert from "node:assert/strict";
import { vestigeAssetUrl, vestigeManagerUrl } from "../src/launchpad/links.js";

test("the Vestige manager link is the token's asset-manager page, built only from a numeric asset id", () => {
  assert.equal(vestigeManagerUrl(3753721447n), "https://vestige.fi/asset-manager/3753721447");
  assert.throws(() => vestigeManagerUrl("1/../../evil"), SyntaxError);
});

test("the Vestige link is the token's own page, built only from a numeric asset id", () => {
  assert.equal(vestigeAssetUrl(3753721447n), "https://vestige.fi/asset/3753721447");
  assert.equal(vestigeAssetUrl("3753721447"), "https://vestige.fi/asset/3753721447");
  assert.throws(() => vestigeAssetUrl("1/../../evil"), SyntaxError);
});