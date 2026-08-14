#!/usr/bin/env node
/**
 * Manifest invariants.
 *
 * The zero-permission architecture is the product, so it is asserted here rather
 * than trusted: a future change that reintroduces a host permission or a
 * declared content script fails the build instead of quietly shipping.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync("src/static/manifest.json", "utf8"));
const problems = [];

if (manifest.manifest_version !== 3) problems.push("not manifest v3");
if (manifest.host_permissions?.length) problems.push("host_permissions must stay empty");
if (manifest.content_scripts?.length) problems.push("content scripts must be injected on demand");
if (manifest.background?.type !== "module") problems.push("service worker must be a module");

const EXPECTED_PERMISSIONS = ["contextMenus", "activeTab", "scripting", "storage"];
const extra = (manifest.permissions ?? []).filter((p) => !EXPECTED_PERMISSIONS.includes(p));
if (extra.length) problems.push(`unjustified permission(s): ${extra.join(", ")}`);

// Everything the manifest points at has to exist in the built output.
if (existsSync("dist")) {
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
  ].filter(Boolean);
  for (const file of referenced) {
    if (!existsSync(join("dist", file))) problems.push(`manifest references missing file: ${file}`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(`  ✓ v${manifest.version}, ${manifest.permissions.join(", ")}, no host permissions`);
