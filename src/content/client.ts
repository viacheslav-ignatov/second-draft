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
  private pendingDetect: ((language: DetectedLanguage | null) => void) | null = null;
  private language: DetectedLanguage | null = null;

  constructor(private readonly handlers: ClientHandlers) {}

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
        this.pendingDetect?.(reply.language);
        this.pendingDetect = null;
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
    this.send({ type: "detect", text, id: ++this.detectId });
    return new Promise((resolve) => {
      this.pendingDetect = resolve;
      // Detection is small and fast; if it stalls, carry on without it.
      setTimeout(() => {
        if (this.pendingDetect) {
          this.pendingDetect = null;
          resolve(null);
        }
      }, DETECT_TIMEOUT_MS);
    });
  }

  run(presetId: string, text: string): void {
    this.send({ type: "run", presetId, text, language: this.language, id: ++this.runId });
  }

  get detectedLanguage(): DetectedLanguage | null {
    return this.language;
  }

  /** Forgets the detected language, e.g. when a different field is captured. */
  reset(): void {
    this.language = null;
    this.pendingDetect = null;
  }

  disconnect(): void {
    this.port?.disconnect();
    this.port = null;
    this.reset();
  }
}
