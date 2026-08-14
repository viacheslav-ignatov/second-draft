/**
 * Content script entry point.
 *
 * Injected on demand: the keyboard command reaches every frame of the tab and
 * only the one holding the field answers, while the menu path is addressed at a
 * single frame. Wiring only — the decisions live in `controller.ts`, capture in
 * `target.ts`, rendering in `panel.ts`, the protocol in `client.ts`.
 */

import type { TabMessage } from "../shared/messages.ts";
import { WorkerClient } from "./client.ts";
import { createController } from "./controller.ts";
import { Panel } from "./panel.ts";
import {
  capture,
  claimedByMenu,
  field,
  insert,
  ownsFocus,
  trackFocus,
} from "./target.ts";

declare global {
  interface Window {
    __secondDraftLoaded?: boolean;
  }
}

// Injection is repeated on every invocation, so guard against a second copy
// installing a second set of listeners.
if (!window.__secondDraftLoaded) {
  window.__secondDraftLoaded = true;
  main();
}

function main(): void {
  trackFocus();

  const controller = createController({
    createPanel: (callbacks) => new Panel(callbacks),
    createClient: (handlers) => new WorkerClient(handlers),
    capture,
    insert,
    field,
    ownsFocus,
    claimedByMenu,
    loadPresets: async () =>
      (await chrome.runtime.sendMessage({ type: "GET_PRESETS" })) ?? [],
    copyText: (text) => navigator.clipboard.writeText(text),
    delay: (fn, ms) => {
      setTimeout(fn, ms);
    },
  });

  // Editing presets in the options page must not require reloading every tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area !== "sync" ||
      !Object.keys(changes).some((key) => key.startsWith("preset:"))
    )
      return;
    void controller.presetsChanged();
  });

  chrome.runtime.onMessage.addListener((message: TabMessage) => {
    // Not returned: a promise handed back to `onMessage` is taken as a reply,
    // and nothing is waiting for one here.
    void controller.handleMessage(message);
  });
}
