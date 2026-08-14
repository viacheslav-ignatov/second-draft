/**
 * Localisation.
 *
 * Keys are typed against the union generated from the English locale, so a
 * typo or a removed string fails the build rather than rendering as itself.
 */

import type { MessageKey } from "../generated/i18n-keys.ts";

export type { MessageKey };

/** Falls back to the key so a missing string is visible rather than blank. */
export function t(key: MessageKey, substitutions?: string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/** Applies `data-i18n="key"` bindings on an extension page. */
export function localizeDocument(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n as MessageKey | undefined;
    if (key) el.textContent = t(key);
  }
}
