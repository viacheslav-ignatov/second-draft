/**
 * The wire protocol between the panel in the page and the service worker.
 *
 * Everything crossing the port is declared here so the two sides cannot drift:
 * a reply type that no request produces, or a field the panel reads and the
 * worker never sets, becomes a compile error rather than a silent no-op.
 */

/** Result of language detection, or `null` when the detector is unavailable. */
export interface DetectedLanguage {
  /** BCP-47 tag as reported by the detector, e.g. `en`, `en-GB`, `de`. */
  code: string;
  /** Localised display name, for showing to the user. */
  name: string | null;
  /** 0–1, or `null` when the detector gives no figure. */
  confidence: number | null;
}

/** A preset as the panel needs to render it. */
export interface PresetSummary {
  id: string;
  label: string;
  englishOnly: boolean;
  nonEnglishOnly: boolean;
  /**
   * Whether the result depends on the detected language — because a gate hides
   * the preset, or because the executor proofreads in whatever the user turns
   * out to be writing. The panel waits for detection only for these; for the
   * rest, waiting would delay the first token for an answer nobody reads.
   */
  needsLanguage: boolean;
}

/** Whether the on-device model can run, and if not, why not. */
export type ModelState = "ready" | "downloadable" | "unavailable";

// ---------------------------------------------------------------------------
// Port: panel → worker
// ---------------------------------------------------------------------------

export const PORT_NAME = "second-draft";

/**
 * Requests carry an `id`. Replies echo it, so the panel can discard anything
 * belonging to a run the user has already moved on from — without it, switching
 * presets mid-stream interleaves two generations into one box.
 */
export interface Request {
  id: number;
}

/** Wake the worker and load the model while the user reads the preset names. */
export interface PrewarmRequest extends Request {
  type: "prewarm";
}

export interface DetectRequest extends Request {
  type: "detect";
  text: string;
}

export interface RunRequest extends Request {
  type: "run";
  presetId: string;
  text: string;
  language: DetectedLanguage | null;
}

export type PortRequest = PrewarmRequest | DetectRequest | RunRequest;

// ---------------------------------------------------------------------------
// Port: worker → panel
// ---------------------------------------------------------------------------

interface Reply {
  /** The id of the request that caused this reply. */
  id: number;
}

/** Progress text: thinking, downloading, reloading. */
export interface StatusReply extends Reply {
  type: "status";
  text: string;
}

/** Cumulative output so far — not a delta. */
export interface ChunkReply extends Reply {
  type: "chunk";
  text: string;
}

export interface DoneReply extends Reply {
  type: "done";
  text: string;
  label: string;
}

export interface ErrorReply extends Reply {
  type: "error";
  text: string;
}

export interface LanguageReply extends Reply {
  type: "language";
  language: DetectedLanguage | null;
}

export interface WarmReply extends Reply {
  type: "warm";
  state: ModelState;
}

export type PortReply =
  StatusReply | ChunkReply | DoneReply | ErrorReply | LanguageReply | WarmReply;

/**
 * `Omit` over a union collapses it to the keys every member shares, which would
 * make every reply body interchangeable. Distributing keeps them distinct.
 */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/** A reply as the sender writes it; the port attaches the id. */
export type PortReplyBody = WithoutId<PortReply>;

/** Reply types that belong to a generation, as opposed to detection or warm-up. */
export const RUN_REPLIES = ["status", "chunk", "done", "error"] as const;

export type RunReplyType = (typeof RUN_REPLIES)[number];

export function isRunReply(
  reply: PortReply,
): reply is StatusReply | ChunkReply | DoneReply | ErrorReply {
  return (RUN_REPLIES as readonly string[]).includes(reply.type);
}

// ---------------------------------------------------------------------------
// One-shot messages
// ---------------------------------------------------------------------------

/** Worker → tab, telling the panel to open. */
export type TabMessage =
  | {
      type: "REWRITE_WITH";
      presetId: string;
      selectionText: string;
      /**
       * True when the message went to every frame because the worker could not
       * tell which one the click came from, so the frames have to settle it by
       * focus.
       *
       * Normally false: `contextMenus.onClicked` reports the frame, delivery is
       * addressed at it, and a frame second-guessing that could only refuse a
       * correct message.
       */
      broadcast: boolean;
    }
  | { type: "SHOW_PICKER" };

/**
 * A tab message as the sender writes it; `dispatchToTab` attaches `broadcast`.
 *
 * The same split as `PortReplyBody` below, and for the same reason: how a
 * message travelled is known where it is sent, not where it is composed.
 */
export type TabMessageBody = WithoutBroadcast<TabMessage>;

type WithoutBroadcast<T> = T extends unknown ? Omit<T, "broadcast"> : never;

/** Page or popup → worker. */
export type RuntimeMessage = { type: "GET_PRESETS" } | { type: "GET_STATE" };

export interface StateResponse {
  state: ModelState;
}
