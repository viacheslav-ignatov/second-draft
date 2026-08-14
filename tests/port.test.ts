/**
 * Port protocol.
 *
 * These cover the two bugs that actually shipped: replies from a superseded run
 * landing in the panel, and a generation continuing after the panel closed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { resetSessions } from "../src/background/ai/sessions.ts";
import { registerPort } from "../src/background/port.ts";
import { clearGlobals, fakePort, installChrome, installLanguageModel } from "./helpers/doubles.ts";

/**
 * `registerPort` attaches to whichever `chrome` stub is current, so each case
 * gets a fresh listener. Sessions are module-level and must be cleared, or a
 * session built against the previous case's fake model is reused.
 */
function startWorker(): void {
  resetSessions();
  registerPort();
}

const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

const runRequest = (id: number, presetId = "shorter") => ({
  type: "run" as const,
  id,
  presetId,
  text: "This sentence is quite a lot longer than it really needs to be.",
  language: { code: "en", name: "English", confidence: 0.99 },
});

test.afterEach(() => {
  clearGlobals();
  resetSessions();
});

test("a reply carries the id of the request that caused it", async () => {
  const chrome = installChrome();
  installLanguageModel({ chunks: ["done"] });
  startWorker();

  const connection = fakePort();
  chrome.connect(connection.port);
  connection.receive(runRequest(7));
  await settle(20);

  assert.ok(connection.sent.length > 0, "the worker replied");
  for (const reply of connection.sent) {
    assert.equal(reply.id, 7, `every reply is tagged: ${JSON.stringify(reply)}`);
  }
  assert.equal(connection.sent.at(-1)?.type, "done");
});

test("a second run aborts the first instead of interleaving output", async () => {
  const chrome = installChrome();
  const model = installLanguageModel({ chunks: ["a", "b", "c", "d"], delayMs: 10 });
  startWorker();

  const connection = fakePort();
  chrome.connect(connection.port);

  connection.receive(runRequest(1));
  await settle(15); // let the first run get going
  connection.receive(runRequest(2));
  await settle(80);

  assert.ok(model.aborted(), "the first generation saw the abort signal");

  const firstRunFinished = connection.sent.some((r) => r.id === 1 && r.type === "done");
  assert.equal(firstRunFinished, false, "the superseded run never reports done");

  const secondRunFinished = connection.sent.some((r) => r.id === 2 && r.type === "done");
  assert.equal(secondRunFinished, true, "the current run does");
});

test("closing the panel cancels the generation", async () => {
  const chrome = installChrome();
  const model = installLanguageModel({ chunks: ["a", "b", "c"], delayMs: 10 });
  startWorker();

  const connection = fakePort();
  chrome.connect(connection.port);
  connection.receive(runRequest(1));
  await settle(15);
  connection.disconnect();
  await settle(60);

  assert.ok(model.aborted(), "disconnecting aborts the run");
  assert.equal(
    connection.sent.some((r) => r.type === "done"),
    false,
    "an aborted run does not report done",
  );
});

test("an unknown preset is an error, not a crash", async () => {
  const chrome = installChrome();
  installLanguageModel();
  startWorker();

  const connection = fakePort();
  chrome.connect(connection.port);
  connection.receive({ ...runRequest(3), presetId: "does-not-exist" });
  await settle(20);

  assert.deepEqual(
    connection.sent.map((r) => r.type),
    ["error"],
  );
  assert.equal(connection.sent[0]?.text, "errUnknownPreset");
});

test("empty input is rejected before any model is touched", async () => {
  const chrome = installChrome();
  installLanguageModel();
  startWorker();

  const connection = fakePort();
  chrome.connect(connection.port);
  connection.receive({ ...runRequest(4), text: "   " });
  await settle(20);

  assert.equal(connection.sent[0]?.text, "errNothing");
});

test("input too long for any route is refused before one is chosen", async () => {
  const chrome = installChrome();
  installLanguageModel();
  startWorker();

  const connection = fakePort();
  chrome.connect(connection.port);
  // "shorter" would otherwise go to the Rewriter, which used to skip the check.
  connection.receive({ ...runRequest(5), text: "x".repeat(5000) });
  await settle(20);

  assert.equal(connection.sent[0]?.text, "errTooLong");
});

test("an English-only preset is refused on confidently non-English text", async () => {
  const chrome = installChrome();
  installLanguageModel();
  startWorker();

  const connection = fakePort();
  chrome.connect(connection.port);
  connection.receive({
    ...runRequest(6, "english"),
    language: { code: "ru", name: "Russian", confidence: 0.99 },
  });
  await settle(20);

  assert.equal(connection.sent[0]?.type, "error");
});

test("a port with another name is ignored", async () => {
  const chrome = installChrome();
  installLanguageModel();
  startWorker();

  const connection = fakePort("something-else");
  chrome.connect(connection.port);
  connection.receive(runRequest(1));
  await settle(20);

  assert.deepEqual(connection.sent, []);
});
