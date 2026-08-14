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

export async function buildMenus(): Promise<void> {
  const presets = summarize(await allPresets());
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: t("menuRoot"),
    contexts: ["editable"],
  });
  for (const { id, label } of presets) {
    chrome.contextMenus.create({
      id: MENU_PREFIX + id,
      parentId: MENU_ROOT,
      title: menuTitle(label),
      contexts: ["editable"],
    });
  }
}

/** The preset id behind a menu item, or `null` if it is not one of ours. */
export function presetIdFromMenuItem(
  menuItemId: string | number,
): string | null {
  const id = String(menuItemId);
  return id.startsWith(MENU_PREFIX) ? id.slice(MENU_PREFIX.length) : null;
}
