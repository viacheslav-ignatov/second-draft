/**
 * The execution chain.
 *
 * The invariant worth protecting: every route returns `null` when its API is
 * missing, and the chain always ends up somewhere. This is what keeps the
 * extension working on builds where Rewriter and Proofreader are still behind
 * an origin trial.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { execute } from "../src/background/ai/executors.ts";
import { resetSessions } from "../src/background/ai/sessions.ts";
import { clearGlobals, installChrome, installLanguageModel } from "./helpers/doubles.ts";
import type { Preset } from "../src/background/presets.ts";

const context = (preset: Partial<Preset>, text = "some text") => ({
  preset: { label: "Test", builtin: true, ...preset },
  text,
  language: { code: "en", name: "English", confidence: 0.99 },
  post: () => undefined,
  signal: new AbortController().signal,
});

function install(name: string, api: unknown): void {
  (globalThis as Record<string, unknown>)[name] = api;
}

/** Minimal stand-ins; each records that it was the one that ran. */
const rewriter = (output = "rewritten") => ({
  availability: () => Promise.resolve("available"),
  create: () => Promise.resolve({ rewrite: () => Promise.resolve(output) }),
});

const proofreader = (output = "proofread") => ({
  availability: () => Promise.resolve("available"),
  create: () => Promise.resolve({ proofread: () => Promise.resolve({ correctedInput: output }) }),
});

const translator = (output = "translated") => ({
  availability: () => Promise.resolve("available"),
  create: () => Promise.resolve({ translate: () => Promise.resolve(output) }),
});

test.beforeEach(() => {
  resetSessions();
  installChrome();
});

test.afterEach(() => {
  clearGlobals();
  resetSessions();
});

test("with nothing available at all, the chain returns null", async () => {
  const result = await execute(context({ prompt: "rewrite it" }));
  assert.equal(result, null);
});

test("a preset with only a prompt runs on the Prompt API", async () => {
  installLanguageModel({ chunks: ["prompted"] });
  const result = await execute(context({ prompt: "rewrite it" }));
  assert.equal(result, "prompted");
});

test("the Rewriter wins over the Prompt API when both are present", async () => {
  installLanguageModel({ chunks: ["prompted"] });
  install("Rewriter", rewriter());
  const result = await execute(
    context({ rewriter: { tone: "as-is", length: "shorter" }, prompt: "rewrite it" }),
  );
  assert.equal(result, "rewritten");
});

test("without the Rewriter, the same preset falls through to the Prompt API", async () => {
  installLanguageModel({ chunks: ["prompted"] });
  const result = await execute(
    context({ rewriter: { tone: "as-is", length: "shorter" }, prompt: "rewrite it" }),
  );
  assert.equal(result, "prompted", "an origin-trial-only API must not break the preset");
});

test("the Proofreader runs ahead of the Rewriter", async () => {
  install("Proofreader", proofreader());
  install("Rewriter", rewriter());
  installLanguageModel({ chunks: ["prompted"] });
  const result = await execute(context({ proofread: { language: "en" }, prompt: "fix it" }));
  assert.equal(result, "proofread");
});

test("a detected-language proofread with no detection falls through", async () => {
  install("Proofreader", proofreader());
  installLanguageModel({ chunks: ["prompted"] });
  const result = await execute({
    ...context({ proofread: { language: "detected" }, prompt: "fix it" }),
    language: null,
  });
  assert.equal(result, "prompted");
});

test("the Translator runs first when the preset asks for it", async () => {
  install("Translator", translator());
  install("Rewriter", rewriter());
  installLanguageModel({ chunks: ["prompted"] });
  const result = await execute({
    ...context({ translator: { targetLanguage: "en" } }),
    language: { code: "de", name: "German", confidence: 0.99 },
  });
  assert.equal(result, "translated");
});

test("translating text that is already the target language is an error", async () => {
  install("Translator", translator());
  await assert.rejects(() => execute(context({ translator: { targetLanguage: "en" } })));
});

test("an unavailable API is skipped rather than throwing", async () => {
  install("Rewriter", { availability: () => Promise.resolve("unavailable") });
  installLanguageModel({ chunks: ["prompted"] });
  const result = await execute(
    context({ rewriter: { tone: "as-is", length: "shorter" }, prompt: "rewrite it" }),
  );
  assert.equal(result, "prompted");
});

test("a probe that throws is treated as unavailable", async () => {
  install("Rewriter", {
    availability: () => Promise.reject(new Error("boom")),
  });
  installLanguageModel({ chunks: ["prompted"] });
  const result = await execute(
    context({ rewriter: { tone: "as-is", length: "shorter" }, prompt: "rewrite it" }),
  );
  assert.equal(result, "prompted");
});
