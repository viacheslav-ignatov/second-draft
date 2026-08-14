/**
 * Custom presets in `chrome.storage.sync`, one key per preset.
 *
 * `chrome.storage.sync` caps a *single item* at 8 KB. An earlier version kept
 * every preset in one array, which would have started failing to save somewhere
 * around the eighth long instruction — silently, since the rejection was never
 * caught. One key each keeps every item an order of magnitude below the cap.
 */

import {
  CUSTOM_LIMIT,
  normalizeCustomPreset,
  sortCustomPresets,
  type CustomPreset,
} from "./rules.ts";

export const KEY_PREFIX = "preset:";

export const storageKey = (id: string): string => KEY_PREFIX + id;

export const isPresetKey = (key: string): boolean => key.startsWith(KEY_PREFIX);

/** Pure: turns a raw storage dump into a validated, ordered, capped list. */
export function presetsFromStorage(all: Record<string, unknown>): CustomPreset[] {
  const list = Object.entries(all)
    .filter(([key]) => isPresetKey(key))
    .map(([, value]) => normalizeCustomPreset(value))
    .filter((p): p is CustomPreset => p !== null);
  return sortCustomPresets(list).slice(0, CUSTOM_LIMIT);
}

/** Pure: which keys to write and which to delete for a given desired state. */
export function storageDiff(
  next: CustomPreset[],
  previousIds: Iterable<string>,
): { set: Record<string, CustomPreset>; remove: string[] } {
  const keep = new Set(next.map((p) => p.id));
  return {
    set: Object.fromEntries(next.map((p) => [storageKey(p.id), p])),
    remove: [...previousIds].filter((id) => !keep.has(id)).map(storageKey),
  };
}

export async function readPresets(): Promise<CustomPreset[]> {
  try {
    return presetsFromStorage(await chrome.storage.sync.get(null));
  } catch (error) {
    console.warn("[second-draft] could not read custom presets", error);
    return [];
  }
}

/** Throws on quota or sync failure so the caller can tell the user. */
export async function writePresets(
  next: CustomPreset[],
  previousIds: Iterable<string>,
): Promise<void> {
  const { set, remove } = storageDiff(next, previousIds);
  if (remove.length) await chrome.storage.sync.remove(remove);
  if (Object.keys(set).length) await chrome.storage.sync.set(set);
}

/** 0.4.0 kept every preset in one `customPresets` array. Move them across once. */
export async function migrateLegacyPresets(): Promise<void> {
  try {
    const { customPresets: legacy } = await chrome.storage.sync.get("customPresets");
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    const migrated = legacy
      .map(normalizeCustomPreset)
      .filter((p): p is CustomPreset => p !== null)
      .map((p, i) => ({ ...p, createdAt: p.createdAt || Date.now() + i }));
    if (migrated.length) await writePresets(migrated, []);
    await chrome.storage.sync.remove("customPresets");
  } catch (error) {
    console.warn("[second-draft] preset migration failed", error);
  }
}
