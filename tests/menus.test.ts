/**
 * Context menu rebuilds.
 *
 * Saving presets writes a `remove` and a `set`, so two `storage.onChanged`
 * events arrive back to back and two rebuilds start. Before they were chained,
 * one rebuild's `removeAll()` could land between the other's `create()` calls
 * and Chrome refused the duplicate ids — into `runtime.lastError`, which nothing
 * was reading, so the menu just came out short.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { MENU_ROOT, buildMenus } from "../src/background/menus.ts";
import { clearGlobals, installChrome } from "./helpers/doubles.ts";

interface MenuLog {
  /** Ids currently in the menu, as Chrome would see them. */
  live: Set<string>;
  /** Every id `create()` was called with, in order. */
  created: string[];
  /** Ids Chrome would have refused because one was already live. */
  duplicates: string[];
}

/**
 * A `chrome.contextMenus` that behaves like the real one in the way that
 * matters: `removeAll` is asynchronous, and `create` refuses an id that is
 * already live by setting `runtime.lastError` rather than throwing.
 */
function installMenus(): MenuLog {
  const log: MenuLog = { live: new Set(), created: [], duplicates: [] };
  const chrome = (globalThis as Record<string, unknown>).chrome as {
    runtime: { lastError?: { message: string } };
    contextMenus: unknown;
  };

  chrome.contextMenus = {
    removeAll: async () => {
      // The await point is exactly where the second rebuild used to slip in.
      await Promise.resolve();
      log.live.clear();
    },
    create: (properties: { id: string }, callback?: () => void): string => {
      const { id } = properties;
      log.created.push(id);

      if (log.live.has(id)) {
        log.duplicates.push(id);
        chrome.runtime.lastError = {
          message: `Cannot create item with duplicate id ${id}`,
        };
      } else {
        log.live.add(id);
      }

      callback?.();
      delete chrome.runtime.lastError;
      return id;
    },
    onClicked: { addListener: () => undefined },
  };

  return log;
}

test.afterEach(() => {
  clearGlobals();
});

test("two rebuilds at once do not collide", async () => {
  installChrome();
  const log = installMenus();

  await Promise.all([buildMenus(), buildMenus()]);

  assert.deepEqual(log.duplicates, [], "no id was created while still live");
  assert.ok(log.live.has(MENU_ROOT), "the root survived both rebuilds");
  assert.equal(
    log.created.length,
    log.live.size * 2,
    "each rebuild created the whole menu exactly once",
  );
});

test("a rebuild after a failed one still runs", async () => {
  installChrome();
  const log = installMenus();

  // A tab closing mid-rebuild rejects `removeAll`; the chain must not stay
  // poisoned, or the menu never updates again for the rest of the session.
  const chrome = (globalThis as Record<string, unknown>).chrome as {
    contextMenus: { removeAll: () => Promise<void> };
  };
  const working = chrome.contextMenus.removeAll;
  chrome.contextMenus.removeAll = () => Promise.reject(new Error("tab closed"));

  await assert.rejects(buildMenus());

  chrome.contextMenus.removeAll = working;
  await buildMenus();

  assert.ok(log.live.has(MENU_ROOT), "the next rebuild went through");
  assert.deepEqual(log.duplicates, []);
});
