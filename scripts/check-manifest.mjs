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
if (manifest.host_permissions?.length)
  problems.push("host_permissions must stay empty");
if (manifest.content_scripts?.length)
  problems.push("content scripts must be injected on demand");
if (manifest.background?.type !== "module")
  problems.push("service worker must be a module");

const EXPECTED_PERMISSIONS = [
  "contextMenus",
  "activeTab",
  "scripting",
  "storage",
];
const extra = (manifest.permissions ?? []).filter(
  (p) => !EXPECTED_PERMISSIONS.includes(p),
);
if (extra.length)
  problems.push(`unjustified permission(s): ${extra.join(", ")}`);

// "Sends nothing anywhere" is a claim PRIVACY.md makes in the user's name, so
// the directives that actually enforce it are asserted rather than assumed.
// Note the limit: this CSP governs the service worker and the extension pages,
// never the injected content script, which lives under the page's own policy.
const csp = manifest.content_security_policy?.extension_pages ?? "";
for (const directive of [
  "connect-src 'none'",
  "object-src 'none'",
  "img-src 'self'",
]) {
  if (!csp.includes(directive))
    problems.push(`extension_pages CSP must contain "${directive}"`);
}

// Everything the manifest points at has to exist in the built output.
if (existsSync("dist")) {
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
  ].filter(Boolean);
  for (const file of referenced) {
    if (!existsSync(join("dist", file)))
      problems.push(`manifest references missing file: ${file}`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `  ✓ v${manifest.version}, ${manifest.permissions.join(", ")}, no host permissions, connect-src 'none'`,
);
