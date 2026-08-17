#!/usr/bin/env node
/**
 * Bundle size budget.
 *
 * The content script is injected into every frame of a page on demand, so its
 * size is a user-visible cost, not a vanity metric. The budgets are generous —
 * this is a tripwire for an accidental dependency, not a golf score.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGETS_KB = {
  "content.js": 40,
  "background.js": 40,
  "popup.js": 20,
  "options.js": 20,
  "welcome.js": 10,
};

// This measures the built output, so it has nothing to say before a build. It
// used to say it with an ENOENT stack trace.
if (!existsSync("dist")) {
  console.error("no dist/ — run `npm run build` first");
  process.exit(1);
}

let failed = false;
let total = 0;

for (const [file, budget] of Object.entries(BUDGETS_KB)) {
  const path = join("dist", file);
  if (!existsSync(path)) {
    console.error(`  ✗ ${file.padEnd(15)} missing from dist/`);
    failed = true;
    continue;
  }
  const kb = statSync(path).size / 1024;
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
