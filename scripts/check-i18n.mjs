#!/usr/bin/env node
/**
 * Locale consistency.
 *
 * Keys used from TypeScript are checked by the compiler against the generated
 * `MessageKey` union, so this only has to cover what types cannot see: that
 * every locale carries the same keys, that placeholders are declared, and that
 * `data-i18n` attributes in HTML point at something real.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const LOCALES = join(SRC, "static", "_locales");

let failed = false;
const fail = (message) => {
  console.error(`  ✗ ${message}`);
  failed = true;
};

// ---------- locales agree with each other ----------

const locales = {};
for (const dir of readdirSync(LOCALES)) {
  const path = join(LOCALES, dir, "messages.json");
  try {
    locales[dir] = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}

const names = Object.keys(locales);
if (names.length === 0) fail("no locales found");
if (!names.includes("en")) fail("the reference locale `en` is missing");

const reference = new Set(Object.keys(locales.en ?? {}));

for (const name of names) {
  if (name === "en") continue;
  const keys = new Set(Object.keys(locales[name]));
  for (const key of reference)
    if (!keys.has(key)) fail(`${name} is missing key "${key}"`);
  for (const key of keys)
    if (!reference.has(key)) fail(`${name} has extra key "${key}"`);
}

// ---------- placeholders are declared ----------

for (const [name, messages] of Object.entries(locales)) {
  for (const [key, entry] of Object.entries(messages)) {
    if (typeof entry?.message !== "string") {
      fail(`${name}/${key} has no message string`);
      continue;
    }
    const used = new Set(
      [...entry.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) =>
        m[1].toLowerCase(),
      ),
    );
    const declared = new Set(
      Object.keys(entry.placeholders ?? {}).map((p) => p.toLowerCase()),
    );
    for (const p of used)
      if (!declared.has(p)) fail(`${name}/${key} uses undeclared $${p}$`);
    for (const p of declared)
      if (!used.has(p)) fail(`${name}/${key} declares unused $${p}$`);
  }
}

// ---------- data-i18n bindings resolve ----------

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "_locales" ? [] : walk(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

for (const file of walk(SRC)) {
  const html = readFileSync(file, "utf8");
  for (const match of html.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) {
    if (!reference.has(match[1]))
      fail(`${file} binds unknown key "${match[1]}"`);
  }
}

// ---------- localised manifest fields resolve ----------

const manifest = readFileSync(join(SRC, "static", "manifest.json"), "utf8");
for (const match of manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
  if (!reference.has(match[1]))
    fail(`manifest references unknown key "${match[1]}"`);
}

if (failed) {
  console.error("i18n check failed");
  process.exit(1);
}

console.log(
  `  ✓ ${names.length} locales, ${reference.size} keys, placeholders consistent`,
);
