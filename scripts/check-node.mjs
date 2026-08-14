#!/usr/bin/env node
/**
 * Node version guard.
 *
 * The tests are TypeScript run straight through `node --test`, which relies on
 * type stripping — added in 22.6. On anything older the run dies with a
 * SyntaxError pointing inside a test file, which reads as a broken test rather
 * than the wrong Node.
 *
 * The requirement is read from `engines`, so there is one place to change it.
 */

import { readFileSync } from "node:fs";

const { engines } = JSON.parse(readFileSync("package.json", "utf8"));
const required = engines?.node ?? "";
const [major, minor = 0] = required.replace(/^\D+/, "").split(".").map(Number);

if (!Number.isFinite(major)) {
  console.error("  ✗ package.json declares no usable engines.node");
  process.exit(1);
}

const [haveMajor, haveMinor] = process.versions.node.split(".").map(Number);

if (haveMajor < major || (haveMajor === major && haveMinor < minor)) {
  console.error(
    `  ✗ Node ${required} required — the tests are TypeScript and need type\n` +
      `    stripping, added in 22.6. This is ${process.versions.node}.`,
  );
  process.exit(1);
}
