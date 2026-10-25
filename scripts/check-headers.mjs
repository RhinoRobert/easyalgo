// Checks a live site's response headers against deploy/security-headers.json. Read-only: one GET request.
//
//   npm run check:headers                    # https://easyalgo.org
//   node scripts/check-headers.mjs https://example.com
import { readFileSync } from "node:fs";

const expected = JSON.parse(readFileSync(new URL("../deploy/security-headers.json", import.meta.url), "utf8"));
const url = process.argv[2] ?? "https://easyalgo.org/";
const response = await fetch(url, { redirect: "follow" });
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

for (const [name, value] of Object.entries(expected.headers)) {
  const actual = response.headers.get(name);
  check(name, actual === value, actual === null ? "missing" : `got "${actual}"`);
}

const hsts = response.headers.get("strict-transport-security");
const maxAge = Number(/max-age=(\d+)/i.exec(hsts ?? "")?.[1] ?? 0);
check("Strict-Transport-Security", maxAge >= expected.hsts.minimumMaxAgeSeconds, hsts ? `got "${hsts}"` : "missing");

const enforcing = response.headers.get("content-security-policy");
const reportOnly = response.headers.get("content-security-policy-report-only");
const policy = enforcing ?? reportOnly;
check("Content-Security-Policy is enforced", Boolean(enforcing), enforcing ? "" : reportOnly ? "only Report-Only is set (fine while testing)" : "missing");
const wanted = new Set(expected.contentSecurityPolicy.split(";").map((part) => part.trim()).filter(Boolean));
const actual = new Set((policy ?? "").split(";").map((part) => part.trim()).filter(Boolean));
const missing = [...wanted].filter((directive) => !actual.has(directive));
const extra = [...actual].filter((directive) => !wanted.has(directive));
check("CSP directives equal deploy/security-headers.json", missing.length === 0 && extra.length === 0,
  [missing.length ? `missing: ${missing.join(" | ")}` : "", extra.length ? `unexpected: ${extra.join(" | ")}` : ""].filter(Boolean).join("; "));
const script = [...actual].find((directive) => directive.startsWith("script-src")) ?? "";
check("script-src allows no inline or eval", Boolean(script) && !/unsafe-inline|unsafe-eval|\*|https?:/.test(script), script);

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}
console.log(`\n${url}: ${failed ? `${failed} check(s) failed` : "all checks passed"}`);
process.exitCode = failed ? 1 : 0;