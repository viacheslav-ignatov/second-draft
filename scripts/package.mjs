#!/usr/bin/env node
/**
 * Zips `dist/` for the Chrome Web Store, which requires `manifest.json` at the
 * archive root rather than inside a folder.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const out = `second-draft-${version}.zip`;

mkdirSync("release", { recursive: true });
rmSync(`release/${out}`, { force: true });
execFileSync("zip", ["-r", "-q", `../release/${out}`, ".", "-x", "*.DS_Store"], { cwd: "dist" });

console.log(`packaged release/${out}`);
