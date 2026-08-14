/**
 * Pure decision logic, shared by the service worker and the panel.
 *
 * Nothing here touches `chrome.*` or the DOM, which is what lets the whole
 * module be tested with `node --test` and guarantees that both sides of the
 * port apply exactly the same rules.
 */

import type { DetectedLanguage } from "./messages.ts";

/**
 * Below this, the detector is guessing. Three-word comments like "lgtm, fix
 * later" routinely come back as something exotic with low confidence, and
 * hiding presets on that basis is worse than showing them.
 */
export const CONFIDENCE_FLOOR = 0.5;

/** Used only when the model cannot be asked what the input actually costs. */
export const CHAR_FALLBACK = 4000;

export const LABEL_MAX = 40;
export const INSTRUCTION_MAX = 500;
export const CUSTOM_LIMIT = 12;

/** A user-defined preset, as stored and as validated on the way back in. */
export interface CustomPreset {
  id: string;
  label: string;
  instruction: string;
  englishOnly: boolean;
  /** Epoch millis; only used to keep ordering stable across machines. */
  createdAt: number;
}

/** The language conditions a preset can carry. */
export interface LanguageGate {
  englishOnly?: boolean;
  nonEnglishOnly?: boolean;
}

/** `en-GB` and `en` are the same language for our purposes. */
export function baseLanguage(code: string | null | undefined): string | null {
  if (typeof code !== "string" || !code) return null;
  return code.split(/[-_]/)[0]!.toLowerCase();
}

export function isEnglishCode(code: string | null | undefined): boolean {
  return baseLanguage(code) === "en";
}

/** Whether a detection is confident enough to act on. */
export function languageIsCertain(
  language: DetectedLanguage | null | undefined,
): boolean {
  if (!language?.code) return false;
  if (language.confidence == null) return true; // no figure given: trust it
  return language.confidence >= CONFIDENCE_FLOOR;
}

/** Whether a preset should be offered for the detected language. */
export function presetApplies(
  preset: LanguageGate | null | undefined,
  language: DetectedLanguage | null | undefined,
): boolean {
  if (!preset) return false;
  if (!languageIsCertain(language)) return true; // unsure: hide nothing
  const english = isEnglishCode(language!.code);
  if (preset.englishOnly && !english) return false;
  if (preset.nonEnglishOnly && english) return false;
  return true;
}

/** Models like wrapping their answer in quotes despite being told not to. */
export function cleanOutput(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.trim().replace(/^["'`]|["'`]$/g, "");
}

/**
 * Fallback size check for when no session is loaded to measure against. Applied
 * before an executor is chosen, so the Rewriter and Translator paths are covered
 * too and not just the Prompt one.
 */
export function tooLongByChars(text: string): boolean {
  return typeof text === "string" && text.length > CHAR_FALLBACK;
}

/**
 * Storage is user-editable and synced across machines, so every stored preset is
 * treated as untrusted input on the way back in.
 */
export function normalizeCustomPreset(raw: unknown): CustomPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CustomPreset>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const instruction =
    typeof value.instruction === "string" ? value.instruction.trim() : "";
  if (!id || !label || !instruction) return null;
  return {
    id,
    label: label.slice(0, LABEL_MAX),
    instruction: instruction.slice(0, INSTRUCTION_MAX),
    englishOnly: Boolean(value.englishOnly),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt! : 0,
  };
}

/** Stable order regardless of the order storage happens to return keys in. */
export function sortCustomPresets<T extends { id: string; createdAt: number }>(
  list: T[],
): T[] {
  return [...list].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}
