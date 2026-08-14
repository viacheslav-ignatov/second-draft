/**
 * Test doubles.
 *
 * Enough of `chrome.*` and the built-in AI globals to exercise the real modules
 * in Node. Everything is installed on `globalThis` before the module under test
 * is dynamically imported, since the modules read those globals at call time.
 */

interface Listener<T extends unknown[]> {
  addListener(fn: (...args: T) => void): void;
}

function listenerSet<T extends unknown[]>(): Listener<T> & {
  emit(...args: T): void;
} {
  const fns: ((...args: T) => void)[] = [];
  return {
    addListener: (fn) => fns.push(fn),
    emit: (...args: T) => fns.forEach((fn) => fn(...args)),
  };
}

/** A fake `chrome.runtime.Port` with both ends exposed to the test. */
export interface FakePort {
  /** The object handed to the extension's `onConnect` listener. */
  port: chrome.runtime.Port;
  /** Everything the worker has posted back. */
  sent: Record<string, unknown>[];
  /** Simulates the panel sending a request. */
  receive(message: unknown): void;
  /** Simulates the panel closing. */
  disconnect(): void;
}

export function fakePort(name = "second-draft"): FakePort {
  const messages = listenerSet<[unknown]>();
  const disconnects = listenerSet<[]>();
  const sent: Record<string, unknown>[] = [];

  const port = {
    name,
    postMessage: (message: Record<string, unknown>) => sent.push(message),
    onMessage: { addListener: messages.addListener },
    onDisconnect: { addListener: disconnects.addListener },
    disconnect: () => disconnects.emit(),
  } as unknown as chrome.runtime.Port;

  return {
    port,
    sent,
    receive: (message) => messages.emit(message),
    disconnect: () => disconnects.emit(),
  };
}

export interface ChromeStub {
  connect(port: chrome.runtime.Port): void;
  storage: Record<string, unknown>;
}

/** Installs a minimal `chrome` global and returns handles into it. */
export function installChrome(
  storage: Record<string, unknown> = {},
): ChromeStub {
  const connections = listenerSet<[chrome.runtime.Port]>();

  const stub = {
    i18n: {
      // Returning the key keeps assertions readable and mirrors the fallback in
      // `t()` when a string is missing.
      getMessage: (key: string) => key,
      getUILanguage: () => "en",
    },
    runtime: {
      onConnect: { addListener: connections.addListener },
      onMessage: { addListener: () => undefined },
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      sync: {
        get: (keys: unknown) =>
          Promise.resolve(
            typeof keys === "string"
              ? { [keys]: storage[keys] }
              : { ...storage },
          ),
        set: (items: Record<string, unknown>) => {
          Object.assign(storage, items);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          for (const key of [keys].flat()) delete storage[key];
          return Promise.resolve();
        },
      },
      onChanged: { addListener: () => undefined },
    },
    contextMenus: {
      removeAll: () => Promise.resolve(),
      create: () => undefined,
      onClicked: { addListener: () => undefined },
    },
    commands: { onCommand: { addListener: () => undefined } },
  };

  (globalThis as Record<string, unknown>).chrome = stub;

  return { connect: (port) => connections.emit(port), storage };
}

export interface FakeModelOptions {
  /** Chunks the stream yields, one at a time. */
  chunks?: string[];
  /** Milliseconds between chunks, so a test can abort mid-stream. */
  delayMs?: number;
  /** Set when the run is aborted, for assertions. */
  onAbort?: () => void;
}

/**
 * A stand-in for `LanguageModel` that streams slowly enough to be cancelled and
 * records whether the abort signal was honoured.
 */
export function installLanguageModel(options: FakeModelOptions = {}): {
  aborted: () => boolean;
} {
  const { chunks = ["one ", "two ", "three"], delayMs = 0 } = options;
  let aborted = false;

  const session = {
    clone: () => Promise.resolve(session),
    destroy: () => undefined,
    async *promptStreaming(_input: string, opts?: { signal?: AbortSignal }) {
      // The consumer stops pulling as soon as the signal fires, so a check
      // inside the loop would never run. Observe the signal itself instead.
      const signal = opts?.signal;
      const onAbort = () => {
        aborted = true;
        options.onAbort?.();
      };
      if (signal?.aborted) onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        for (const chunk of chunks) {
          if (signal?.aborted) return;
          if (delayMs)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          yield chunk;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };

  (globalThis as Record<string, unknown>).LanguageModel = {
    availability: () => Promise.resolve("available"),
    create: () => Promise.resolve(session),
  };

  return { aborted: () => aborted };
}

/** Removes every global a test installed, so cases stay independent. */
export function clearGlobals(): void {
  for (const name of [
    "chrome",
    "LanguageModel",
    "Rewriter",
    "Proofreader",
    "Translator",
    "LanguageDetector",
  ]) {
    delete (globalThis as Record<string, unknown>)[name];
  }
}
