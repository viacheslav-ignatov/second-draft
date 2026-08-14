#!/usr/bin/env node
/**
 * Node version guard.
 *
 * Two things set the floor: the tests are TypeScript run straight through
 * `node --test`, which needs type stripping (22.6), and ESLint 10 refuses to
 * start below 22.13. Either way the failure without this guard is a SyntaxError
 * inside a test file or a stack trace out of a linter, both of which read as a
 * broken project rather than the wrong Node.
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
    `  ✗ Node ${required} required — for type stripping in \`node --test\` and\n` +
      `    for ESLint. This is ${process.versions.node}.`,
  );
  process.exit(1);
}
