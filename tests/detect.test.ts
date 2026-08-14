/**
 * Language detection.
 *
 * Small surface, but it runs on every invocation and now on the same clock as
 * the generation, so what it costs is worth pinning down — as is what it does
 * when the detector or the runtime declines to help.
 */

import test from "node:test";
import assert from "node:assert/strict";

import type * as DetectModule from "../src/background/ai/detect.ts";
import { resetSessions } from "../src/background/ai/sessions.ts";
import { clearGlobals, installChrome } from "./helpers/doubles.ts";

interface Guess {
  detectedLanguage: string;
  confidence?: number;
}

/** Installs a detector and returns a fresh copy of the module against it. */
async function withDetector(
  results: Guess[],
  availability: "available" | "unavailable" = "available",
) {
  installChrome();
  (globalThis as Record<string, unknown>).LanguageDetector = {
    availability: () => Promise.resolve(availability),
    create: () => Promise.resolve({ detect: () => Promise.resolve(results) }),
  };

  // The formatter is memoised at module scope, so each case needs its own
  // instance of the module — the same trick target.test.ts uses for focus state.
  return (await import(
    `../src/background/ai/detect.ts?case=${Math.random()}`
  )) as typeof DetectModule;
}

/**
 * Replaces `Intl.DisplayNames` with a counting stand-in.
 *
 * Returns how many were constructed, which is the whole point of the memo: the
 * cost is in the constructor, not in `of()`.
 */
function countFormatters(options: { throws?: boolean } = {}) {
  const real = Intl.DisplayNames;
  let built = 0;

  class Counting {
    constructor() {
      built += 1;
      if (options.throws) throw new RangeError("unsupported locale");
    }
    of(code: string): string {
      // The real `of()` rejects a structurally invalid tag rather than
      // shrugging, and a detector is free to hand us one.
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(code)) {
        throw new RangeError(`invalid language tag: ${code}`);
      }
      return `name of ${code}`;
    }
  }

  (Intl as unknown as { DisplayNames: unknown }).DisplayNames = Counting;

  return {
    built: () => built,
    restore: () => {
      (Intl as unknown as { DisplayNames: unknown }).DisplayNames = real;
    },
  };
}

const post = () => undefined;

test.afterEach(() => {
  clearGlobals();
  resetSessions();
});

test("the display-name formatter is built once, not per detection", async () => {
  const detect = await withDetector([
    { detectedLanguage: "de", confidence: 0.9 },
  ]);
  const formatters = countFormatters();

  try {
    const first = await detect.detectLanguage("Guten Tag", post);
    const second = await detect.detectLanguage("Noch ein Satz", post);

    assert.equal(first?.name, "name of de");
    assert.equal(
      second?.name,
      "name of de",
      "and the second answer is no worse",
    );
    assert.equal(
      formatters.built(),
      1,
      "the UI language cannot change under a worker that is already awake",
    );
  } finally {
    formatters.restore();
  }
});

test("a formatter the runtime refuses is not retried", async () => {
  const detect = await withDetector([
    { detectedLanguage: "de", confidence: 0.9 },
  ]);
  const formatters = countFormatters({ throws: true });

  try {
    const first = await detect.detectLanguage("Guten Tag", post);
    const second = await detect.detectLanguage("Noch ein Satz", post);

    assert.equal(first?.name, "de", "the code stands in for the name");
    assert.equal(second?.name, "de");
    assert.equal(
      formatters.built(),
      1,
      "a locale it refused once it will refuse again",
    );
  } finally {
    formatters.restore();
  }
});

test("a tag the formatter rejects falls back to the code", async () => {
  const detect = await withDetector([
    { detectedLanguage: "not a real tag", confidence: 0.6 },
  ]);
  const formatters = countFormatters();

  try {
    const language = await detect.detectLanguage("???", post);

    assert.equal(
      language?.name,
      "not a real tag",
      "the code stands in rather than the detection being lost",
    );
    assert.equal(language?.code, "not a real tag");
  } finally {
    formatters.restore();
  }
});

test("a detection carries the code, a name and the confidence", async () => {
  const detect = await withDetector([
    { detectedLanguage: "ru", confidence: 0.97 },
  ]);

  const language = await detect.detectLanguage("Это текст", post);

  assert.equal(language?.code, "ru");
  assert.equal(language?.confidence, 0.97);
  assert.ok(
    language?.name,
    "something readable, whatever the runtime returned",
  );
});

test("a detector with no confidence figure reports none", async () => {
  const detect = await withDetector([{ detectedLanguage: "fr" }]);

  const language = await detect.detectLanguage("Bonjour", post);

  assert.equal(
    language?.confidence,
    null,
    "null rather than 0 — `languageIsCertain` trusts a missing figure",
  );
});

test("an unavailable detector is not an error", async () => {
  const detect = await withDetector([], "unavailable");

  assert.equal(await detect.detectLanguage("anything", post), null);
});

test("a detector that returns nothing is not an error", async () => {
  const detect = await withDetector([]);

  assert.equal(await detect.detectLanguage("anything", post), null);
});

test("no detector at all is not an error", async () => {
  const detect = await withDetector([]);
  delete (globalThis as Record<string, unknown>).LanguageDetector;

  assert.equal(await detect.detectLanguage("anything", post), null);
});
