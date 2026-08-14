/** The right-click entry point, rebuilt whenever the user's presets change. */

import { t } from "../shared/i18n.ts";
import { allPresets, summarize } from "./presets.ts";

export const MENU_ROOT = "second-draft";
export const MENU_PREFIX = `${MENU_ROOT}:`;

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * Preset labels are the user's own text, and Chrome rewrites `%s` in a menu
 * title to the selected text — so a preset called "Translate %s" would quietly
 * grow a copy of the selection. `%%` is not an escape (menu_manager.cc still
 * carries the TODO saying so, and doubling would render literal percent signs
 * twice on top of that), so break the pair instead: a zero-width space is
 * invisible in the menu and stops the substring from matching.
 */
function menuTitle(label: string): string {
  return label.replaceAll("%s", `%${ZERO_WIDTH_SPACE}s`);
}

let chain: Promise<void> = Promise.resolve();

/**
 * Rebuilds are serialised, because two arrive together as a matter of course:
 * saving presets writes a `remove` and a `set`, and each fires its own
 * `storage.onChanged`. Interleaved, one rebuild's `removeAll()` lands between
 * the other's `create()` calls and Chrome rejects the duplicate ids — silently,
 * into `runtime.lastError`, leaving a half-built menu.
 */
export function buildMenus(): Promise<void> {
  chain = chain.catch(() => undefined).then(rebuild);
  return chain;
}

async function rebuild(): Promise<void> {
  const presets = summarize(await allPresets());
  await chrome.contextMenus.removeAll();
  create({ id: MENU_ROOT, title: t("menuRoot"), contexts: ["editable"] });
  for (const { id, label } of presets) {
    create({
      id: MENU_PREFIX + id,
      parentId: MENU_ROOT,
      title: menuTitle(label),
      contexts: ["editable"],
    });
  }
}

/** `create` reports asynchronously; without the callback the error is swallowed. */
function create(properties: chrome.contextMenus.CreateProperties): void {
  chrome.contextMenus.create(properties, () => {
    const error = chrome.runtime.lastError;
    if (error) console.warn("[second-draft] menu item refused", error.message);
  });
}

/** The preset id behind a menu item, or `null` if it is not one of ours. */
export function presetIdFromMenuItem(
  menuItemId: string | number,
): string | null {
  const id = String(menuItemId);
  return id.startsWith(MENU_PREFIX) ? id.slice(MENU_PREFIX.length) : null;
}
