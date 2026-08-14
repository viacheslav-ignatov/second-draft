/**
 * The panel's end of the port.
 *
 * Owns request ids and drops stale replies, so the rest of the content script
 * never has to think about a run the user has already moved on from.
 */

import {
  PORT_NAME,
  isRunReply,
  type DetectedLanguage,
  type PortReply,
  type PortRequest,
} from "../shared/messages.ts";

const DETECT_TIMEOUT_MS = 3000;

export interface ClientHandlers {
  onStatus(text: string, isError?: boolean): void;
  onChunk(text: string): void;
  onDone(text: string, label: string): void;
  onWarm(state: "ready" | "downloadable" | "unavailable"): void;
}

export class WorkerClient {
  private port: chrome.runtime.Port | null = null;
  private runId = 0;
  private detectId = 0;
  /**
   * Keyed by request id, because more than one detection can be in flight: the
   * picker starts one, and the user can click a chip before it answers. A single
   * slot let the first request's timeout resolve itself while discarding the
   * second request's resolver, and the panel then waited forever.
   */
  private readonly pendingDetect = new Map<
    number,
    (language: DetectedLanguage | null) => void
  >();
  private language: DetectedLanguage | null = null;

  private readonly handlers: ClientHandlers;

  // Assigned in the body rather than declared as a parameter property: the
  // tests run under `node --test`, whose strip-only mode cannot compile one.
  constructor(handlers: ClientHandlers) {
    this.handlers = handlers;
  }

  private connect(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: PORT_NAME });
    port.onDisconnect.addListener(() => (this.port = null));
    port.onMessage.addListener((reply: PortReply) => {
      this.receive(reply);
    });
    this.port = port;
    return port;
  }

  private send(request: PortRequest): void {
    this.connect().postMessage(request);
  }

  private receive(reply: PortReply): void {
    // Switching presets mid-stream used to leave two generations writing into
    // the same box; anything from a superseded request is dropped here.
    if (isRunReply(reply) && reply.id !== this.runId) return;
    if (reply.type === "language" && reply.id !== this.detectId) return;

    switch (reply.type) {
      case "language":
        this.language = reply.language;
        this.settleDetect(reply.id, reply.language);
        break;
      case "status":
        this.handlers.onStatus(reply.text);
        break;
      case "chunk":
        this.handlers.onChunk(reply.text);
        break;
      case "done":
        this.handlers.onDone(reply.text, reply.label);
        break;
      case "error":
        this.handlers.onStatus(reply.text, true);
        break;
      case "warm":
        this.handlers.onWarm(reply.state);
        break;
    }
  }

  /** Wakes the worker and loads the model while the user reads the chips. */
  prewarm(): void {
    this.send({ type: "prewarm", id: ++this.runId });
  }

  detect(text: string): Promise<DetectedLanguage | null> {
    if (this.language) return Promise.resolve(this.language);
    const id = ++this.detectId;
    this.send({ type: "detect", text, id });
    return new Promise((resolve) => {
      this.pendingDetect.set(id, resolve);
      // Detection is small and fast; if it stalls, carry on without it. Each
      // timer only ever gives up on its own request.
      setTimeout(() => {
        if (this.pendingDetect.delete(id)) resolve(null);
      }, DETECT_TIMEOUT_MS);
    });
  }

  /**
   * An answer to request N also answers everything asked before it: the text
   * only grows while the panel is open, so an earlier, shorter prefix cannot
   * have a different language than the reply that superseded it.
   */
  private settleDetect(id: number, language: DetectedLanguage | null): void {
    for (const [pendingId, resolve] of [...this.pendingDetect]) {
      if (pendingId <= id) {
        this.pendingDetect.delete(pendingId);
        resolve(language);
      }
    }
  }

  run(presetId: string, text: string): void {
    this.send({
      type: "run",
      presetId,
      text,
      language: this.language,
      id: ++this.runId,
    });
  }

  get detectedLanguage(): DetectedLanguage | null {
    return this.language;
  }

  /** Forgets the detected language, e.g. when a different field is captured. */
  reset(): void {
    this.language = null;
    // Settle rather than just clear: once an entry is gone from the map its
    // timeout finds nothing to delete and stays silent, so a caller already
    // awaiting that detection would hang.
    for (const resolve of this.pendingDetect.values()) resolve(null);
    this.pendingDetect.clear();
  }

  disconnect(): void {
    this.port?.disconnect();
    this.port = null;
    this.reset();
  }
}
