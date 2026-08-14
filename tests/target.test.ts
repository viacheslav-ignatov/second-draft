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
  assert.equal(target.field(), textarea);
  assert.equal(target.capture()?.text, "typed earlier");
});

test("a frame only claims a menu invocation if it saw the right-click", async () => {
  const { document, target } = await withDom(`<textarea id="t"></textarea>`);
  target.trackFocus();
  assert.equal(target.claimedByMenu(), false, "no right-click yet");

  const textarea = document.getElementById("t") as unknown as HTMLElement;
  // happy-dom's Event is structurally close enough for the listener under test.
  textarea.dispatchEvent(new Event("contextmenu", { bubbles: true }));

  assert.equal(target.claimedByMenu(), true);
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

  assert.deepEqual(seen, ["input", "change"], "a React-controlled field needs both");
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
