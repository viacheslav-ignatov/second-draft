/**
 * Finding the field, capturing what to rewrite, and putting the result back.
 *
 * All the fiddly DOM behaviour lives here so the panel can stay a view. Two
 * things in this file are load-bearing and easy to break:
 *
 *  - `document.activeElement` is unreliable at the moment a context menu item is
 *    clicked, so the last edited field is tracked with listeners instead.
 *  - Insertion goes through `execCommand`, deprecated but the only path that
 *    lands in Chrome's native undo stack.
 */

/** Input types that hold prose worth rewriting. `""` covers a missing `type`. */
const TEXT_INPUT_TYPES = /^(text|search|email|url|tel|)$/i;

export interface Target {
  el: HTMLElement;
  contentEditable: boolean;
  /** What the user asked to rewrite: the selection if there is one, else all. */
  text: string;
  wholeField: boolean;
  range?: Range | null;
  start?: number;
  end?: number;
  /**
   * Everything the field held at capture time.
   *
   * `start`/`end` are offsets into *that* string, and `range` points at the
   * nodes that made it up. Generation takes seconds and the panel does not lock
   * the page, so by the time the user presses Insert the field may have been
   * typed into — in which case both would cut the wrong thing.
   */
  snapshot?: string;
}

export function isEditable(el: Element | null | undefined): el is HTMLElement {
  if (!el?.isConnected) return false;
  const element = el as HTMLElement & {
    disabled?: boolean;
    readOnly?: boolean;
    type?: string;
  };
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA")
    return !element.disabled && !element.readOnly;
  if (element.tagName === "INPUT") {
    return (
      TEXT_INPUT_TYPES.test(element.type ?? "") &&
      !element.disabled &&
      !element.readOnly
    );
  }
  return false;
}

let lastEditable: HTMLElement | null = null;

/** Call once per frame. Cheap listeners, capture phase, never removed. */
export function trackFocus(): void {
  document.addEventListener(
    "focusin",
    (event) => {
      const el = (event.composedPath?.()[0] ?? event.target) as Element;
      if (isEditable(el)) lastEditable = el;
    },
    true,
  );

  // A right-click does not always leave focus behind, and `activeElement` is
  // unreliable by the time a menu item is clicked — so the field is recorded
  // here, at the moment the user points at it.
  document.addEventListener(
    "contextmenu",
    (event) => {
      const el = (event.composedPath?.()[0] ?? event.target) as Element;
      if (isEditable(el)) lastEditable = el;
    },
    true,
  );
}

/**
 * In a parent document, `activeElement` is the `<iframe>` element while a child
 * has focus. Without that check both frames would answer a broadcast.
 */
export function ownsFocus(): boolean {
  if (!document.hasFocus()) return false;
  const active = document.activeElement;
  return !(active && /^(IFRAME|FRAME)$/.test(active.tagName));
}

export function field(): HTMLElement | null {
  const active = document.activeElement;
  if (isEditable(active)) return active;
  if (isEditable(lastEditable)) return lastEditable;
  return null;
}

export function capture(selectionText = ""): Target | null {
  const el = field();
  if (!el) return null;

  if (el.isContentEditable) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const selection =
      (root as Document).getSelection?.() ?? window.getSelection();
    const selected =
      selection && !selection.isCollapsed
        ? selection.toString()
        : selectionText;
    const whole = el.innerText;
    return {
      el,
      contentEditable: true,
      text: selected || whole,
      wholeField: !selected,
      range:
        selected && selection?.rangeCount
          ? selection.getRangeAt(0).cloneRange()
          : null,
      snapshot: whole,
    };
  }

  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const { selectionStart: start, selectionEnd: end, value } = input;
  const hasSelection = typeof start === "number" && start !== end;
  return {
    el,
    contentEditable: false,
    text: hasSelection ? value.slice(start, end!) : value,
    wholeField: !hasSelection,
    start: hasSelection ? start : 0,
    end: hasSelection ? end! : value.length,
    snapshot: value,
  };
}

export interface InsertResult {
  ok: boolean;
  /** True when the value setter was used and Cmd+Z will no longer restore. */
  undoLost: boolean;
  /** True when the field moved on since capture, so nothing was written. */
  stale?: boolean;
}

/** What the field holds right now, in the same terms as `Target.snapshot`. */
function currentText(target: Target): string {
  return target.contentEditable
    ? target.el.innerText
    : (target.el as HTMLInputElement).value;
}

/**
 * Whether a captured range still points inside the field it was taken from.
 *
 * `isConnected` alone would not do: a node can be moved out of the field and
 * still be somewhere in the document, and inserting into it would write into
 * whatever it was moved to.
 */
function rangeIsLive(range: Range, root: HTMLElement): boolean {
  return (
    range.startContainer.isConnected &&
    range.endContainer.isConnected &&
    root.contains(range.startContainer) &&
    root.contains(range.endContainer)
  );
}

export function insert(target: Target, text: string): InsertResult {
  if (!target.el.isConnected) return { ok: false, undoLost: false };

  // Refuse rather than write into a field that has moved on. Both paths below
  // replace a range captured before the generation started, so on a changed
  // field they would cut the wrong thing and take whatever the user typed in
  // the meantime with them. A false refusal costs a click on Copy; a false
  // acceptance costs their words.
  if (
    target.snapshot !== undefined &&
    currentText(target) !== target.snapshot
  ) {
    return { ok: false, undoLost: false, stale: true };
  }

  const { el } = target;
  el.focus();

  if (target.contentEditable) {
    // An editor that re-renders — React and friends do it on every keystroke —
    // swaps the nodes while the text stays identical, which the snapshot above
    // cannot see. A range into the discarded nodes selects nothing, so the
    // insertion would land wherever the caret happens to be sitting.
    if (target.range && !rangeIsLive(target.range, el)) {
      return { ok: false, undoLost: false, stale: true };
    }

    const selection = window.getSelection();
    try {
      selection?.removeAllRanges();
      if (target.range) {
        selection?.addRange(target.range);
      } else {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.addRange(range);
      }
    } catch (error) {
      // Chrome throws on a range whose nodes are gone. Reached only for what
      // the check above misses, but an exception here would escape the click
      // handler and leave the panel looking like it ignored the press.
      console.warn(
        "[second-draft] captured selection is no longer valid",
        error,
      );
      return { ok: false, undoLost: false, stale: true };
    }
  } else {
    (el as HTMLInputElement).setSelectionRange(target.start!, target.end!);
  }

  // Deprecated, and deliberately so: it is the only insertion path that lands in
  // Chrome's native undo stack, which is what keeps Cmd+Z working. It is also on
  // its way out, so its absence is a supported case rather than a crash — the
  // fallback below still works, it just loses undo.
  //
  // It inserts plain text, so in a rich editor any formatting inside the range
  // being replaced is flattened. That is not recoverable here: `capture()` reads
  // the field with `innerText`, so the model never saw the formatting to begin
  // with. Undo restores it, which is the other reason this path is worth keeping.
  const insertedNatively =
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, text);
  if (insertedNatively) return { ok: true, undoLost: false };

  // Fallback for fields that block execCommand: set the value natively and fire
  // the events a framework-controlled input listens for. Undo is lost here.
  if (target.contentEditable) return { ok: false, undoLost: false };
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const proto =
    input.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  // Reaching for the prototype setter is the point: assigning `.value` directly
  // is swallowed by frameworks that track the property themselves.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) return { ok: false, undoLost: false };

  const before = input.value;
  setter.call(
    input,
    before.slice(0, target.start) + text + before.slice(target.end),
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, undoLost: true };
}
