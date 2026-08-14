/** The right-click entry point, rebuilt whenever the user's presets change. */

import { t } from "../shared/i18n.ts";
import { allPresets, summarize } from "./presets.ts";

export const MENU_ROOT = "second-draft";
export const MENU_PREFIX = `${MENU_ROOT}:`;

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
      title: label,
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
