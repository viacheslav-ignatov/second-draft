/**
 * Session caching and recovery.
 *
 * Chrome tears sessions down on its own — idle worker, memory pressure, another
 * tab wanting the model — so `useSession` rebuilds once and retries. The part
 * worth pinning down is the *once*: a rebuild loop against a model that is
 * genuinely gone would spin instead of telling the user anything.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PROMPT_KEY,
  loadedPromptSession,
  resetSessions,
  useSession,
  warmCache,
} from "../src/background/ai/sessions.ts";
import { clearGlobals, installChrome } from "./helpers/doubles.ts";

/** What Chrome says when the session under a handle is gone. */
const dead = () => new Error("The session was destroyed.");

/**
 * Cancelling mid-run is the interesting case, because tearing the session down
 * is *how* Chrome cancels: the error looks like a dead session as well as an
 * abort. Only the abort check in front of it stops a rebuild nobody asked for.
 */
const abortedByDestroying = () => {
  const error = new Error(
    "The session was destroyed: the request was aborted.",
  );
  error.name = "AbortError";
  return error;
};

/** Hands out a new session object per call and counts how often it was asked. */
function countingFactory() {
  let built = 0;
  return {
    factory: () => Promise.resolve({ id: ++built }),
    get built() {
      return built;
    },
  };
}

test.afterEach(() => {
  clearGlobals();
  resetSessions();
});

test("a session Chrome destroyed is rebuilt once and the work retried", async () => {
  installChrome();
  const sessions = countingFactory();
  const posts: { type: string; text: string }[] = [];

  let attempts = 0;
  const result = await useSession(
    "prompt",
    sessions.factory,
    (session: { id: number }) => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(dead());
      return Promise.resolve(`ran on session ${session.id}`);
    },
    (reply) => posts.push(reply as { type: string; text: string }),
  );

  assert.equal(result, "ran on session 2", "the retry ran on the new session");
  assert.equal(sessions.built, 2);
  assert.deepEqual(
    posts,
    [
      // The panel is showing whatever the dead run streamed; it has to go, or
      // the retry appends to a half-sentence.
      { type: "chunk", text: "" },
      { type: "status", text: "statusReloading" },
    ],
    "partial output is discarded and the pause is explained",
  );
});

test("a second failure propagates instead of rebuilding forever", async () => {
  installChrome();
  const sessions = countingFactory();

  await assert.rejects(
    useSession(
      "prompt",
      sessions.factory,
      () => Promise.reject(dead()),
      () => undefined,
    ),
    /destroyed/,
  );

  assert.equal(sessions.built, 2, "rebuilt once, not in a loop");
});

test("a cancelled run is not mistaken for a dead session", async () => {
  installChrome();
  const sessions = countingFactory();
  const posts: unknown[] = [];

  await assert.rejects(
    useSession(
      "prompt",
      sessions.factory,
      () => Promise.reject(abortedByDestroying()),
      (reply) => posts.push(reply),
    ),
    /aborted/,
  );

  assert.equal(
    sessions.built,
    1,
    "the user cancelled; there is nothing to recover",
  );
  assert.deepEqual(posts, [], "and nothing to explain to them");
});

test("an unrelated failure propagates untouched", async () => {
  installChrome();
  const sessions = countingFactory();

  await assert.rejects(
    useSession(
      "prompt",
      sessions.factory,
      () => Promise.reject(new Error("quota exceeded")),
      () => undefined,
    ),
    /quota exceeded/,
  );

  assert.equal(sessions.built, 1);
});

test("a session is built once and reused", async () => {
  installChrome();
  const sessions = countingFactory();

  const first = await warmCache("prompt", sessions.factory);
  const second = await warmCache("prompt", sessions.factory);

  assert.equal(first, second, "the same handle both times");
  assert.equal(sessions.built, 1);
});

test("a factory that throws is not cached", async () => {
  installChrome();
  let attempts = 0;
  const factory = () => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new Error("model download failed"))
      : Promise.resolve("session");
  };

  await assert.rejects(warmCache("prompt", factory), /download failed/);

  // Otherwise one failed download would poison the cache for the whole life of
  // the service worker.
  assert.equal(await warmCache("prompt", factory), "session");
  assert.equal(attempts, 2);
});

test("the loaded prompt session is the one the limit check measures against", async () => {
  installChrome();

  assert.equal(loadedPromptSession(), null, "nothing loaded yet");

  const session = await warmCache(PROMPT_KEY, () => Promise.resolve("session"));

  assert.equal(await loadedPromptSession(), session);
});
