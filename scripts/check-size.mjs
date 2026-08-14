#!/usr/bin/env node
/**
 * Bundle size budget.
 *
 * The content script is injected into every frame of a page on demand, so its
 * size is a user-visible cost, not a vanity metric. The budgets are generous —
 * this is a tripwire for an accidental dependency, not a golf score.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGETS_KB = {
  "content.js": 40,
  "background.js": 40,
  "popup.js": 20,
  "options.js": 20,
  "welcome.js": 10,
};

let failed = false;
let total = 0;

for (const [file, budget] of Object.entries(BUDGETS_KB)) {
  const kb = statSync(join("dist", file)).size / 1024;
  total += kb;
  const line = `${file.padEnd(15)} ${kb.toFixed(1).padStart(6)} kB / ${budget} kB`;
  if (kb > budget) {
    console.error(`  ✗ ${line}`);
    failed = true;
  } else {
    console.log(`  ✓ ${line}`);
  }
}

const all = readdirSync("dist", { recursive: true })
  .map((f) => join("dist", f))
  .filter((f) => statSync(f).isFile())
  .reduce((sum, f) => sum + statSync(f).size, 0);

console.log(
  `  ${total.toFixed(1)} kB of script, ${(all / 1024).toFixed(1)} kB packaged`,
);

if (failed) {
  console.error("bundle size check failed");
  process.exit(1);
}
