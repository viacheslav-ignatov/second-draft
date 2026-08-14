/**
 * Field capture and insertion.
 *
 * The most fragile code in the project and the only part that touches the page,
 * so it gets a real DOM rather than a mock. `execCommand` does not exist in
 * happy-dom, which conveniently exercises the value-setter fallback — the path
 * where undo is lost and the panel has to say so.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import type * as TargetModule from "../src/content/target.ts";

/**
 * Installs a fresh document, then imports the module against it.
 *
 * happy-dom's types are structurally compatible with lib.dom but not identical,
 * so they are cast once here rather than at every call site in the tests.
 */
async function withDom(html: string) {
  const window = new Window({ url: "https://example.test/" });
  window.document.body.innerHTML = html;

  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.HTMLInputElement = window.HTMLInputElement;
  globals.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globals.Event = window.Event;
  globals.Range = window.Range;

  // A fresh module instance per case, since focus tracking is module state.
  const target = (await import(
    `../src/content/target.ts?case=${Math.random()}`
  )) as typeof TargetModule;

  return {
    document: window.document as unknown as Document,
    target,
  };
}

/**
 * Identity rather than equality.
 *
 * `assert.equal` builds a diff of both values when it fails, and a happy-dom
 * node expands into a tree big enough to take the whole process out with it —
 * the run dies on SIGKILL instead of naming the test that broke. Comparing
 * first and asserting a boolean keeps a failure reportable.
 */
function isNode(actual: unknown, expected: unknown, message: string): void {
  assert.ok(actual === expected, message);
}

/** Typed lookup, since every case knows what element it just wrote. */
function el<T extends HTMLElement>(document: Document, id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

test("a disabled or read-only field is not editable", async () => {
  const { document, target } = await withDom(`
    <textarea id="plain"></textarea>
    <textarea id="ro" readonly></textarea>
    <input id="disabled" type="text" disabled>
    <input id="checkbox" type="checkbox">
    <input id="email" type="email">
    <div id="rich" contenteditable="true"></div>
    <p id="prose">not a field</p>
  `);

  const editable = (id: string) => target.isEditable(el(document, id));

  assert.equal(editable("plain"), true);
  assert.equal(editable("ro"), false);
  assert.equal(editable("disabled"), false);
  assert.equal(editable("checkbox"), false, "a checkbox holds no prose");
  assert.equal(editable("email"), true, "an email field does");
  assert.equal(editable("rich"), true);
  assert.equal(editable("prose"), false);
});

test("capture takes the whole field when nothing is selected", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  const textarea = el<HTMLTextAreaElement>(document, "t");
  textarea.value = "the whole thing";
  textarea.focus();

  const captured = target.capture();
  assert.equal(captured?.text, "the whole thing");
  assert.equal(captured?.wholeField, true);
  assert.equal(captured?.start, 0);
  assert.equal(captured?.end, "the whole thing".length);
});

test("capture takes only the selection when there is one", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  const textarea = el<HTMLTextAreaElement>(document, "t");
  textarea.value = "keep this part";
  textarea.focus();
  textarea.setSelectionRange(5, 9);

  const captured = target.capture();
  assert.equal(captured?.text, "this");
  assert.equal(captured?.wholeField, false);
});

test("the last edited field is remembered after focus moves away", async () => {
  const { document, target } = await withDom(`
    <textarea id="t"></textarea><button id="b">elsewhere</button>
  `);
  target.trackFocus();

  const textarea = el<HTMLTextAreaElement>(document, "t");
  textarea.value = "typed earlier";
  textarea.focus();
  el(document, "b").focus();

  // This is the context-menu case: focus has moved, the field has not.
  isNode(
    target.field(),
    textarea,
    "the last edited field, not the focused one",
  );
  assert.equal(target.capture()?.text, "typed earlier");
});

test("a right-clicked field is remembered without ever being focused", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  target.trackFocus();
  isNode(target.field(), null, "nothing pointed at yet");

  const textarea = document.getElementById("t") as unknown as HTMLElement;
  // Deliberately no focus() call: a right-click does not reliably leave focus
  // behind, and by the time the menu item is clicked `activeElement` is no help
  // either. This listener is the only thing that knows what the user aimed at.
  // happy-dom's Event is structurally close enough for the listener under test.
  textarea.dispatchEvent(new Event("contextmenu", { bubbles: true }));

  isNode(target.field(), textarea, "the field the user pointed at");
});

test("a parent document does not claim focus while an iframe holds it", async () => {
  const { document, target } = await withDom(`
    <textarea id="t"></textarea><iframe id="f"></iframe>
  `);
  target.trackFocus();
  el(document, "t").focus();
  assert.equal(target.ownsFocus(), true);

  el(document, "f").focus();
  assert.equal(target.ownsFocus(), false, "the child frame owns it, not us");
});

test("insertion replaces the captured range and reports lost undo", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  const textarea = el<HTMLTextAreaElement>(document, "t");
  textarea.value = "keep this part";
  textarea.focus();
  textarea.setSelectionRange(5, 9);

  const captured = target.capture();
  assert.ok(captured);
  const result = target.insert(captured, "that");

  assert.equal(result.ok, true);
  assert.equal(textarea.value, "keep that part");
  // happy-dom has no execCommand, so the fallback runs — exactly the case where
  // Cmd+Z stops working and the user has to be told.
  assert.equal(result.undoLost, true);
});

test("insertion fires the events a controlled input listens for", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  const textarea = el<HTMLTextAreaElement>(document, "t");
  textarea.value = "before";
  textarea.focus();

  const seen: string[] = [];
  textarea.addEventListener("input", () => seen.push("input"));
  textarea.addEventListener("change", () => seen.push("change"));

  const captured = target.capture();
  target.insert(captured!, "after");

  assert.deepEqual(
    seen,
    ["input", "change"],
    "a React-controlled field needs both",
  );
});

test("a field edited during generation is left alone", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  const textarea = el<HTMLTextAreaElement>(document, "t");
  textarea.value = "keep this part";
  textarea.focus();
  textarea.setSelectionRange(5, 9);

  const captured = target.capture();
  assert.ok(captured);

  // The user kept typing while the model was thinking; offsets 5–9 no longer
  // mean what they meant at capture.
  textarea.value = "I changed my mind and typed something else entirely";

  const result = target.insert(captured, "that");

  assert.equal(result.ok, false);
  assert.equal(result.stale, true, "and says why, so the panel can explain");
  assert.equal(
    textarea.value,
    "I changed my mind and typed something else entirely",
    "what the user typed is untouched",
  );
});

test("a contentEditable edited during generation is left alone", async () => {
  const { document, target } = await withDom(
    `<div id="rich" contenteditable="true">keep this part</div>`,
  );
  const rich = el(document, "rich");
  rich.focus();

  const captured = target.capture();
  assert.ok(captured);
  assert.equal(captured.contentEditable, true);
  assert.equal(captured.wholeField, true, "no selection: the whole field");

  // The user kept typing while the model was thinking. Without the check this
  // path selects the whole field and replaces it, taking the new text with it.
  rich.innerHTML = "I changed my mind and typed something else";

  const result = target.insert(captured, "that");

  assert.equal(result.ok, false);
  assert.equal(result.stale, true, "and says why, so the panel can explain");
  assert.equal(
    rich.innerText,
    "I changed my mind and typed something else",
    "what the user typed is untouched",
  );
});

test("a re-rendered editor is caught even when the text is identical", async () => {
  const { document, target } = await withDom(
    `<div id="rich" contenteditable="true"><p id="para">hello there</p></div>`,
  );
  const rich = el(document, "rich");
  const para = el(document, "para");
  rich.focus();

  // Select inside the field, so the capture stores a range rather than falling
  // back to "the whole field".
  const range = document.createRange();
  range.selectNodeContents(para);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  const captured = target.capture();
  assert.ok(captured?.range, "a selection was captured as a range");

  // React and friends rebuild the subtree on every keystroke: same text, new
  // nodes. The snapshot cannot see this — only the range can.
  const replacement = para.cloneNode(true);
  para.remove();
  rich.appendChild(replacement);
  assert.equal(rich.innerText, "hello there", "the text really is unchanged");

  const result = target.insert(captured, "goodbye");

  assert.equal(result.ok, false);
  assert.equal(
    result.stale,
    true,
    "a range into discarded nodes would have inserted at the caret instead",
  );
});

test("a selection the browser refuses does not escape the click handler", async () => {
  const { document, target } = await withDom(
    `<div id="rich" contenteditable="true">unchanged text</div>`,
  );
  const rich = el(document, "rich");
  rich.focus();

  const captured = target.capture();
  assert.ok(captured);

  // Chrome throws from `addRange` for a range whose nodes have gone; happy-dom
  // is more forgiving, so the throw is staged. What matters is that `insert`
  // returns a result instead of letting the exception out of the panel's click
  // handler, where nothing would catch it and the press would look ignored.
  const stub = globalThis as unknown as { window: { getSelection: unknown } };
  stub.window.getSelection = () => ({
    removeAllRanges: () => undefined,
    addRange: () => {
      throw new Error("IndexSizeError: the range is not in the document");
    },
  });

  const result = target.insert(captured, "something");

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
});

test("an untouched contentEditable is not refused as stale", async () => {
  const { document, target } = await withDom(
    `<div id="rich" contenteditable="true">leave this alone</div>`,
  );
  const rich = el(document, "rich");
  rich.focus();

  const captured = target.capture();
  assert.ok(captured);

  // happy-dom has no execCommand, so this still fails — but on the insertion
  // itself, not on the staleness check. The flag is what tells them apart, and
  // it is what picks the message the user reads.
  const result = target.insert(captured, "something");

  assert.equal(result.ok, false);
  assert.notEqual(result.stale, true);
});

test("inserting into a field that has left the DOM fails cleanly", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  const textarea = el<HTMLTextAreaElement>(document, "t");
  textarea.value = "gone soon";
  textarea.focus();

  const captured = target.capture();
  textarea.remove();

  const result = target.insert(captured!, "anything");
  assert.equal(result.ok, false);
});
