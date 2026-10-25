// The Cloudflare setup guide must show exactly the headers deploy/security-headers.json declares.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(new URL("../deploy/security-headers.json", import.meta.url), "utf8"));
const guide = readFileSync(new URL("../docs/CLOUDFLARE_SETUP.md", import.meta.url), "utf8");

test("every directive of the CSP appears in the setup guide", () => {
  for (const directive of spec.contentSecurityPolicy.split(";").map((part) => part.trim())) {
    assert.ok(guide.includes(directive), `docs/CLOUDFLARE_SETUP.md is missing the directive: ${directive}`);
  }
});

test("every static header value appears in the setup guide", () => {
  for (const [name, value] of Object.entries(spec.headers)) {
    assert.ok(guide.includes(`\`${name}\``) && guide.includes(value), `docs/CLOUDFLARE_SETUP.md is missing ${name}: ${value}`);
  }
});

test("the policy is strict where it matters", () => {
  const csp = spec.contentSecurityPolicy;
  const directive = (name) => csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";
  assert.equal(directive("default-src"), "default-src 'none'");
  assert.equal(directive("script-src"), "script-src 'self'");
  assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directive("object-src"), "object-src 'none'");
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(directive("script-src"), /unsafe-inline/);
  assert.doesNotMatch(csp, /testnet|fonts\.googleapis|fonts\.gstatic/);
});
