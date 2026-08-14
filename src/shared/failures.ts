/**
 * Turning a thrown value into something a person can act on.
 *
 * The built-in AI APIs throw `DOMException`s whose messages are English, aimed
 * at whoever wrote the call, and rewritten between Chrome builds. Putting one
 * straight into the panel means a German user reads "The session was destroyed"
 * and learns nothing they can do about it.
 *
 * Recognised failures map onto a locale key; everything else gets the generic
 * line, with the real error left on the console for a bug report. Matching is by
 * name first and message second, because the names are stable and the wording is
 * not — a missed match costs a vaguer message, never a wrong one.
 */

import { errorMessage, errorName, isDeadSession } from "./errors.ts";
import type { MessageKey } from "./i18n.ts";

/**
 * A refusal the code decided on, as opposed to something that went wrong.
 *
 * It carries the locale key rather than a rendered string. Throwing `t(key)` and
 * pattern-matching the text back out only works in the locale the patterns were
 * written in — the message would survive in English and collapse to the generic
 * line in German and Russian.
 */
export class PresentableError extends Error {
  readonly key: MessageKey;
  readonly substitutions?: string[];

  constructor(key: MessageKey, substitutions?: string[]) {
    super(key);
    this.name = "PresentableError";
    this.key = key;
    this.substitutions = substitutions;
  }
}

const TOO_LONG = /too (large|long)|input .*(exceeds|limit)|token limit/i;
const UNSUPPORTED = /not (yet )?(supported|available)|no .*(model|pack)/i;

export function failureKey(error: unknown): MessageKey {
  if (error instanceof PresentableError) return error.key;

  const name = errorName(error);
  const message = errorMessage(error);

  if (name === "QuotaExceededError" || TOO_LONG.test(message))
    return "errTooLong";

  // One recreation already failed in `useSession`, so this is the model going
  // away for good rather than the usual idle teardown.
  if (isDeadSession(error)) return "errModelGone";

  if (name === "NotSupportedError" || UNSUPPORTED.test(message))
    return "errUnavailable";

  return "errGeneric";
}

/** The substitutions that go with `failureKey`, when the key takes any. */
export function failureSubstitutions(error: unknown): string[] | undefined {
  return error instanceof PresentableError ? error.substitutions : undefined;
}
