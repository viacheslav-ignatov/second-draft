#!/usr/bin/env node
/**
 * Installs a pre-commit hook that runs the same checks as CI.
 *
 * Run automatically by `npm install`. Skipped outside a git checkout (CI, or an
 * install from a tarball), and never overwrites a hook you already have.
 */

import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const hooks = join(".git", "hooks");
if (!existsSync(hooks)) process.exit(0);

const path = join(hooks, "pre-commit");
if (existsSync(path)) process.exit(0);

writeFileSync(
  path,
  `#!/bin/sh
# Installed by scripts/install-hooks.mjs. Delete this file to opt out.
npm run check
`,
);
chmodSync(path, 0o755);
console.log("installed .git/hooks/pre-commit");
