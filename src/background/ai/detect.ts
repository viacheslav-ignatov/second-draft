/** Language detection, used to gate presets and to pick a translation pair. */

import type { DetectedLanguage } from "../../shared/messages.ts";
import { availabilityOf, isSupported, resolveGlobal } from "./availability.ts";
import { downloadMonitor, useSession, type Post } from "./sessions.ts";

interface DetectionResult {
  detectedLanguage: string;
  confidence?: number;
}

interface DetectorApi {
  create(options: unknown): Promise<{ detect(text: string): Promise<DetectionResult[]> }>;
}

function displayName(code: string): string | null {
  try {
    const names = new Intl.DisplayNames([chrome.i18n.getUILanguage()], { type: "language" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export async function detectLanguage(text: string, post: Post): Promise<DetectedLanguage | null> {
  const api = resolveGlobal<DetectorApi>("LanguageDetector");
  if (!api) return null;

  const state = await availabilityOf(api);
  if (!isSupported(state)) return null;

  const results = await useSession(
    "detector",
    () =>
      api.create({
        monitor: downloadMonitor(post, state === "downloadable", "assetLanguagePack"),
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
