import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAR_FALLBACK,
  INSTRUCTION_MAX,
  LABEL_MAX,
  baseLanguage,
  cleanOutput,
  isEnglishCode,
  languageIsCertain,
  normalizeCustomPreset,
  presetApplies,
  sliceWholeChars,
  sortCustomPresets,
  tooLongByChars,
} from "../src/shared/rules.ts";

test("baseLanguage strips region subtags", () => {
  assert.equal(baseLanguage("en-GB"), "en");
  assert.equal(baseLanguage("EN"), "en");
  assert.equal(baseLanguage("de_DE"), "de");
  assert.equal(baseLanguage(""), null);
  assert.equal(baseLanguage(undefined), null);
});

test("English is English regardless of region", () => {
  assert.equal(isEnglishCode("en-US"), true);
  assert.equal(isEnglishCode("en"), true);
  assert.equal(isEnglishCode("de"), false);
});

test("a low-confidence guess is not treated as a detection", () => {
  assert.equal(
    languageIsCertain({ code: "cy", name: "Welsh", confidence: 0.2 }),
    false,
  );
  assert.equal(
    languageIsCertain({ code: "cy", name: "Welsh", confidence: 0.9 }),
    true,
  );
  assert.equal(
    languageIsCertain({ code: "cy", name: "Welsh", confidence: null }),
    true,
  );
  assert.equal(languageIsCertain(null), false);
});

test("presetApplies hides nothing when the language is unknown or uncertain", () => {
  const englishOnly = { englishOnly: true };
  assert.equal(presetApplies(englishOnly, null), true);
  // "lgtm, fix later" comes back as something exotic with low confidence
  assert.equal(
    presetApplies(englishOnly, { code: "cy", name: "Welsh", confidence: 0.15 }),
    true,
  );
});

test("presetApplies gates on a confident detection", () => {
  const englishOnly = { englishOnly: true };
  const nonEnglishOnly = { nonEnglishOnly: true };
  const ru = { code: "ru", name: "Russian", confidence: 0.99 };
  const enGB = { code: "en-GB", name: "English", confidence: 0.99 };

  assert.equal(presetApplies(englishOnly, ru), false);
  assert.equal(presetApplies(englishOnly, enGB), true);
  assert.equal(presetApplies(nonEnglishOnly, enGB), false);
  assert.equal(presetApplies(nonEnglishOnly, ru), true);
  assert.equal(presetApplies({}, ru), true);
});

test("cleanOutput strips the quotes models add despite being told not to", () => {
  assert.equal(cleanOutput('  "Looks good to me."  '), "Looks good to me.");
  assert.equal(cleanOutput("`code`"), "code");
  assert.equal(cleanOutput('He said "no" to it'), 'He said "no" to it');
  assert.equal(cleanOutput(null), "");
});

test("the character fallback guards every executor, not just the prompt path", () => {
  assert.equal(tooLongByChars("x".repeat(CHAR_FALLBACK)), false);
  assert.equal(tooLongByChars("x".repeat(CHAR_FALLBACK + 1)), true);
  assert.equal(tooLongByChars(""), false);
});

test("stored presets are treated as untrusted input", () => {
  assert.equal(normalizeCustomPreset(null), null);
  assert.equal(normalizeCustomPreset({ id: "a", label: "  " }), null);
  assert.equal(
    normalizeCustomPreset({ id: "a", label: "x", instruction: "" }),
    null,
  );

  const clipped = normalizeCustomPreset({
    id: "a1",
    label: "L".repeat(200),
    instruction: "I".repeat(5000),
    englishOnly: "yes",
  });
  assert.notEqual(clipped, null);
  const preset = clipped!;
  assert.equal(preset.label.length, LABEL_MAX);
  assert.equal(preset.instruction.length, INSTRUCTION_MAX);
  assert.equal(preset.englishOnly, true);
  assert.equal(preset.createdAt, 0);
});

// U+1F600, one character made of two UTF-16 code units.
const GRIN = "😀";
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

test("a cut inside an emoji drops it rather than half of it", () => {
  const text = `abc${GRIN}def`;
  const cut = sliceWholeChars(text, 4);

  assert.equal(cut, "abc");
  assert.ok(!LONE_HIGH_SURROGATE.test(cut));
});

test("a cut past the emoji keeps it whole", () => {
  const cut = sliceWholeChars(`abc${GRIN}def`, 5);

  assert.equal(cut, `abc${GRIN}`);
  assert.equal([...cut].length, 4);
});

test("text within the limit is returned untouched", () => {
  assert.equal(sliceWholeChars(`ab${GRIN}`, 4), `ab${GRIN}`);
  assert.equal(sliceWholeChars("", 10), "");
  assert.equal(sliceWholeChars("abc", 0), "");
});

test("presets keep a stable order across machines", () => {
  const sorted = sortCustomPresets([
    { id: "b", createdAt: 2 },
    { id: "a", createdAt: 1 },
    { id: "c", createdAt: 1 },
  ]);
  assert.deepEqual(
    sorted.map((p) => p.id),
    ["a", "c", "b"],
  );
});
