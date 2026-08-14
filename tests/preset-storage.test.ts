import test from "node:test";
import assert from "node:assert/strict";

import {
  isPresetKey,
  presetsFromStorage,
  storageDiff,
  storageKey,
} from "../src/shared/preset-storage.ts";
import { CUSTOM_LIMIT, type CustomPreset } from "../src/shared/rules.ts";

const preset = (id: string, createdAt = 0): CustomPreset => ({
  id,
  label: `Preset ${id}`,
  instruction: "Rewrite it.",
  englishOnly: false,
  createdAt,
});

test("only preset keys are read back", () => {
  assert.equal(isPresetKey(storageKey("abc")), true);
  assert.equal(isPresetKey("customPresets"), false);

  const presets = presetsFromStorage({
    [storageKey("a")]: preset("a", 1),
    [storageKey("b")]: preset("b", 2),
    someOtherSetting: { id: "x", label: "x", instruction: "x" },
  });

  assert.deepEqual(
    presets.map((p) => p.id),
    ["a", "b"],
  );
});

test("corrupt entries are dropped rather than crashing the panel", () => {
  const presets = presetsFromStorage({
    [storageKey("good")]: preset("good"),
    [storageKey("bad")]: { id: "bad", label: "", instruction: "" },
    [storageKey("worse")]: "not an object",
  });

  assert.deepEqual(
    presets.map((p) => p.id),
    ["good"],
  );
});

test("the stored count is capped", () => {
  const many = Object.fromEntries(
    Array.from({ length: CUSTOM_LIMIT + 5 }, (_, i) => [storageKey(`p${i}`), preset(`p${i}`, i)]),
  );
  assert.equal(presetsFromStorage(many).length, CUSTOM_LIMIT);
});

test("saving computes both the writes and the deletions", () => {
  const diff = storageDiff([preset("a"), preset("c")], ["a", "b"]);

  assert.deepEqual(Object.keys(diff.set), [storageKey("a"), storageKey("c")]);
  // "b" was deleted in the UI, so its key has to go too
  assert.deepEqual(diff.remove, [storageKey("b")]);
});

test("deleting everything removes every previous key", () => {
  const diff = storageDiff([], ["a", "b"]);
  assert.deepEqual(diff.set, {});
  assert.deepEqual(diff.remove, [storageKey("a"), storageKey("b")]);
});
