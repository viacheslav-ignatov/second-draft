/**
 * Mapping thrown values onto something the panel can say.
 *
 * The point of these cases is the fallback as much as the matches: an
 * unrecognised failure must land on the generic line rather than leaking a
 * DOMException message into a panel that speaks three languages.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PresentableError,
  failureKey,
  failureSubstitutions,
} from "../src/shared/failures.ts";

/** Builds the shape the built-in AI APIs actually throw. */
const thrown = (name: string, message: string) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

test("an oversized input is reported as too long", () => {
  assert.equal(
    failureKey(thrown("QuotaExceededError", "Requested 9000 tokens")),
    "errTooLong",
  );
  assert.equal(
    failureKey(thrown("DataError", "The input is too large for this session")),
    "errTooLong",
  );
});

test("a model that went away for good says so", () => {
  // `useSession` already retried once by the time this is reached.
  assert.equal(
    failureKey(thrown("InvalidStateError", "The session was destroyed.")),
    "errModelGone",
  );
});

test("an unsupported route points at the toolbar icon", () => {
  assert.equal(
    failureKey(thrown("NotSupportedError", "de-en is not a supported pair")),
    "errUnavailable",
  );
  assert.equal(
    failureKey(thrown("UnknownError", "No translation pack for this language")),
    "errUnavailable",
  );
});

test("anything unrecognised falls back to the generic line", () => {
  assert.equal(
    failureKey(thrown("TypeError", "x is not a function")),
    "errGeneric",
  );
  assert.equal(failureKey(new Error("")), "errGeneric");
  assert.equal(failureKey("a bare string"), "errGeneric");
  assert.equal(failureKey(undefined), "errGeneric");
});

test("a deliberate refusal keeps its own key in every locale", () => {
  // The executors refuse in three places. Rendering the string at the throw and
  // matching it back out only works in the locale the patterns were written in,
  // so the key travels with the error instead.
  for (const key of [
    "errUnknownLanguage",
    "errAlreadyEnglish",
    "errNoPack",
    "errTooLong",
  ] as const) {
    assert.equal(failureKey(new PresentableError(key)), key);
  }
});

test("a refusal carries its substitutions", () => {
  const error = new PresentableError("errNoPack", ["German"]);
  assert.deepEqual(failureSubstitutions(error), ["German"]);
  assert.equal(failureSubstitutions(new Error("plain")), undefined);
});

test("classification never returns the raw message", () => {
  const secret = "the user's draft text leaked into an error";
  assert.notEqual(failureKey(new Error(secret)), secret);
});
