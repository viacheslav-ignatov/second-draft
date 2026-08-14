/**
 * What the panel does once something asks for it.
 *
 * Capture lives in `target.ts`, rendering in `panel.ts`, the protocol in
 * `client.ts`; this is the part that decides in what order they happen. It is a
 * module rather than a closure inside the entry point so it can be exercised
 * without a DOM: everything it touches arrives through `ControllerDeps`, and the
 * real implementations are wired up in `index.ts`.
 */

import { t } from "../shared/i18n.ts";
import { presetApplies } from "../shared/rules.ts";
import type {
  DetectedLanguage,
  PresetSummary,
  TabMessage,
} from "../shared/messages.ts";
import type { ClientHandlers } from "./client.ts";
import type { PanelCallbacks } from "./panel.ts";
import type { InsertResult, Target } from "./target.ts";

/** Long enough to read the lost-undo warning, short enough not to be in the way. */
export const INSERTED_NO_UNDO_MS = 2500;

/** The panel as this module uses it; `Panel` satisfies it structurally. */
export interface PanelView {
  open(): void;
  close(): void;
  renderChips(
    presets: PresetSummary[],
    enabled: (preset: PresetSummary) => boolean,
    reason: (preset: PresetSummary) => string,
  ): void;
  setSelected(presetId: string | null): void;
  setLanguage(text: string): void;
  setOriginal(text: string, title: string): void;
  setDraft(text: string): void;
  setStatus(text: string, isError?: boolean): void;
  setBusy(busy: boolean): void;
  enableRetry(enabled: boolean): void;
  focusFirstChip(): void;
  focusInsert(): void;
  selectDraft(): void;
}

/** The worker connection as this module uses it; `WorkerClient` satisfies it. */
export interface WorkerLink {
  prewarm(): void;
  detect(text: string): Promise<DetectedLanguage | null>;
  run(presetId: string, text: string): void;
  readonly detectedLanguage: DetectedLanguage | null;
  reset(): void;
  disconnect(): void;
}

export interface ControllerDeps {
  /** Built here rather than passed in, because each needs callbacks into this. */
  createPanel(callbacks: PanelCallbacks): PanelView;
  createClient(handlers: ClientHandlers): WorkerLink;

  // The DOM-facing half, from `target.ts`.
  capture(selectionText?: string): Target | null;
  insert(target: Target, text: string): InsertResult;
  field(): HTMLElement | null;
  ownsFocus(): boolean;
  claimedByMenu(): boolean;

  /** Asks the worker for the preset list. */
  loadPresets(): Promise<PresetSummary[]>;
  copyText(text: string): Promise<void>;
  /** Seam for the pause before closing after an insert that lost undo. */
  delay(fn: () => void, ms: number): void;
}

export interface Controller {
  /** A menu click or the keyboard command, addressed at this frame. */
  handleMessage(message: TabMessage): Promise<void>;
  /** The user edited their presets; drop the cache and re-render the chips. */
  presetsChanged(): Promise<void>;
}

export function createController(deps: ControllerDeps): Controller {
  let target: Target | null = null;
  let presets: PresetSummary[] = [];
  let current: string | null = null;

  const panel = deps.createPanel({
    onPick: (presetId) => void run(presetId),
    onInsert: (text) => {
      if (!text || !target) return;
      const result = deps.insert(target, text);
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
        deps.delay(close, INSERTED_NO_UNDO_MS);
      } else {
        close();
      }
    },
    onCopy: (text) => void copy(text),
    onRetry: () => {
      if (current) void run(current);
    },
    onClose: close,
  });

  const client = deps.createClient({
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
      await deps.copyText(text);
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
    presets = await deps.loadPresets();
  }

  async function run(presetId: string): Promise<void> {
    target ??= deps.capture();
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
    target = deps.capture();
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

  return {
    async handleMessage(message: TabMessage): Promise<void> {
      // The keyboard command is broadcast to every frame, so each has to decide
      // whether the user is here. The menu path is addressed by `frameId` and
      // arrives only here, but still has to survive the focus check because a
      // right-click does not always leave focus behind.
      if (!deps.field()) return;

      if (message?.type === "REWRITE_WITH") {
        if (!deps.claimedByMenu() && !deps.ownsFocus()) return;
        target = deps.capture(message.selectionText);
        client.reset();
        await run(message.presetId);
      } else if (message?.type === "SHOW_PICKER") {
        if (!deps.ownsFocus()) return;
        await showPicker();
      }
    },

    async presetsChanged(): Promise<void> {
      presets = [];
      await loadPresets();
      renderChips();
    },
  };
}
