import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const styles = read("src/styles.css");
const css = `${styles}\n${read("src/LaunchLab.css")}`;

const tokens = (block) => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const darkBlock = styles.match(/:root \{([\s\S]*?)\n\}/)[1];
const autoLight = styles.match(/@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme="dark"\]\) \{([\s\S]*?)\n  \}\n\}/)[1];
const pinnedLight = styles.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/)[1];

test("following the system and pinning light give exactly the same colours", () => {
  const auto = tokens(autoLight);
  const pinned = tokens(pinnedLight);
  delete auto["color-scheme"];
  assert.ok(Object.keys(auto).length > 20);
  assert.deepEqual(auto, pinned);
});

test("every colour token the light theme sets exists in the dark theme, and every token used is defined", () => {
  const dark = tokens(darkBlock);
  for (const name of Object.keys(tokens(pinnedLight))) assert.ok(name in dark, `${name} is set for light but not for dark`);
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const name of used) assert.ok(name in dark || local.has(name), `${name} is used but never defined`);
});

test("text and borders no longer use fixed dark-theme colours that would be unreadable on light", () => {
  const fixed = ["#5eead4", "#fbbf24", "#34d399", "#f87171", "#fda4af", "#fecaca", "#fde68a", "#fdba74"];
  const outsideTokens = css.replace(/:root[\s\S]*?\n\}/g, "").replace(/@media \(prefers-color-scheme: light\)[\s\S]*?\n  \}\n\}/, "");
  for (const colour of fixed) assert.ok(!outsideTokens.toLowerCase().includes(colour), `${colour} should be a token`);
});
