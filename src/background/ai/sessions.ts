/**
 * Session lifecycle: caching, recovery, streaming, download progress.
 *
 * Sessions are expensive to create and Chrome tears them down on its own — when
 * the worker goes idle, under memory pressure, when another tab needs the model.
 * The cache therefore has to heal itself rather than hand out dead handles.
 */

import { t } from "../../shared/i18n.ts";
import type { ChunkReply, StatusReply } from "../../shared/messages.ts";
import { isAbortError, isDeadSession } from "../../shared/errors.ts";

/** How the executors report progress back to the panel. */
export type Post = (
  reply: Omit<StatusReply, "id"> | Omit<ChunkReply, "id">,
) => void;

interface DownloadProgressEvent extends Event {
  loaded: number;
  total?: number;
}

/** Not an EventTarget: it only ever emits this one event. */
interface Monitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEvent) => void,
  ): void;
}

/**
 * `downloadprogress` fires both for the one-off disk download and for loading an
 * already-downloaded model into memory. Only the first is worth apologising for,
 * so the caller says which of the two is actually happening.
 */
export function downloadMonitor(
  post: Post,
  isFirstDownload: boolean,
  assetKey:
    "assetModel" | "assetLanguagePack" | "assetTranslationPack" = "assetModel",
) {
  const asset = t(assetKey);
  return (monitor: Monitor): void => {
    monitor.addEventListener("downloadprogress", (event) => {
      // `loaded` is a 0..1 fraction in the current spec, bytes in older builds.
      const ratio = event.total ? event.loaded / event.total : event.loaded;
      const pct = Number.isFinite(ratio) ? Math.round(ratio * 100) : null;
      const text =
        pct === null
          ? isFirstDownload
            ? t("statusDownloading", [asset])
            : t("statusLoading", [asset])
          : isFirstDownload
            ? t("statusDownloadingPct", [asset, String(pct)])
            : t("statusLoadingPct", [asset, String(pct)]);
      post({ type: "status", text });
    });
  };
}

/**
 * How many loaded sessions to keep.
 *
 * One rewrite touches at most three: the detector, the prompt session used to
 * measure input size, and one of translator/proofreader/rewriter. The fourth is
 * headroom for the user changing their mind. Past that, an old translation pair
 * is holding model memory for a language they have moved on from.
 */
const MAX_SESSIONS = 4;

/**
 * Loaded sessions, most recently used last.
 *
 * A `Map` iterates in insertion order, so re-inserting on a hit is what turns
 * "the first key" into "the least recently used one".
 */
const sessions = new Map<string, Promise<unknown>>();

/**
 * Keys with work in flight, counted rather than flagged: two tabs run two ports,
 * and both reach for the same prompt session. Evicting one of these would
 * destroy a session mid-generation, which is worse than holding a spare.
 */
const inUse = new Map<string, number>();

function pin(key: string): void {
  inUse.set(key, (inUse.get(key) ?? 0) + 1);
}

function unpin(key: string): void {
  const left = (inUse.get(key) ?? 0) - 1;
  if (left > 0) inUse.set(key, left);
  else inUse.delete(key);
}

/** Nothing waits on this: the handle may already be dead, and that is fine. */
async function release(session: Promise<unknown>): Promise<void> {
  try {
    const loaded = (await session) as { destroy?: () => void } | null;
    loaded?.destroy?.();
  } catch {
    /* it never loaded, or Chrome took it back first */
  }
}

/** Drops least-recently-used entries until the cache is back within budget. */
function evict(): void {
  for (const key of [...sessions.keys()]) {
    if (sessions.size <= MAX_SESSIONS) return;
    // Busy: skip it and look further up the queue rather than wait.
    if (inUse.has(key)) continue;
    const evicted = sessions.get(key);
    sessions.delete(key);
    if (evicted) void release(evicted);
  }
}

function cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = sessions.get(key) as Promise<T> | undefined;
  if (existing) {
    sessions.delete(key);
    sessions.set(key, existing);
    return existing;
  }
  const promise = factory().catch((error: unknown) => {
    sessions.delete(key);
    throw error;
  });
  sessions.set(key, promise);
  evict();
  return promise;
}

/** The cached Prompt session, if one is loaded — used for measuring input. */
export function loadedPromptSession<T>(): Promise<T> | null {
  return (sessions.get(PROMPT_KEY) as Promise<T> | undefined) ?? null;
}

export const PROMPT_KEY = "prompt";

export function warmCache<T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  return cached(key, factory);
}

/**
 * Drops every cached session. Only used by tests, which would otherwise carry a
 * session created against one set of fake globals into the next case.
 */
export function resetSessions(): void {
  sessions.clear();
  inUse.clear();
}

/**
 * Runs `use` against a cached session, recreating it once if Chrome destroyed it
 * underneath us. A second failure is a real error and propagates.
 */
export async function useSession<T, R>(
  key: string,
  factory: () => Promise<T>,
  use: (session: T) => Promise<R>,
  post: Post,
): Promise<R> {
  // Held for the whole call, including the rebuild below, so nothing evicts the
  // session out from under a generation that is still streaming.
  pin(key);
  try {
    let session = await cached(key, factory);
    try {
      return await use(session);
    } catch (error) {
      if (isAbortError(error) || !isDeadSession(error)) throw error;
      console.warn("[second-draft] session was destroyed, recreating", error);
      sessions.delete(key);
      post({ type: "chunk", text: "" }); // discard partial output from the dead run
      post({ type: "status", text: t("statusReloading") });
      session = await cached(key, factory);
      return await use(session);
    }
  } finally {
    unpin(key);
  }
}

/** Accumulates a stream, posting the running total after every chunk. */
export async function collect(
  stream: AsyncIterable<string>,
  post: Post,
  signal?: AbortSignal,
): Promise<string> {
  let out = "";
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    out += chunk;
    post({ type: "chunk", text: out });
  }
  return out;
}
