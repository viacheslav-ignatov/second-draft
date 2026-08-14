/**
 * The port between the panel and the worker.
 *
 * Two invariants live here. Every reply echoes the id of its request, so the
 * panel can discard output from a run the user has moved on from. And only one
 * generation runs per port at a time — picking a second preset aborts the first
 * rather than letting both stream into the same box.
 */

import { t } from "../shared/i18n.ts";
import {
  PORT_NAME,
  type PortReply,
  type PortReplyBody,
  type PortRequest,
  type RunRequest,
} from "../shared/messages.ts";
import { errorMessage } from "../shared/errors.ts";
import { cleanOutput, presetApplies } from "../shared/rules.ts";
import { isAbortError } from "./ai/availability.ts";
import { detectLanguage } from "./ai/detect.ts";
import { execute, warmUp } from "./ai/executors.ts";
import { tooLongForAnyExecutor } from "./ai/limits.ts";
import { allPresets } from "./presets.ts";

export function registerPort(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    attach(port);
  });
}

function attach(port: chrome.runtime.Port): void {
  let inFlight: { controller: AbortController; id: number } | null = null;

  const send = (reply: PortReply): void => {
    try {
      port.postMessage(reply);
    } catch {
      /* the page navigated away mid-run */
    }
  };

  const replyTo =
    (id: number) =>
    (reply: PortReplyBody): void => {
      send({ ...reply, id });
    };

  const cancelInFlight = (): void => {
    inFlight?.controller.abort();
    inFlight = null;
  };

  // Closing the panel used to leave the model generating into a disconnected
  // port, which on a slow machine keeps it busy for another ten seconds.
  port.onDisconnect.addListener(cancelInFlight);

  port.onMessage.addListener((message: PortRequest) => {
    const post = replyTo(message.id);

    switch (message.type) {
      case "prewarm":
        void warmUp(post)
          .then((state) => {
            post({ type: "warm", state });
          })
          .catch((error: unknown) => {
            console.warn("[second-draft] prewarm failed", error);
            post({ type: "warm", state: "unavailable" });
          });
        return;

      case "detect":
        void detectLanguage(message.text ?? "", post)
          .then((language) => {
            post({ type: "language", language });
          })
          .catch((error: unknown) => {
            console.warn("[second-draft] detection failed", error);
            post({ type: "language", language: null });
          });
        return;

      case "run":
        cancelInFlight();
        inFlight = { controller: new AbortController(), id: message.id };
        void runGeneration(message, post, inFlight.controller.signal).finally(() => {
          if (inFlight?.id === message.id) inFlight = null;
        });
        return;
    }
  });
}

async function runGeneration(
  request: RunRequest,
  post: (reply: PortReplyBody) => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    const preset = (await allPresets())[request.presetId];
    if (!preset) {
      post({ type: "error", text: t("errUnknownPreset") });
      return;
    }

    const text = (request.text ?? "").trim();
    if (!text) {
      post({ type: "error", text: t("errNothing") });
      return;
    }

    // Checked before a route is chosen, so the Rewriter and Translator paths
    // cannot be handed a whole article.
    if (await tooLongForAnyExecutor(text)) {
      post({ type: "error", text: t("errTooLong") });
      return;
    }

    if (!presetApplies(preset, request.language)) {
      post({
        type: "error",
        text: preset.englishOnly
          ? t("errEnglishOnlyHint", [request.language?.name ?? ""])
          : t("errAlreadyEnglish"),
      });
      return;
    }

    post({ type: "status", text: t("statusThinking") });

    const output = await execute({ preset, text, language: request.language, post, signal });

    if (signal.aborted) return;
    if (output == null) {
      post({ type: "error", text: t("errUnavailable") });
      return;
    }

    post({ type: "done", text: cleanOutput(output), label: preset.label });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) return; // the user moved on
    console.error("[second-draft]", error);
    post({ type: "error", text: errorMessage(error) });
  }
}
