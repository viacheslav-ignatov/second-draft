/**
 * On-demand injection.
 *
 * The extension declares no host permissions and no content scripts. Both entry
 * points — the context menu item and the keyboard command — grant `activeTab`
 * for the tab the user acted on, which is enough to inject the panel there and
 * nowhere else. That is what lets the store listing read *no site access* while
 * the extension still works on every site.
 */

import type { TabMessage } from "../shared/messages.ts";

/** The tab may close mid-call; there is nothing to do about it. */
const noop = (): void => undefined;

/** Long enough to be noticed, short enough not to look permanent. */
const BADGE_CLEAR_MS = 4000;

async function injectPanel(tabId: number, frameId?: number): Promise<void> {
  await chrome.scripting.executeScript({
    target:
      frameId === undefined
        ? { tabId, allFrames: true }
        : { tabId, frameIds: [frameId] },
    files: ["content.js"],
  });
}

/**
 * There is no page to talk to on `chrome://` pages, the Web Store, or the PDF
 * viewer. Injection throws there; say so on the badge rather than doing nothing.
 */
async function flagUninjectable(tabId: number): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#cf222e" });
    setTimeout(() => {
      // Nothing awaits this one. `.catch` covers a rejected promise, but an
      // invalidated extension context throws synchronously instead, and an
      // exception raised inside a timer has nowhere to go.
      try {
        void chrome.action.setBadgeText({ tabId, text: "" }).catch(noop);
      } catch {
        /* the tab, or the extension itself, is gone */
      }
    }, BADGE_CLEAR_MS);
  } catch {
    /* tab closed */
  }
}

/**
 * Injects if needed, then delivers.
 *
 * With a `frameId` — which `contextMenus.onClicked` supplies, since Chrome knows
 * exactly which frame was right-clicked — only that frame is touched. Without
 * one, as on the keyboard path, the message is broadcast and the frames sort it
 * out between themselves via `ownsFocus()`.
 */
export async function dispatchToTab(
  tabId: number,
  message: TabMessage,
  frameId?: number,
): Promise<void> {
  try {
    await injectPanel(tabId, frameId);
  } catch (error) {
    console.warn("[second-draft] injection refused", error);
    return flagUninjectable(tabId);
  }
  await chrome.tabs
    .sendMessage(tabId, message, frameId === undefined ? {} : { frameId })
    .catch(noop);
}
