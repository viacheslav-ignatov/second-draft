#!/usr/bin/env node
/**
 * Zips `dist/` for the Chrome Web Store, which requires `manifest.json` at the
 * archive root rather than inside a folder.
 *
 * The system `zip` is used rather than a dependency: macOS, Linux and the CI
 * runner all have it, and a hand-rolled ZIP writer is a lot of format code
 * standing between a release and the store. Windows does not — see CONTRIBUTING.md.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const out = `second-draft-${version}.zip`;

mkdirSync("release", { recursive: true });
rmSync(`release/${out}`, { force: true });

try {
  execFileSync(
    "zip",
    ["-r", "-q", `../release/${out}`, ".", "-x", "*.DS_Store"],
    { cwd: "dist" },
  );
} catch (error) {
  // ENOENT here means no `zip` on PATH, which reads as a broken script unless
  // it is spelled out.
  if (error.code === "ENOENT") {
    console.error(
      "  ✗ `zip` is not on PATH. Install it, build in WSL, or take the zip\n" +
        "    from the release workflow — see CONTRIBUTING.md.",
    );
    process.exit(1);
  }
  throw error;
}

console.log(`packaged release/${out}`);
