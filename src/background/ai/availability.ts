/**
 * Probing the built-in AI surface.
 *
 * These globals have been renamed more than once and the availability contract
 * changed shape along the way (`capabilities()` before `availability()`), so
 * everything here is deliberately defensive: a missing global is "unavailable",
 * never an exception.
 */

import { errorMessage, errorName } from "../../shared/errors.ts";

export type Availability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available"
  /** Older builds. */
  | "readily"
  | "after-download";

/** The shape we actually rely on, including the legacy method. */
interface Probeable {
  availability?: (options?: unknown) => Promise<string>;
  capabilities?: () => Promise<{ available?: string }>;
}

/** Reads a global by name without assuming it exists in this Chrome build. */
export function resolveGlobal<T>(name: string): T | null {
  const value = (globalThis as Record<string, unknown>)[name];
  return value === undefined ? null : (value as T);
}

export async function availabilityOf(api: unknown, options?: unknown): Promise<Availability> {
  if (!api) return "unavailable";
  const probe = api as Probeable;
  try {
    if (typeof probe.availability === "function") {
      return (await probe.availability(options)) as Availability;
    }
    if (typeof probe.capabilities === "function") {
      const caps = await probe.capabilities();
      return (caps?.available ?? "unavailable") as Availability;
    }
  } catch (error) {
    console.warn("[second-draft] availability check failed", error);
  }
  return "unavailable";
}

export const isUsable = (state: Availability): boolean =>
  state === "available" || state === "readily";

export const needsDownload = (state: Availability): boolean =>
  state === "downloadable" || state === "downloading" || state === "after-download";

/** Reachable at all, whether or not the asset still has to be fetched. */
export const isSupported = (state: Availability): boolean =>
  isUsable(state) || needsDownload(state);

export const isAbortError = (error: unknown): boolean =>
  errorName(error) === "AbortError" || /abort/i.test(errorMessage(error));

export const isDeadSession = (error: unknown): boolean =>
  /destroyed|invalidated|detached|no longer valid/i.test(errorMessage(error));
