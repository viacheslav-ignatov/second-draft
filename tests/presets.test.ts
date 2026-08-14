/**
 * The preset summary the panel renders from.
 *
 * `needsLanguage` decides whether the panel blocks on detection before it starts
 * generating, so getting it wrong is either a slow panel (waiting for nothing)
 * or a wrong answer (proofreading English text that is not English). It is
 * derived rather than declared, which is exactly the kind of thing that drifts
 * when a preset is added.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { allPresets, summarize } from "../src/background/presets.ts";
import { clearGlobals, installChrome } from "./helpers/doubles.ts";

/** Preset ids whose result depends on what language the user is writing. */
const LANGUAGE_SENSITIVE = ["typos", "translate", "english"];

const byId = async (storage: Record<string, unknown> = {}) => {
  installChrome(storage);
  const summaries = summarize(await allPresets());
  return new Map(summaries.map((preset) => [preset.id, preset]));
};

test.afterEach(() => {
  clearGlobals();
});

test("exactly the language-sensitive presets ask to wait for detection", async () => {
  const presets = await byId();

  const waiting = [...presets.values()]
    .filter((preset) => preset.needsLanguage)
    .map((preset) => preset.id)
    .sort();

  assert.deepEqual(waiting, [...LANGUAGE_SENSITIVE].sort());
});

test("a gate and a detected-language proofread both count", async () => {
  const presets = await byId();

  // Gated: the chip is hidden outright for the wrong language.
  assert.equal(presets.get("translate")?.nonEnglishOnly, true);
  assert.equal(presets.get("english")?.englishOnly, true);

  // Not gated, but the proofreader is asked to work in whatever was detected,
  // so starting before the answer arrives would proofread in the wrong one.
  assert.equal(presets.get("typos")?.englishOnly, false);
  assert.equal(presets.get("typos")?.nonEnglishOnly, false);
  assert.equal(presets.get("typos")?.needsLanguage, true);
});

test("the language-agnostic presets do not block", async () => {
  const presets = await byId();

  for (const id of ["soften", "question", "shorter", "hedging", "casual"]) {
    assert.equal(
      presets.get(id)?.needsLanguage,
      false,
      `${id} has no reason to wait`,
    );
  }
});

test("a custom preset marked English-only waits too", async () => {
  const presets = await byId({
    "preset:house": {
      id: "house",
      label: "House style",
      instruction: "Rewrite in the house style.",
      englishOnly: true,
      createdAt: 1,
    },
    "preset:any": {
      id: "any",
      label: "Any language",
      instruction: "Rewrite it.",
      englishOnly: false,
      createdAt: 2,
    },
  });

  assert.equal(presets.get("custom:house")?.needsLanguage, true);
  assert.equal(presets.get("custom:any")?.needsLanguage, false);
});
