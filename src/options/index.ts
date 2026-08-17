/** The options page: the user's own rewrites. */

import { localizeDocument, t, type MessageKey } from "../shared/i18n.ts";
import { readPresets, writePresets } from "../shared/preset-storage.ts";
import {
  CUSTOM_LIMIT,
  INSTRUCTION_MAX,
  LABEL_MAX,
  normalizeCustomPreset,
  sortCustomPresets,
  type CustomPreset,
} from "../shared/rules.ts";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

localizeDocument();

let presets: CustomPreset[] = [];
let savedIds = new Set<string>();

function flash(key: MessageKey, isError = false): void {
  const flag = $("flag");
  flag.textContent = t(key);
  flag.classList.toggle("error", isError);
  flag.hidden = false;
  if (!isError) setTimeout(() => (flag.hidden = true), 1600);
}

function presetCard(preset: CustomPreset, index: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "preset";

  const label = document.createElement("input");
  label.type = "text";
  label.value = preset.label;
  label.placeholder = t("optLabelPlaceholder");
  label.maxLength = LABEL_MAX;
  label.addEventListener("input", () => (presets[index]!.label = label.value));

  const remove = document.createElement("button");
  remove.className = "danger";
  remove.textContent = t("optDelete");
  remove.addEventListener("click", () => {
    presets.splice(index, 1);
    render();
  });

  const row = document.createElement("div");
  row.className = "row";
  row.append(label, remove);

  const instruction = document.createElement("textarea");
  instruction.value = preset.instruction;
  instruction.placeholder = t("optInstructionPlaceholder");
  instruction.maxLength = INSTRUCTION_MAX;

  const counter = document.createElement("div");
  counter.className = "counter";
  const count = (): void => {
    counter.textContent = `${instruction.value.length} / ${INSTRUCTION_MAX}`;
  };
  instruction.addEventListener("input", () => {
    presets[index]!.instruction = instruction.value;
    count();
  });
  count();

  const englishOnly = document.createElement("input");
  englishOnly.type = "checkbox";
  englishOnly.checked = preset.englishOnly;
  englishOnly.addEventListener(
    "change",
    () => (presets[index]!.englishOnly = englishOnly.checked),
  );

  const check = document.createElement("label");
  check.className = "check";
  check.append(englishOnly, document.createTextNode(t("optEnglishOnly")));

  card.append(row, instruction, counter, check);
  return card;
}

function render(): void {
  const list = $("list");
  list.textContent = "";

  if (!presets.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("optEmpty");
    list.appendChild(empty);
  }

  presets.forEach((preset, index) =>
    list.appendChild(presetCard(preset, index)),
  );
  $<HTMLButtonElement>("add").disabled = presets.length >= CUSTOM_LIMIT;
}

$("add").addEventListener("click", () => {
  presets.push({
    // The whole UUID. It was truncated to eight characters to keep the storage
    // key short, which is not a constraint that exists: `chrome.storage.sync`
    // measures key and value together against 8 KB, and this key is 43 bytes.
    id: crypto.randomUUID(),
    label: "",
    instruction: "",
    englishOnly: false,
    createdAt: Date.now(),
  });
  render();
  $("list")
    .querySelector<HTMLInputElement>(".preset:last-child input")
    ?.focus();
});

$("save").addEventListener("click", () => {
  void (async () => {
    const clean = sortCustomPresets(
      presets
        .map(normalizeCustomPreset)
        .filter((p): p is CustomPreset => p !== null),
    ).slice(0, CUSTOM_LIMIT);

    try {
      await writePresets(clean, savedIds);
      presets = clean;
      savedIds = new Set(clean.map((p) => p.id));
      render();
      flash("optSaved");
    } catch (error) {
      // Quota, sync throttling, or a disabled sync account. Saying nothing here
      // means the user watches their work disappear on the next page load.
      console.error("[second-draft]", error);
      flash("optSaveFailed", true);
    }
  })();
});

void (async () => {
  presets = await readPresets();
  savedIds = new Set(presets.map((p) => p.id));
  render();
})();
