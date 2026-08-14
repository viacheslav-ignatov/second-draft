/**
 * The preset catalogue.
 *
 * A preset declares *how* it wants to be executed and *when* it applies. The
 * executor chain in `ai/executors.ts` tries each declared route in order and
 * falls through to `prompt`, which every preset has, so a preset keeps working
 * on builds where the newer APIs are missing.
 */

import { t, type MessageKey } from "../shared/i18n.ts";
import { readPresets } from "../shared/preset-storage.ts";
import type { LanguageGate } from "../shared/rules.ts";
import type { PresetSummary } from "../shared/messages.ts";

/** A BCP-47 tag, or `detected` for whatever the detector reports. */
export type ProofreadLanguage = "detected" | (string & {});

export interface Preset extends LanguageGate {
  label: string;
  /** Target language for the Translator API. */
  translator?: { targetLanguage: string };
  /**
   * Grammar-only pass. A language tag, or the literal `detected` to proofread in
   * whatever the user turns out to be writing.
   */
  proofread?: { language: ProofreadLanguage };
  /** Tone and length for the Rewriter API. */
  rewriter?: { tone: string; length: string };
  /** Instruction for the Prompt API, and the fallback for every route above. */
  prompt?: string;
  builtin: boolean;
}

interface BuiltinPreset extends Omit<Preset, "label" | "builtin"> {
  labelKey: MessageKey;
}

const BUILTIN: Record<string, BuiltinPreset> = {
  soften: {
    labelKey: "presetSoften",
    rewriter: { tone: "more-formal", length: "as-is" },
    prompt:
      "Rewrite the comment so it sounds collaborative rather than blunt. " +
      "Do not weaken or remove any technical claim: if the author says something " +
      "is broken, the rewrite must still say it is broken. Keep the same language " +
      "as the input. Return only the rewritten text.",
  },
  question: {
    labelKey: "presetQuestion",
    prompt:
      "Rewrite the code-review comment as a genuine question to the author, " +
      "keeping the technical substance intact. Prefer 'what happens if' or " +
      "'would it make sense to' over rhetorical questions. Keep the same " +
      "language as the input. Return only the rewritten text.",
  },
  shorter: {
    labelKey: "presetShorter",
    rewriter: { tone: "as-is", length: "shorter" },
    prompt:
      "Compress the text to roughly half its length without dropping any " +
      "technical detail. Keep the same language. Return only the rewritten text.",
  },
  // Hedging is the single most common thing that makes a competent person read
  // as unsure, and non-native writers pile it on out of politeness.
  hedging: {
    labelKey: "presetHedging",
    prompt:
      "Remove hedging and filler from the text: phrases like 'I think', 'just', " +
      "'maybe', 'a bit', 'sorry to bother', 'if that makes sense', 'I could be " +
      "wrong'. Keep the claim exactly as strong as it was, keep ordinary " +
      "politeness, and do not make it curt or rude. Keep the same language. " +
      "Return only the rewritten text.",
  },
  bullets: {
    labelKey: "presetBullets",
    prompt:
      "Restructure the text as a short bulleted list, one point per line, each " +
      "line starting with '- '. Do not add points that are not already in the " +
      "text and do not drop any. Keep the same language. Return only the list.",
  },
  casual: {
    labelKey: "presetCasual",
    rewriter: { tone: "more-casual", length: "as-is" },
    prompt:
      "Rewrite the text so it sounds relaxed and human rather than stiff or " +
      "corporate. Keep every fact and the same level of respect. No slang, no " +
      "exclamation marks. Keep the same language. Return only the rewritten text.",
  },
  // Spelling and punctuation in whatever language the person is writing, which
  // is the everyday case for anyone working in a second language.
  typos: {
    labelKey: "presetTypos",
    proofread: { language: "detected" },
    prompt:
      "Correct only typos, spelling and punctuation. Do not change wording, " +
      "grammar choices, tone, structure or register. Keep the same language. " +
      "Return only the corrected text.",
  },
  translate: {
    labelKey: "presetTranslate",
    translator: { targetLanguage: "en" },
    nonEnglishOnly: true,
  },
  english: {
    labelKey: "presetEnglish",
    englishOnly: true,
    proofread: { language: "en" },
    prompt:
      "Correct grammar, spelling, articles and word order in the text below. " +
      "Do not change the tone, the register, the structure or the wording where " +
      "it is already correct. Do not make it more polite or more formal. " +
      "Return only the corrected text.",
  },
};

export const CUSTOM_PREFIX = "custom:";

/** Built-ins plus the user's own, keyed by preset id. */
export async function allPresets(): Promise<Record<string, Preset>> {
  const merged: Record<string, Preset> = {};

  for (const [id, preset] of Object.entries(BUILTIN)) {
    const { labelKey, ...rest } = preset;
    merged[id] = { ...rest, label: t(labelKey), builtin: true };
  }

  for (const custom of await readPresets()) {
    merged[CUSTOM_PREFIX + custom.id] = {
      label: custom.label,
      prompt: custom.instruction,
      englishOnly: custom.englishOnly,
      builtin: false,
    };
  }

  return merged;
}

/** The subset the panel and the context menu need. */
export function summarize(presets: Record<string, Preset>): PresetSummary[] {
  return Object.entries(presets).map(([id, preset]) => ({
    id,
    label: preset.label,
    englishOnly: Boolean(preset.englishOnly),
    nonEnglishOnly: Boolean(preset.nonEnglishOnly),
  }));
}
