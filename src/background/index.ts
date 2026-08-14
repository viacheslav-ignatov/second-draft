/**
 * Service worker entry point.
 *
 * Wiring only: lifecycle events, the two entry points, the port, and the
 * one-shot message handlers. Everything with logic in it lives in a module.
 */

import { isPresetKey, migrateLegacyPresets } from "../shared/preset-storage.ts";
import type { RuntimeMessage, StateResponse } from "../shared/messages.ts";
import {
  availabilityOf,
  isUsable,
  needsDownload,
  resolveGlobal,
} from "./ai/availability.ts";
import { dispatchToTab } from "./inject.ts";
import { buildMenus, presetIdFromMenuItem } from "./menus.ts";
import { allPresets, summarize } from "./presets.ts";
import { registerPort } from "./port.ts";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void (async () => {
    if (reason === "update") await migrateLegacyPresets();
    await buildMenus();
    // Without this the extension installs, nothing visible happens, and the
    // user removes it before ever finding the shortcut.
    if (reason === "install") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
    }
  })();
});

chrome.runtime.onStartup.addListener(() => void buildMenus());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.keys(changes).some(isPresetKey))
    void buildMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const presetId = presetIdFromMenuItem(info.menuItemId);
  if (!presetId || !tab?.id) return;
  void dispatchToTab(tab.id, {
    type: "REWRITE_WITH",
    presetId,
    selectionText: info.selectionText ?? "",
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-picker") return;
  void (async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) await dispatchToTab(tab.id, { type: "SHOW_PICKER" });
  })();
});

registerPort();

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
    if (message?.type === "GET_PRESETS") {
      void allPresets().then((presets) => {
        sendResponse(summarize(presets));
      });
      return true;
    }
    if (message?.type === "GET_STATE") {
      void (async () => {
        const api = resolveGlobal<object>("LanguageModel");
        const state = await availabilityOf(api);
        const response: StateResponse = {
          state: isUsable(state)
            ? "ready"
            : needsDownload(state)
              ? "downloadable"
              : "unavailable",
        };
        sendResponse(response);
      })();
      return true;
    }
    return false;
  },
);
