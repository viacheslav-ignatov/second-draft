/**
 * Input size.
 *
 * A character count is the wrong unit — far too generous for CJK, needlessly
 * strict for Latin script — so the session is asked what the input actually
 * costs whenever one is loaded to ask.
 */

import { tooLongByChars } from "../../shared/rules.ts";
import { loadedPromptSession } from "./sessions.ts";

const OUTPUT_HEADROOM = 512;

interface Measurable {
  measureInputUsage?: (input: string) => Promise<number>;
  inputQuota?: number;
  inputUsage?: number;
}

/** `null` when the session cannot measure, so the caller can fall back. */
export async function exceedsQuota(
  session: Measurable | null | undefined,
  input: string,
): Promise<boolean | null> {
  try {
    if (typeof session?.measureInputUsage !== "function") return null;
    const cost = await session.measureInputUsage(input);
    const quota = session.inputQuota;
    if (!Number.isFinite(quota)) return null;
    return cost > quota! - (session.inputUsage ?? 0) - OUTPUT_HEADROOM;
  } catch (error) {
    console.warn("[second-draft] could not measure input", error);
    return null;
  }
}

/**
 * Checked before an executor is chosen, so the Rewriter and Translator routes
 * cannot be handed a whole article. Measuring needs a session; if none is
 * loaded, the character count stands in rather than forcing a multi-gigabyte
 * download for a preset that may not even need the model.
 */
export async function tooLongForAnyExecutor(text: string): Promise<boolean> {
  const loaded = loadedPromptSession<Measurable>();
  if (loaded) {
    try {
      const measured = await exceedsQuota(await loaded, text);
      if (measured !== null) return measured;
    } catch {
      /* fall through to the character count */
    }
  }
  return tooLongByChars(text);
}
