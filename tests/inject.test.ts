/**
 * On-demand injection and delivery.
 *
 * The interesting part is the addressing. The menu path knows exactly which
 * frame was right-clicked and targets it; the keyboard path does not and has to
 * broadcast. Getting that backwards is invisible on an ordinary page and only
 * shows up on one with an iframe — as two panels, or as none.
 *
 * The rest is what happens on a page Chrome refuses to inject into: `chrome://`,
 * the Web Store, the PDF viewer. Doing nothing there looks like a broken
 * extension, so it has to say something.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { dispatchToTab } from "../src/background/inject.ts";
import type { TabMessage, TabMessageBody } from "../src/shared/messages.ts";
import { clearGlobals, installChrome } from "./helpers/doubles.ts";

interface Injection {
  target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
  files: string[];
}

interface Delivery {
  tabId: number;
  message: TabMessage;
  options: { frameId?: number };
}

interface Log {
  order: string[];
  scripts: Injection[];
  messages: Delivery[];
  badges: { tabId: number; text: string }[];
  colours: { tabId: number; color: string }[];
}

interface StubOptions {
  /** The page refuses injection, as `chrome://` and the Web Store do. */
  injectFails?: boolean;
  /** Nothing is listening — the tab navigated away between the two calls. */
  deliveryFails?: boolean;
  /** The tab closed before the badge could be set. */
  badgeFails?: boolean;
}

function installTabApis(options: StubOptions = {}): Log {
  installChrome();
  const log: Log = {
    order: [],
    scripts: [],
    messages: [],
    badges: [],
    colours: [],
  };

  const chrome = (globalThis as Record<string, unknown>).chrome as Record<
    string,
    unknown
  >;

  chrome.scripting = {
    executeScript: (injection: Injection) => {
      log.order.push("inject");
      log.scripts.push(injection);
      return options.injectFails
        ? Promise.reject(new Error("Cannot access contents of the page"))
        : Promise.resolve([]);
    },
  };

  chrome.tabs = {
    sendMessage: (
      tabId: number,
      message: TabMessage,
      opts: { frameId?: number },
    ) => {
      log.order.push("send");
      log.messages.push({ tabId, message, options: opts });
      return options.deliveryFails
        ? Promise.reject(new Error("Receiving end does not exist"))
        : Promise.resolve(undefined);
    },
  };

  chrome.action = {
    setBadgeText: (details: { tabId: number; text: string }) => {
      log.badges.push(details);
      return options.badgeFails
        ? Promise.reject(new Error("No tab with id"))
        : Promise.resolve();
    },
    setBadgeBackgroundColor: (details: { tabId: number; color: string }) => {
      log.colours.push(details);
      return Promise.resolve();
    },
  };

  return log;
}

const picker: TabMessageBody = { type: "SHOW_PICKER" };
const rewrite: TabMessageBody = {
  type: "REWRITE_WITH",
  presetId: "shorter",
  selectionText: "some text",
};

/** The same rewrite as the content script receives it. */
const delivered = (broadcast: boolean): TabMessage => ({
  ...rewrite,
  broadcast,
});

test.afterEach(() => {
  clearGlobals();
});

test("a frame id reaches exactly that frame", async () => {
  const log = installTabApis();

  await dispatchToTab(7, rewrite, 3);

  assert.deepEqual(log.scripts, [
    { target: { tabId: 7, frameIds: [3] }, files: ["content.js"] },
  ]);
  assert.deepEqual(
    log.messages,
    [{ tabId: 7, message: delivered(false), options: { frameId: 3 } }],
    "the message is addressed too — injecting one frame and shouting at all of them would still open two panels",
  );
});

test("the top-level frame is an id like any other", async () => {
  const log = installTabApis();

  // `contextMenus.onClicked` reports 0 for the top document, and 0 must not be
  // read as "no frame given".
  await dispatchToTab(7, rewrite, 0);

  assert.deepEqual(log.scripts[0]?.target, { tabId: 7, frameIds: [0] });
  assert.deepEqual(log.messages[0]?.options, { frameId: 0 });
});

test("without a frame id the message is broadcast", async () => {
  const log = installTabApis();

  await dispatchToTab(7, picker);

  assert.deepEqual(log.scripts, [
    { target: { tabId: 7, allFrames: true }, files: ["content.js"] },
  ]);
  assert.deepEqual(
    log.messages,
    [{ tabId: 7, message: picker, options: {} }],
    "the frames sort it out between themselves via ownsFocus()",
  );
});

test("a rewrite carries how it was delivered", async () => {
  const addressed = installTabApis();
  await dispatchToTab(7, rewrite, 3);
  assert.deepEqual(
    addressed.messages[0]?.message,
    delivered(false),
    "aimed at a frame, so that frame should not second-guess it",
  );

  clearGlobals();

  // Chrome omits `frameId` only when it could not identify the frame at all.
  // The message then goes to every frame, and it has to say so — otherwise
  // every frame with a field would open a panel.
  const shouted = installTabApis();
  await dispatchToTab(7, rewrite);
  assert.deepEqual(shouted.messages[0]?.message, delivered(true));
  assert.deepEqual(
    shouted.scripts[0]?.target,
    { tabId: 7, allFrames: true },
    "and the panel is injected everywhere it might be needed",
  );
});

test("injection comes before delivery", async () => {
  const log = installTabApis();

  await dispatchToTab(7, picker);

  assert.deepEqual(
    log.order,
    ["inject", "send"],
    "a message sent before the script is in place has nobody to receive it",
  );
});

test("a page that refuses injection gets a badge and no message", async (t) => {
  // Mocked, so the badge-clearing timer does not outlive the case and fire
  // against a `chrome` that `afterEach` has already taken away.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const log = installTabApis({ injectFails: true });

  await dispatchToTab(7, picker);

  assert.deepEqual(log.messages, [], "there is no content script to talk to");
  assert.deepEqual(log.badges, [{ tabId: 7, text: "!" }]);
  assert.deepEqual(log.colours, [{ tabId: 7, color: "#cf222e" }]);
});

test("the badge clears itself", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const log = installTabApis({ injectFails: true });

  await dispatchToTab(7, picker);
  assert.deepEqual(log.badges, [{ tabId: 7, text: "!" }], "still showing");

  // Mirrors BADGE_CLEAR_MS, which the module keeps to itself.
  t.mock.timers.tick(4000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    log.badges.at(-1),
    { tabId: 7, text: "" },
    "a permanent '!' would read as a broken extension",
  );
});

test("a tab that closes mid-dispatch is not an error", async () => {
  // Both are races with the user closing the tab, and neither is worth an
  // unhandled rejection in the service worker.
  installTabApis({ deliveryFails: true });
  await assert.doesNotReject(
    dispatchToTab(7, picker),
    "nothing was listening any more",
  );

  clearGlobals();

  installTabApis({ injectFails: true, badgeFails: true });
  await assert.doesNotReject(
    dispatchToTab(7, picker),
    "the tab went away before the badge could be set",
  );
});
