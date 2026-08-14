/**
 * The coordination layer.
 *
 * Everything the panel does between "something asked for a rewrite" and "the
 * text is in the field" is decided here, and until now none of it was covered:
 * which presets wait for language detection, whether the lost-undo warning is
 * ever actually on screen, which message a failed insertion produces, and which
 * frame answers at all.
 *
 * No DOM and no `panel.ts` — the controller takes its collaborators through
 * `ControllerDeps`, which is the whole reason it is a module rather than a
 * closure inside the entry point.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createController,
  type ControllerDeps,
} from "../src/content/controller.ts";
import type {
  DetectedLanguage,
  PresetSummary,
} from "../src/shared/messages.ts";
import type { InsertResult, Target } from "../src/content/target.ts";
import type { PanelCallbacks } from "../src/content/panel.ts";
import { clearGlobals, installChrome } from "./helpers/doubles.ts";

const ENGLISH: DetectedLanguage = {
  code: "en",
  name: "English",
  confidence: 0.99,
};
const RUSSIAN: DetectedLanguage = {
  code: "ru",
  name: "Russian",
  confidence: 0.98,
};

const preset = (
  id: string,
  over: Partial<PresetSummary> = {},
): PresetSummary => ({
  id,
  label: id,
  englishOnly: false,
  nonEnglishOnly: false,
  needsLanguage: false,
  ...over,
});

const aTarget = (text = "some text"): Target => ({
  // The controller never touches the element; insertion is a dependency.
  el: {} as HTMLElement,
  contentEditable: false,
  text,
  wholeField: true,
  start: 0,
  end: text.length,
  snapshot: text,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

interface HarnessOptions {
  presets?: PresetSummary[];
  target?: Target | null;
  insertResult?: InsertResult;
  field?: () => HTMLElement | null;
  ownsFocus?: boolean;
  claimedByMenu?: boolean;
  /**
   * Hold the detection open so a case can decide when it answers. Off by
   * default: a case that does not care should not be able to hang the file if
   * the controller ever starts waiting where it should not.
   */
  manualDetect?: boolean;
}

function harness(options: HarnessOptions = {}) {
  installChrome();

  const events: string[] = [];
  const status: [string, boolean][] = [];
  const runs: [string, string][] = [];
  const detects: string[] = [];
  const delays: { fn: () => void; ms: number }[] = [];
  const inserted: string[] = [];

  let callbacks: PanelCallbacks | null = null;
  let language: DetectedLanguage | null = null;
  let settleDetect: ((value: DetectedLanguage | null) => void) | null = null;

  const deps: ControllerDeps = {
    createPanel: (cb) => {
      callbacks = cb;
      return {
        open: () => events.push("open"),
        close: () => events.push("close"),
        renderChips: (list, enabled) =>
          events.push(
            `chips:${list
              .filter(enabled)
              .map((p) => p.id)
              .join(",")}`,
          ),
        setSelected: (id) => events.push(`selected:${id ?? "none"}`),
        setLanguage: (text) => events.push(`language:${text}`),
        setOriginal: (_text, title) => events.push(`original:${title}`),
        setDraft: () => undefined,
        setStatus: (text, isError = false) => {
          status.push([text, isError]);
          events.push(`status:${text}`);
        },
        setBusy: (busy) => events.push(`busy:${String(busy)}`),
        enableRetry: () => undefined,
        focusFirstChip: () => events.push("focusFirstChip"),
        focusInsert: () => events.push("focusInsert"),
        selectDraft: () => events.push("selectDraft"),
      };
    },

    createClient: () => ({
      prewarm: () => events.push("prewarm"),
      detect: (text) => {
        detects.push(text);
        if (!options.manualDetect) return Promise.resolve(language);
        return new Promise((resolve) => (settleDetect = resolve));
      },
      run: (presetId, text) => {
        runs.push([presetId, text]);
      },
      get detectedLanguage() {
        return language;
      },
      reset: () => {
        language = null;
      },
      disconnect: () => events.push("disconnect"),
    }),

    capture: () => (options.target === undefined ? aTarget() : options.target),
    insert: (_target, text) => {
      inserted.push(text);
      return options.insertResult ?? { ok: true, undoLost: false };
    },
    field: options.field ?? (() => ({}) as HTMLElement),
    ownsFocus: () => options.ownsFocus ?? true,
    claimedByMenu: () => options.claimedByMenu ?? false,

    loadPresets: () => Promise.resolve(options.presets ?? [preset("shorter")]),
    copyText: () => Promise.resolve(),
    delay: (fn, ms) => delays.push({ fn, ms }),
  };

  return {
    controller: createController(deps),
    events,
    status,
    runs,
    detects,
    delays,
    inserted,
    get callbacks(): PanelCallbacks {
      assert.ok(callbacks, "the panel was built");
      return callbacks;
    },
    /** Answers the detection that is in flight. */
    settle(value: DetectedLanguage | null) {
      language = value;
      settleDetect?.(value);
      settleDetect = null;
    },
    said: (text: string) => status.some(([said]) => said === text),
  };
}

const rewrite = (presetId: string) =>
  ({ type: "REWRITE_WITH", presetId, selectionText: "" }) as const;

test.afterEach(() => {
  clearGlobals();
});

test("a language-agnostic preset starts generating without waiting", async () => {
  const h = harness({ presets: [preset("shorter")], manualDetect: true });

  // Started rather than awaited, and the detection is never answered. Awaiting
  // here would hang on a regression and node:test would cancel the whole file,
  // which points at eleven tests instead of this one.
  let handled = false;
  void h.controller
    .handleMessage(rewrite("shorter"))
    .then(() => (handled = true));
  await flush();

  assert.equal(handled, true, "the wait for detection was not on the path");
  assert.deepEqual(h.runs, [["shorter", "some text"]]);
  assert.deepEqual(
    h.detects,
    ["some text"],
    "detection still runs — it fills the language line and greys out chips",
  );
  assert.equal(
    h.said("statusCheckingLanguage"),
    false,
    "and the user is never shown a wait that is not happening",
  );
});

test("a gated preset waits for the language before generating", async () => {
  const h = harness({
    presets: [preset("english", { needsLanguage: true, englishOnly: true })],
    manualDetect: true,
  });

  const handled = h.controller.handleMessage(rewrite("english"));
  await flush();

  assert.deepEqual(h.runs, [], "nothing is sent while the language is unknown");
  assert.equal(h.said("statusCheckingLanguage"), true);

  h.settle(ENGLISH);
  await handled;

  assert.deepEqual(h.runs, [["english", "some text"]]);
});

test("a gated preset on the wrong language never reaches the worker", async () => {
  const h = harness({
    presets: [preset("english", { needsLanguage: true, englishOnly: true })],
    manualDetect: true,
  });

  const handled = h.controller.handleMessage(rewrite("english"));
  await flush();
  h.settle(RUSSIAN);
  await handled;

  assert.deepEqual(h.runs, [], "the model is not asked to fix Russian English");
  assert.deepEqual(
    h.status.at(-1),
    ["errEnglishOnlyHint", true],
    "and the panel says why, as an error",
  );
  assert.equal(
    h.events.at(-2),
    "busy:false",
    "the buttons come back, so Retry is reachable",
  );
});

test("the lost-undo warning is on screen before the panel closes", async () => {
  const h = harness({ insertResult: { ok: true, undoLost: true } });
  await h.controller.handleMessage(rewrite("shorter"));
  h.events.length = 0;

  h.callbacks.onInsert("the draft");

  assert.equal(h.said("statusInsertedNoUndo"), true);
  assert.equal(
    h.events.includes("close"),
    false,
    "closing in the same frame would have wiped the warning unread",
  );
  assert.equal(
    h.events.includes("busy:true"),
    true,
    "and a second Insert cannot land while the panel waits",
  );

  assert.equal(h.delays.length, 1);
  h.delays[0]!.fn();
  assert.equal(h.events.includes("close"), true);
});

test("an insert that succeeds with undo intact closes immediately", async () => {
  const h = harness({ insertResult: { ok: true, undoLost: false } });
  await h.controller.handleMessage(rewrite("shorter"));

  h.callbacks.onInsert("the draft");

  assert.equal(h.said("statusInsertedNoUndo"), false);
  assert.deepEqual(h.delays, [], "nothing to wait for");
  assert.equal(h.events.includes("close"), true);
});

test("a field that moved on gets its own message, and the panel stays open", async () => {
  const stale = harness({
    insertResult: { ok: false, undoLost: false, stale: true },
  });
  await stale.controller.handleMessage(rewrite("shorter"));
  stale.events.length = 0;
  stale.callbacks.onInsert("the draft");

  assert.deepEqual(stale.status.at(-1), ["errFieldChanged", true]);
  assert.equal(
    stale.events.includes("close"),
    false,
    "the draft is still in the textarea and Copy is the way out",
  );

  const refused = harness({ insertResult: { ok: false, undoLost: false } });
  await refused.controller.handleMessage(rewrite("shorter"));
  refused.callbacks.onInsert("the draft");

  assert.deepEqual(
    refused.status.at(-1),
    ["errNoInsert", true],
    "a field that simply cannot be written to reads differently",
  );
});

test("a frame with no editable field answers nothing", async () => {
  const h = harness({ field: () => null });

  await h.controller.handleMessage(rewrite("shorter"));
  await h.controller.handleMessage({ type: "SHOW_PICKER" });

  assert.deepEqual(h.events, [], "the panel never opened");
  assert.deepEqual(h.runs, []);
});

test("the menu claim stands in for focus, the keyboard command does not", async () => {
  const unfocused = harness({ ownsFocus: false, claimedByMenu: false });
  await unfocused.controller.handleMessage(rewrite("shorter"));
  assert.deepEqual(unfocused.runs, [], "no claim on this frame at all");

  const clicked = harness({ ownsFocus: false, claimedByMenu: true });
  await clicked.controller.handleMessage(rewrite("shorter"));
  assert.deepEqual(
    clicked.runs,
    [["shorter", "some text"]],
    "a right-click here is a stronger claim than focus",
  );

  const picker = harness({ ownsFocus: false, claimedByMenu: true });
  await picker.controller.handleMessage({ type: "SHOW_PICKER" });
  assert.deepEqual(
    picker.events,
    [],
    "but the keyboard command only answers where the focus is",
  );
});

test("an empty field opens nothing", async () => {
  const h = harness({ target: aTarget("   ") });

  await h.controller.handleMessage(rewrite("shorter"));

  assert.deepEqual(h.events, []);
  assert.deepEqual(h.runs, []);
});

test("the picker warms the model and detects without generating", async () => {
  const h = harness();

  await h.controller.handleMessage({ type: "SHOW_PICKER" });

  assert.deepEqual(h.runs, [], "nothing is chosen yet");
  assert.equal(h.events.includes("prewarm"), true);
  assert.deepEqual(h.detects, ["some text"]);
  assert.equal(h.said("statusPickPreset"), true);
  assert.equal(
    h.events.includes("focusFirstChip"),
    true,
    "the chips are reachable without tabbing through the page",
  );
});

test("editing presets re-renders the chips without a reload", async () => {
  const h = harness({
    presets: [preset("shorter"), preset("custom:house")],
  });

  await h.controller.presetsChanged();

  assert.equal(
    h.events.at(-1),
    "chips:shorter,custom:house",
    "the new list is on screen",
  );
});
