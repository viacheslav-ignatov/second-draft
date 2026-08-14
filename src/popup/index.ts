/**
 * The toolbar popup: model status, and the button that starts the download.
 *
 * The download lives here rather than in the panel for one concrete reason: a
 * service worker has no user activation, so it cannot reliably ask Chrome to
 * fetch the model. A click in an extension page can.
 */

import { failureKey } from "../shared/failures.ts";
import { localizeDocument, t } from "../shared/i18n.ts";
import type { ModelState, StateResponse } from "../shared/messages.ts";

interface PromptSession {
  destroy?(): void;
}

interface LanguageModelApi {
  create(options: unknown): Promise<PromptSession>;
}

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

localizeDocument();

function paint(state: ModelState | "downloading", detail?: string): void {
  const dot = $("dot");
  const download = $<HTMLButtonElement>("download");
  dot.className = "dot";
  download.hidden = true;

  switch (state) {
    case "ready":
      dot.classList.add("ok");
      $("status").textContent = t("popupStateReady");
      $("detail").textContent = t("popupReadyDetail");
      break;
    case "downloading":
      dot.classList.add("warn");
      $("status").textContent = t("popupStateDownloading");
      $("detail").textContent = detail ?? t("popupDownloadingDetail");
      break;
    case "downloadable":
      dot.classList.add("warn");
      $("status").textContent = t("popupStateDownloadable");
      $("detail").textContent = t("popupDownloadableDetail");
      download.hidden = false;
      download.textContent = t("popupDownload");
      break;
    default:
      dot.classList.add("bad");
      $("status").textContent = t("popupStateUnavailable");
      $("detail").textContent = t("popupUnavailableDetail");
  }
}

$("download").addEventListener("click", () => {
  void (async () => {
    const api = (globalThis as Record<string, unknown>).LanguageModel as
      LanguageModelApi | undefined;
    if (!api) {
      paint("unavailable");
      return;
    }

    const button = $<HTMLButtonElement>("download");
    button.disabled = true;
    paint("downloading");

    try {
      const session = await api.create({
        monitor(monitor: EventTarget) {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = event as Event & {
              loaded: number;
              total?: number;
            };
            const ratio = progress.total
              ? progress.loaded / progress.total
              : progress.loaded;
            const pct = Number.isFinite(ratio) ? Math.round(ratio * 100) : null;
            if (pct !== null)
              $("detail").textContent = t("popupProgress", [String(pct)]);
          });
        },
      });
      session.destroy?.();
      paint("ready");
    } catch (error) {
      console.error("[second-draft]", error);
      $("detail").textContent = t(failureKey(error));
      button.disabled = false;
    }
  })();
});

const options = $<HTMLAnchorElement>("options");
options.textContent = t("popupOptions");
options.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

// chrome:// URLs cannot be opened from a link, only through the tabs API.
$("internals").addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://on-device-internals" });
});

void (async () => {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === "open-picker")?.shortcut;

  const kbd = document.createElement("span");
  kbd.className = "kbd";
  // An unbound command comes back as an empty string, so `||` is deliberate
  // here: `??` would render an empty box.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  kbd.textContent = shortcut || t("popupNoShortcut");
  $("shortcut").replaceChildren(
    document.createTextNode(`${t("popupShortcutPrefix")} `),
    kbd,
  );

  // Ask the worker rather than reading the global here: the two can disagree
  // while a download is in flight, and the worker runs the rewrite.
  const reply = (await chrome.runtime
    .sendMessage({ type: "GET_STATE" })
    .catch(() => null)) as StateResponse | null;
  paint(reply?.state ?? "unavailable");
})();
