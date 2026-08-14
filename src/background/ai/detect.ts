/** Language detection, used to gate presets and to pick a translation pair. */

import type { DetectedLanguage } from "../../shared/messages.ts";
import { availabilityOf, isSupported, resolveGlobal } from "./availability.ts";
import { downloadMonitor, useSession, type Post } from "./sessions.ts";

interface DetectionResult {
  detectedLanguage: string;
  confidence?: number;
}

interface DetectorApi {
  create(
    options: unknown,
  ): Promise<{ detect(text: string): Promise<DetectionResult[]> }>;
}

/**
 * Built once and kept.
 *
 * Constructing an `Intl` formatter is the most expensive thing in this file, and
 * detection runs on every invocation — while the browser's UI language cannot
 * change under a service worker that is already awake. `null` means the runtime
 * refused the locale, which it will go on refusing, so that answer is cached too
 * rather than retried on every detection.
 */
let names: Intl.DisplayNames | null | undefined;

function displayNames(): Intl.DisplayNames | null {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([chrome.i18n.getUILanguage()], {
        type: "language",
      });
    } catch {
      names = null;
    }
  }
  return names;
}

function displayName(code: string): string | null {
  try {
    // `of()` throws on a structurally invalid tag, which a detector can return.
    return displayNames()?.of(code) ?? code;
  } catch {
    return code;
  }
}

export async function detectLanguage(
  text: string,
  post: Post,
): Promise<DetectedLanguage | null> {
  const api = resolveGlobal<DetectorApi>("LanguageDetector");
  if (!api) return null;

  const state = await availabilityOf(api);
  if (!isSupported(state)) return null;

  const results = await useSession(
    "detector",
    () =>
      api.create({
        monitor: downloadMonitor(
          post,
          state === "downloadable",
          "assetLanguagePack",
        ),
      }),
    (detector) => detector.detect(text),
    post,
  );

  const best = Array.isArray(results) ? results[0] : null;
  if (!best?.detectedLanguage) return null;

  return {
    code: best.detectedLanguage,
    name: displayName(best.detectedLanguage),
    confidence: best.confidence ?? null,
  };
}
