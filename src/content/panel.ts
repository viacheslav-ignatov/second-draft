/**
 * The panel — a view and nothing more.
 *
 * It knows how to render chips, a draft and a status line, and it reports user
 * intent through callbacks. It does not know about ports, presets or models, so
 * it can be reasoned about (and restyled) on its own.
 */

import tokens from "../shared/tokens.css";
import css from "./panel.css";
import { t } from "../shared/i18n.ts";
import type { PresetSummary } from "../shared/messages.ts";

export interface PanelCallbacks {
  onPick(presetId: string): void;
  onInsert(text: string): void;
  onCopy(text: string): void;
  onRetry(): void;
  onClose(): void;
}

const TEMPLATE = (): string => `
  <div class="panel" role="dialog" aria-label="Second Draft">
    <header>
      <b>Second Draft</b>
      <button class="close" title="${t("panelClose")}" aria-label="${t("panelClose")}">&times;</button>
    </header>
    <div class="body">
      <div class="chips"></div>
      <div class="lang"></div>
      <div class="orig"></div>
      <textarea spellcheck="false" aria-label="${t("panelDraftLabel")}"></textarea>
      <div class="status" aria-live="polite"></div>
      <div class="actions">
        <button class="act primary insert" disabled>${t("panelInsert")}</button>
        <button class="act copy" disabled>${t("panelCopy")}</button>
        <button class="act retry" disabled>${t("panelRetry")}</button>
      </div>
      <div class="hint">${t("panelHint")}</div>
    </div>
  </div>`;

export class Panel {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private watcher: MutationObserver | null = null;
  private selected: string | null = null;

  constructor(private readonly callbacks: PanelCallbacks) {}

  get isOpen(): boolean {
    return Boolean(this.host?.isConnected);
  }

  open(): void {
    if (this.isOpen) return;

    this.host = document.createElement("div");
    this.host.id = "second-draft-host";
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${tokens}${css}</style>${TEMPLATE()}`;
    document.body.appendChild(this.host);

    this.on(".close", "click", () => {
      this.callbacks.onClose();
    });
    this.on(".insert", "click", () => {
      this.callbacks.onInsert(this.draft);
    });
    this.on(".copy", "click", () => {
      this.callbacks.onCopy(this.draft);
    });
    this.on(".retry", "click", () => {
      this.callbacks.onRetry();
    });

    this.query("textarea")?.addEventListener("keydown", (event) => {
      const e = event;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        this.callbacks.onInsert(this.draft);
      }
    });

    document.addEventListener("keydown", this.onKeydown, true);

    // A single-page app can rip the host out of the DOM on navigation; without
    // this the keydown listener would outlive the panel.
    this.watcher = new MutationObserver(() => {
      if (this.host && !this.host.isConnected) this.callbacks.onClose();
    });
    this.watcher.observe(document.body, { childList: true });
  }

  close(): void {
    document.removeEventListener("keydown", this.onKeydown, true);
    this.watcher?.disconnect();
    this.watcher = null;
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.selected = null;
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.isOpen) {
      event.stopPropagation();
      this.callbacks.onClose();
    }
  };

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Presets the language rules exclude are shown struck through with the reason
   * rather than dropped — offering "fix the English" on Russian text produces
   * confident nonsense, and silently hiding it looks like a bug.
   */
  renderChips(
    presets: PresetSummary[],
    enabled: (preset: PresetSummary) => boolean,
    reason: (preset: PresetSummary) => string,
  ): void {
    const box = this.query(".chips");
    if (!box) return;
    box.textContent = "";

    for (const preset of presets) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = preset.label;
      chip.setAttribute("aria-pressed", String(preset.id === this.selected));

      if (enabled(preset)) {
        chip.addEventListener("click", () => {
          this.callbacks.onPick(preset.id);
        });
      } else {
        chip.classList.add("off");
        chip.disabled = true;
        chip.title = reason(preset);
      }
      box.appendChild(chip);
    }
  }

  setSelected(presetId: string | null): void {
    this.selected = presetId;
  }

  setLanguage(text: string): void {
    const el = this.query(".lang");
    if (el) el.textContent = text;
  }

  setOriginal(text: string, title: string): void {
    const el = this.query(".orig");
    if (!el) return;
    el.textContent = text;
    el.title = title;
  }

  get draft(): string {
    return this.query<HTMLTextAreaElement>("textarea")?.value.trim() ?? "";
  }

  setDraft(text: string): void {
    const textarea = this.query<HTMLTextAreaElement>("textarea");
    if (textarea) textarea.value = text;
  }

  setStatus(text: string, isError = false): void {
    const el = this.query(".status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("err", isError);
  }

  setBusy(busy: boolean): void {
    for (const selector of [".insert", ".copy", ".retry"] as const) {
      const button = this.query<HTMLButtonElement>(selector);
      if (button) button.disabled = busy;
    }
  }

  enableRetry(enabled: boolean): void {
    const button = this.query<HTMLButtonElement>(".retry");
    if (button) button.disabled = !enabled;
  }

  /** Focus the first thing worth acting on, so the panel is keyboard-reachable. */
  focusFirstChip(): void {
    this.query<HTMLButtonElement>(".chip:not(.off)")?.focus();
  }

  focusInsert(): void {
    this.query<HTMLButtonElement>(".insert")?.focus();
  }

  selectDraft(): void {
    const textarea = this.query<HTMLTextAreaElement>("textarea");
    textarea?.focus();
    textarea?.select();
  }

  private query<T extends HTMLElement>(selector: string): T | null {
    return this.root?.querySelector<T>(selector) ?? null;
  }

  private on(selector: string, type: string, handler: () => void): void {
    this.query(selector)?.addEventListener(type, handler);
  }
}
