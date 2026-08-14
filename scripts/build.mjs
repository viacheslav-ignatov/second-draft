#!/usr/bin/env node
/**
 * Builds `dist/`, which is what you load unpacked and what gets zipped for the
 * store. There is no framework here on purpose: four esbuild entry points and a
 * file copy.
 *
 *   node scripts/build.mjs           one-off build
 *   node scripts/build.mjs --watch   rebuild on change
 */

import { context, build as esbuild } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "dist");
const watch = process.argv.includes("--watch");

const manifest = JSON.parse(await readFile(join(root, "src/static/manifest.json"), "utf8"));

/**
 * The service worker is a module, so it can be split across files. The content
 * script cannot — Chrome injects it as a classic script — so it is bundled into
 * a single IIFE with the panel CSS inlined as text.
 */
const targets = [
  { entry: "src/background/index.ts", out: "background.js", format: "esm" },
  { entry: "src/content/index.ts", out: "content.js", format: "iife" },
  { entry: "src/popup/index.ts", out: "popup.js", format: "esm" },
  { entry: "src/options/index.ts", out: "options.js", format: "esm" },
  { entry: "src/welcome/index.ts", out: "welcome.js", format: "esm" },
];

const common = {
  bundle: true,
  target: "chrome138",
  platform: "browser",
  loader: { ".css": "text" },
  legalComments: "none",
  logLevel: "info",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
};

async function copyStatic() {
  await cp(join(root, "src/static"), out, { recursive: true });
  await cp(join(root, "src/shared/tokens.css"), join(out, "tokens.css"));
  for (const page of ["popup", "options", "welcome"]) {
    await cp(join(root, `src/${page}`), out, {
      recursive: true,
      filter: (src) => !src.endsWith(".ts"),
    });
  }
}

async function run() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await copyStatic();

  const configs = targets.map((t) => ({
    ...common,
    entryPoints: [join(root, t.entry)],
    outfile: join(out, t.out),
    format: t.format,
  }));

  if (watch) {
    const contexts = await Promise.all(configs.map(context));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log(`watching — load ${out} as an unpacked extension`);
  } else {
    await Promise.all(configs.map(esbuild));
    console.log(`built dist/ for Second Draft ${manifest.version}`);
  }
}

await run();
