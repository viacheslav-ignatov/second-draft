/**
 * Content script entry point.
 *
 * Injected on demand into every frame of the tab; only the frame that actually
 * holds the field answers. Everything here is coordination — capture lives in
 * `target.ts`, rendering in `panel.ts`, the protocol in `client.ts`.
 */

import { t } from "../shared/i18n.ts";
import { presetApplies } from "../shared/rules.ts";
import type { PresetSummary, TabMessage } from "../shared/messages.ts";
import { WorkerClient } from "./client.ts";
import { Panel } from "./panel.ts";
import {
  capture,
  claimedByMenu,
  field,
  insert,
  ownsFocus,
  trackFocus,
  type Target,
} from "./target.ts";

declare global {
  interface Window {
    __secondDraftLoaded?: boolean;
  }
}

/** Long enough to read the lost-undo warning, short enough not to be in the way. */
const INSERTED_NO_UNDO_MS = 2500;

// Injection is repeated on every invocation, so guard against a second copy
// installing a second set of listeners.
if (!window.__secondDraftLoaded) {
  window.__secondDraftLoaded = true;
  main();
}

function main(): void {
  trackFocus();

  let target: Target | null = null;
  let presets: PresetSummary[] = [];
  let current: string | null = null;

  const panel = new Panel({
    onPick: (presetId) => void run(presetId),
    onInsert: (text) => {
      if (!text || !target) return;
      const result = insert(target, text);
      if (!result.ok) {
        // The panel stays open either way: the draft is still in the textarea,
        // and Copy is the way out.
        panel.setStatus(
          t(result.stale ? "errFieldChanged" : "errNoInsert"),
          true,
        );
        return;
      }
      // Undo only survives the execCommand path; say so rather than letting the
      // user discover it by pressing Cmd+Z and losing their words. Closing
      // immediately would remove the panel from the DOM in the same frame the
      // status was written, so the warning was never actually on screen.
      if (result.undoLost) {
        panel.setStatus(t("statusInsertedNoUndo"));
        panel.setBusy(true);
        setTimeout(close, INSERTED_NO_UNDO_MS);
      } else {
        close();
      }
    },
    onCopy: (text) => void copy(text),
    onRetry: () => current && void run(current),
    onClose: close,
  });

  const client = new WorkerClient({
    onStatus: (text, isError) => {
      panel.setStatus(text, isError);
      if (isError) {
        panel.setBusy(false);
        panel.enableRetry(Boolean(current));
      }
    },
    onChunk: (text) => {
      panel.setDraft(text);
      panel.setStatus(t("statusWriting"));
    },
    onDone: (text, label) => {
      panel.setDraft(text);
      panel.setBusy(false);
      panel.setStatus(t("statusDone", [label]));
      panel.focusInsert();
    },
    onWarm: (state) => {
      if (current) return;
      if (state === "ready") panel.setStatus(t("statusReady"));
      else if (state === "downloadable")
        panel.setStatus(t("statusNeedsDownload"), true);
      else panel.setStatus(t("errUnavailable"), true);
    },
  });

  function close(): void {
    client.disconnect();
    panel.close();
    target = null;
    current = null;
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      panel.setStatus(t("statusCopied"));
    } catch {
      // Blocked when the document is not focused. Select it so Cmd+C works.
      panel.selectDraft();
      panel.setStatus(t("errClipboard"), true);
    }
  }

  const chipEnabled = (preset: PresetSummary): boolean =>
    presetApplies(preset, client.detectedLanguage);

  const chipReason = (preset: PresetSummary): string =>
    preset.englishOnly
      ? t("errEnglishOnly", [client.detectedLanguage?.name ?? ""])
      : t("errAlreadyEnglish");

  function renderChips(): void {
    panel.renderChips(presets, chipEnabled, chipReason);
  }

  function renderLanguage(): void {
    const language = client.detectedLanguage;
    if (!language) {
      panel.setLanguage("");
      return;
    }
    const pct =
      language.confidence == null
        ? ""
        : ` (${Math.round(language.confidence * 100)}%)`;
    panel.setLanguage(
      t("langDetected", [language.name ?? language.code]) + pct,
    );
  }

  async function loadPresets(): Promise<void> {
    if (presets.length) return;
    presets = (await chrome.runtime.sendMessage({ type: "GET_PRESETS" })) ?? [];
  }

  // Editing presets in the options page must not require reloading every tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area !== "sync" ||
      !Object.keys(changes).some((key) => key.startsWith("preset:"))
    )
      return;
    presets = [];
    void loadPresets().then(renderChips);
  });

  async function run(presetId: string): Promise<void> {
    target ??= capture();
    if (!target?.text.trim()) {
      target = null;
      return;
    }

    const text = target.text;
    current = presetId;
    panel.open();
    panel.setSelected(presetId);
    await loadPresets();
    renderChips();

    panel.setOriginal(
      text,
      t(target.wholeField ? "srcWholeField" : "srcSelection"),
    );
    panel.setDraft("");
    panel.setBusy(true);

    const preset = presets.find((p) => p.id === presetId);

    // Only three of the nine built-ins care what language this is. For the rest
    // the detection is worth having — it fills the language line and greys out
    // the chips that do not apply — but it is not worth up to DETECT_TIMEOUT_MS
    // of a blank panel, so it runs alongside the generation instead of ahead of
    // it.
    if (preset?.needsLanguage) {
      panel.setStatus(t("statusCheckingLanguage"));
      await client.detect(text);
      renderLanguage();
      renderChips();

      if (!chipEnabled(preset)) {
        panel.setBusy(false);
        panel.setStatus(
          preset.englishOnly
            ? t("errEnglishOnlyHint", [client.detectedLanguage?.name ?? ""])
            : t("errAlreadyEnglish"),
          true,
        );
        return;
      }
    } else {
      void client.detect(text).then(() => {
        renderLanguage();
        renderChips();
      });
    }

    panel.setStatus(t("statusThinking"));
    client.run(presetId, text);
  }

  async function showPicker(): Promise<void> {
    target = capture();
    if (!target) return;

    current = null;
    client.reset();
    panel.open();
    panel.setSelected(null);
    await loadPresets();
    renderChips();
    renderLanguage();

    panel.setOriginal(
      target.text,
      t(target.wholeField ? "srcWholeField" : "srcSelection"),
    );
    panel.setDraft("");
    panel.setBusy(true);
    panel.setStatus(t("statusPickPreset"));
    // The field was captured before the panel opened, so moving focus in is safe
    // and makes the chips reachable without tabbing through the whole page.
    panel.focusFirstChip();

    client.prewarm();
    void client.detect(target.text).then(() => {
      renderLanguage();
      renderChips();
    });
  }

  chrome.runtime.onMessage.addListener((message: TabMessage) => {
    // Every frame receives this, so each decides whether the user is here: a
    // recent right-click for the menu, focus for the keyboard shortcut.
    if (!field()) return;

    if (message?.type === "REWRITE_WITH") {
      if (!claimedByMenu() && !ownsFocus()) return;
      target = capture(message.selectionText);
      client.reset();
      void run(message.presetId);
    } else if (message?.type === "SHOW_PICKER") {
      if (!ownsFocus()) return;
      void showPicker();
    }
  });
}
