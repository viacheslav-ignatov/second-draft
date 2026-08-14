/**
 * The panel's end of the port.
 *
 * The case worth covering is two detections in flight at once, which is routine
 * on the first run while the language pack downloads: the picker starts one, and
 * the user clicks a chip before it answers. A single pending slot let the first
 * request's timeout consume the second request's resolver, so the second promise
 * never settled and `run()` sat on "checking the language" with every button —
 * including Retry — disabled until the panel was closed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { WorkerClient } from "../src/content/client.ts";
import type {
  DetectedLanguage,
  PortReply,
  PortRequest,
} from "../src/shared/messages.ts";
import { clearGlobals } from "./helpers/doubles.ts";

/** Mirrors `DETECT_TIMEOUT_MS`, which the module keeps to itself. */
const DETECT_TIMEOUT_MS = 3000;

const RUSSIAN: DetectedLanguage = {
  code: "ru",
  name: "Russian",
  confidence: 0.98,
};
const ENGLISH: DetectedLanguage = {
  code: "en",
  name: "English",
  confidence: 0.99,
};

/**
 * A client wired to a port the test drives from the other end.
 *
 * `chrome.runtime.connect` is read at call time, so installing the stub before
 * the first request is enough.
 */
function connectClient() {
  const sent: PortRequest[] = [];
  const inbox: ((reply: PortReply) => void)[] = [];
  const done: [string, string][] = [];
  const status: [string, boolean][] = [];

  const port = {
    name: "second-draft",
    postMessage: (request: PortRequest) => sent.push(request),
    onMessage: {
      addListener: (fn: (reply: PortReply) => void) => inbox.push(fn),
    },
    onDisconnect: { addListener: () => undefined },
    disconnect: () => undefined,
  };

  (globalThis as Record<string, unknown>).chrome = {
    runtime: { connect: () => port },
  };

  const client = new WorkerClient({
    onStatus: (text, isError = false) => status.push([text, isError]),
    onChunk: () => undefined,
    onDone: (text, label) => done.push([text, label]),
    onWarm: () => undefined,
  });

  return {
    client,
    sent,
    done,
    status,
    reply: (reply: PortReply) => inbox.forEach((fn) => fn(reply)),
  };
}

/**
 * Records how a promise settled without ever awaiting it, so a request that
 * never settles fails an assertion instead of hanging the suite.
 */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value: T | undefined } = {
    settled: false,
    value: undefined,
  };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

/** Drains the microtask queue; `setImmediate` is not among the mocked timers. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test.afterEach(() => {
  clearGlobals();
});

test("two detections in flight both settle", async () => {
  const { client, sent, reply } = connectClient();

  const first = track(client.detect("Это первый вариант"));
  const second = track(client.detect("Это первый вариант, уже длиннее"));

  assert.equal(sent.length, 2, "each call asks the worker");
  assert.deepEqual(
    sent.map((request) => request.id),
    [1, 2],
    "and carries its own id",
  );

  reply({ type: "language", id: 2, language: RUSSIAN });
  await flush();

  assert.deepEqual(second.value, RUSSIAN);
  assert.deepEqual(
    first.value,
    RUSSIAN,
    "an answer to the later request also answers the earlier one",
  );
});

test("one request timing out leaves the other waiting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { client, reply } = connectClient();

  const first = track(client.detect("first"));
  t.mock.timers.tick(1500);
  const second = track(client.detect("first, and then some"));

  // Far enough for the first request's timer, not the second's.
  t.mock.timers.tick(DETECT_TIMEOUT_MS - 1500 + 1);
  await flush();

  assert.equal(first.settled, true, "the stalled request gives up on itself");
  assert.equal(first.value, null);
  assert.equal(
    second.settled,
    false,
    "and takes nobody else's resolver with it",
  );

  reply({ type: "language", id: 2, language: ENGLISH });
  await flush();

  assert.deepEqual(second.value, ENGLISH, "the real answer still lands");
});

test("reset settles what it drops", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { client } = connectClient();

  const pending = track(client.detect("some text"));
  client.reset();
  await flush();

  assert.equal(pending.settled, true);
  assert.equal(pending.value, null);

  // Nothing is left to rescue it: once the entry is gone, its timeout has
  // nothing to delete and stays silent.
  t.mock.timers.tick(DETECT_TIMEOUT_MS * 2);
  await flush();
});

test("a reply from a superseded run is dropped", async () => {
  const { client, done, reply } = connectClient();

  client.run("shorter", "This sentence is longer than it needs to be.");
  client.run("softer", "This sentence is longer than it needs to be.");

  reply({ type: "done", id: 1, text: "stale draft", label: "Shorter" });
  await flush();
  assert.deepEqual(done, [], "the abandoned run does not reach the panel");

  reply({ type: "done", id: 2, text: "fresh draft", label: "Softer" });
  await flush();
  assert.deepEqual(done, [["fresh draft", "Softer"]]);
});

test("a detected language is reused rather than asked for twice", async () => {
  const { client, sent, reply } = connectClient();

  const first = track(client.detect("Это текст"));
  reply({ type: "language", id: 1, language: RUSSIAN });
  await flush();
  assert.deepEqual(first.value, RUSSIAN);

  const second = track(client.detect("Это текст"));
  await flush();

  assert.deepEqual(second.value, RUSSIAN);
  assert.equal(sent.length, 1, "the worker is not asked again");
});
