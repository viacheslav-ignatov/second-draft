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

async function injectPanel(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
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
    setTimeout(() => void chrome.action.setBadgeText({ tabId, text: "" }).catch(noop), 4000);
  } catch {
    /* tab closed */
  }
}

/** Injects if needed, then broadcasts. Only the frame with the field replies. */
export async function dispatchToTab(tabId: number, message: TabMessage): Promise<void> {
  try {
    await injectPanel(tabId);
  } catch (error) {
    console.warn("[second-draft] injection refused", error);
    return flagUninjectable(tabId);
  }
  await chrome.tabs.sendMessage(tabId, message).catch(noop);
}
