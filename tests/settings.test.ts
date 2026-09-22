// Unit tests for settings (src/platform/app/settings.ts): the thinking defaults, the
// setting -> pi-ai reasoning-level mapping, and that loadSettings fills defaults
// over a persisted file (so an old file without the thinking keys still loads).
// AppData is in memory, the store is the real singleton. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  AI_LANGUAGE_OPTIONS,
  DEFAULT_SETTINGS,
  flushSettings,
  languageInstruction,
  loadSettings,
  rebuildSettingsStoreForTests,
  saveSettings,
  SETTINGS_FILE,
  toReasoning,
  type Settings,
} from "../src/platform/app/settings";
import { onStoreError } from "../src/platform/app/store-errors";
import { installAppData, type FakeDisk } from "./support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
  // A save one case scheduled and did not flush would otherwise land on the next
  // case's disk.
  rebuildSettingsStoreForTests();
});

// settings.json as an earlier run left it.
function persist(settings: Record<string, unknown>): void {
  disk.files.set(SETTINGS_FILE, JSON.stringify(settings));
}

test("thinking defaults are low (chat) and medium (prep)", () => {
  expect(DEFAULT_SETTINGS.chatThinking).toBe("low");
  expect(DEFAULT_SETTINGS.prepThinking).toBe("medium");
});

// fingerDraw and backgroundCollect moved to device.json (docs/36). The keys stay
// on disk for a device still on the old build, so they have to survive a
// load/save round trip here — but nothing in the account's shape declares them
// any more, and no default here can answer for another machine.
test("the two per-device settings are gone from the account's shape", () => {
  expect("fingerDraw" in DEFAULT_SETTINGS).toBe(false);
  expect("backgroundCollect" in DEFAULT_SETTINGS).toBe(false);
});

test("an old file's per-device keys are carried through untouched", async () => {
  persist({ defaultProviderId: "openai", fingerDraw: true, backgroundCollect: false });
  const s = (await loadSettings()) as unknown as Record<string, unknown>;
  expect(s.fingerDraw).toBe(true);
  expect(s.backgroundCollect).toBe(false);
});

// autoNotes was deleted (docs/09): preparation is started by the entries that
// mean it, not by a switch. An old settings.json still carrying the key must
// load — the parse is a merge over the defaults, so an unknown key is data, not
// an error — and every real setting beside it has to survive.
test("an old file carrying the deleted autoNotes key still loads", async () => {
  expect("autoNotes" in DEFAULT_SETTINGS).toBe(false);
  persist({ autoNotes: false, defaultProviderId: "openai", aiLanguage: "zh-CN" });
  const s = await loadSettings();
  expect(s.defaultProviderId).toBe("openai");
  expect(s.aiLanguage).toBe("zh-CN");
  expect(s.chatThinking).toBe("low");
  expect((s as unknown as Record<string, unknown>).autoNotes).toBe(false);
});

test("toReasoning maps off -> undefined and passes the levels through", () => {
  expect(toReasoning("off")).toBeUndefined();
  expect(toReasoning("low")).toBe("low");
  expect(toReasoning("medium")).toBe("medium");
  expect(toReasoning("high")).toBe("high");
});

test("loadSettings returns the defaults when nothing is persisted", async () => {
  const s = await loadSettings();
  expect(s).toEqual(DEFAULT_SETTINGS);
});

test("loadSettings round-trips a fully persisted object", async () => {
  const saved: Settings = {
    defaultProviderId: "anthropic",
    defaultModelId: "claude",
    everydayModelId: "haiku",
    semanticScholarApiKey: "k",
    chatThinking: "high",
    prepThinking: "off",
    briefingScreenThinking: "off",
    briefingThinking: "low",
    sttApiBase: "https://stt.test",
    sttModel: "sense",
    dictationLocale: "en-US",
    aiLanguage: "zh-CN",
    meals: true,
  };
  persist(saved as unknown as Record<string, unknown>);
  const s = await loadSettings();
  expect(s).toEqual(saved);
});

test("loadSettings fills the thinking defaults for an old file missing them", async () => {
  persist({
    defaultProviderId: "openai",
    defaultModelId: "gpt",
    semanticScholarApiKey: null,
  });
  const s = await loadSettings();
  expect(s.chatThinking).toBe("low");
  expect(s.prepThinking).toBe("medium");
  expect(s.defaultProviderId).toBe("openai");
});

// The briefing's own keys were added after files existed without them. Their
// defaults are the two the briefing used to borrow (chatThinking for screening,
// prepThinking for analysis), so an old file loads into the work it was already
// doing rather than into a quietly cheaper or dearer night.
test("an old file without the briefing keys loads into the briefing it already had", async () => {
  expect(DEFAULT_SETTINGS.everydayModelId).toBeNull();
  expect(DEFAULT_SETTINGS.briefingScreenThinking).toBe(DEFAULT_SETTINGS.chatThinking);
  expect(DEFAULT_SETTINGS.briefingThinking).toBe(DEFAULT_SETTINGS.prepThinking);

  persist({ defaultProviderId: "openai", defaultModelId: "gpt" });
  const s = await loadSettings();
  expect(s.everydayModelId).toBeNull();
  expect(s.briefingScreenThinking).toBe("low");
  expect(s.briefingThinking).toBe("medium");
});

// --- briefingModelId -> everydayModelId (docs/75) -----------------------------
//
// The field was the briefing's alone and is now the whole everyday tier's. A
// reader who picked a cheaper model for the night picked it for exactly the
// reason the tier exists, so the value is read across rather than dropped — and
// dropping it would put the briefing back on the talk model without telling
// anyone, which is the one outcome this rename may not produce.

test("an old file's briefing model becomes the everyday model", async () => {
  persist({ defaultProviderId: "anthropic", defaultModelId: "opus", briefingModelId: "haiku" });
  const s = await loadSettings();
  expect(s.everydayModelId).toBe("haiku");
  expect(s.defaultModelId).toBe("opus");
});

test("an old file that never set a briefing model still follows the talk model", async () => {
  persist({ defaultProviderId: "anthropic", defaultModelId: "opus", briefingModelId: null });
  expect((await loadSettings()).everydayModelId).toBeNull();
});

// Both keys present means the file was written by this build or later: the new
// one is the answer, whatever the old one still says.
test("a file carrying both keys is read as the new one", async () => {
  persist({
    defaultProviderId: "anthropic",
    defaultModelId: "opus",
    briefingModelId: "haiku",
    everydayModelId: "flash",
  });
  expect((await loadSettings()).everydayModelId).toBe("flash");
});

// The old key is left in the file. A device on an older build reads its own copy
// of settings.json, and the fields merge a sync does would carry a dropped key
// to it as a deletion — the same reason autoNotes is still there.
test("the old briefing key is carried through a load untouched", async () => {
  persist({ defaultProviderId: "anthropic", defaultModelId: "opus", briefingModelId: "haiku" });
  const s = (await loadSettings()) as unknown as Record<string, unknown>;
  expect(s.briefingModelId).toBe("haiku");
  expect("briefingModelId" in DEFAULT_SETTINGS).toBe(false);
});

test("aiLanguage defaults to auto and an old file without it loads as auto", async () => {
  expect(DEFAULT_SETTINGS.aiLanguage).toBe("auto");
  persist({ defaultProviderId: "openai", defaultModelId: "gpt" });
  const s = await loadSettings();
  expect(s.aiLanguage).toBe("auto");
});

// The save path runs with no window. A store built at import time cannot capture
// window.setTimeout, because in a headless run there is no window to capture.
test("saveSettings schedules a write with no window in the process", async () => {
  expect(typeof globalThis.window).toBe("undefined");
  saveSettings({ ...DEFAULT_SETTINGS, defaultProviderId: "openai" });
  await flushSettings();
  expect(disk.writes).toEqual([SETTINGS_FILE]);
  expect(JSON.parse(disk.files.get(SETTINGS_FILE) ?? "null")).toMatchObject({
    defaultProviderId: "openai",
  });
});

// A file that exists and will not open is a failure, not an empty file. Handed
// the defaults, the settings panel would show a reader who has configured a
// provider that they have configured none — and the next save would make that
// true. So the load raises, and the save asks the disk again and refuses.
test("an unreadable file raises out of the load and is not written over", async () => {
  const errors: string[] = [];
  const off = onStoreError((e) => errors.push(e.scope));
  try {
    disk.files.set(SETTINGS_FILE, JSON.stringify({ defaultProviderId: "openai" }));
    disk.unreadable.add(SETTINGS_FILE);
    expect(loadSettings()).rejects.toThrow(SETTINGS_FILE);

    saveSettings({ ...DEFAULT_SETTINGS, defaultProviderId: "anthropic" });
    await flushSettings();
    expect(disk.writes).toEqual([]);
    expect(errors).toContain("settings");
    expect(disk.files.get(SETTINGS_FILE)).toBe(JSON.stringify({ defaultProviderId: "openai" }));

    // The same store, no rebuild: the refusal was a question asked of the disk,
    // not a flag set for the life of the process.
    disk.unreadable.delete(SETTINGS_FILE);
    saveSettings({ ...DEFAULT_SETTINGS, defaultProviderId: "anthropic" });
    await flushSettings();
    expect(disk.writes).toEqual([SETTINGS_FILE]);
  } finally {
    off();
  }
});

test("languageInstruction is empty on auto and names the native language otherwise", () => {
  expect(languageInstruction("auto")).toBe("");
  // Every non-auto option maps to a one-sentence instruction naming its own label.
  for (const { value, label } of AI_LANGUAGE_OPTIONS) {
    if (value === "auto") continue;
    const instruction = languageInstruction(value);
    expect(instruction).toContain(label);
    expect(instruction).toContain("All user-facing output must be written in");
  }
  expect(languageInstruction("ja")).toBe(
    "Respond in 日本語. All user-facing output must be written in 日本語.",
  );
});
