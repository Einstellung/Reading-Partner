// Unit tests for settings (src/settings.ts): the thinking defaults, the
// setting -> pi-ai reasoning-level mapping, and that loadSettings fills defaults
// over a persisted file (so an old file without the thinking keys still loads).
// The Tauri fs plugin is mocked with an in-memory file. Run: bun test.

import { expect, mock, test } from "bun:test";

// In-memory backing for the mocked @tauri-apps/plugin-fs used by loadSettings.
let fileContent: string | null = null;
mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async () => fileContent !== null,
  mkdir: async () => {},
  readTextFile: async () => {
    if (fileContent === null) throw new Error("no file");
    return fileContent;
  },
  writeTextFile: async (_path: string, content: string) => {
    fileContent = content;
  },
}));

const { AI_LANGUAGE_OPTIONS, DEFAULT_SETTINGS, languageInstruction, loadSettings, toReasoning } =
  await import("../src/settings");

test("thinking defaults are low (chat) and medium (prep)", () => {
  expect(DEFAULT_SETTINGS.chatThinking).toBe("low");
  expect(DEFAULT_SETTINGS.prepThinking).toBe("medium");
});

test("toReasoning maps off -> undefined and passes the levels through", () => {
  expect(toReasoning("off")).toBeUndefined();
  expect(toReasoning("low")).toBe("low");
  expect(toReasoning("medium")).toBe("medium");
  expect(toReasoning("high")).toBe("high");
});

test("loadSettings returns the defaults when nothing is persisted", async () => {
  fileContent = null;
  const s = await loadSettings();
  expect(s).toEqual(DEFAULT_SETTINGS);
});

test("loadSettings round-trips a fully persisted object", async () => {
  const saved = {
    defaultProviderId: "anthropic",
    defaultModelId: "claude",
    semanticScholarApiKey: "k",
    chatThinking: "high",
    prepThinking: "off",
    illustrationApiBase: "https://x.test",
    illustrationModel: "m",
    sttApiBase: "https://stt.test",
    sttModel: "sense",
    autoNotes: false,
    aiLanguage: "zh-CN",
  };
  fileContent = JSON.stringify(saved);
  const s = await loadSettings();
  expect(s).toEqual(saved);
});

test("loadSettings fills the thinking defaults for an old file missing them", async () => {
  fileContent = JSON.stringify({
    defaultProviderId: "openai",
    defaultModelId: "gpt",
    semanticScholarApiKey: null,
  });
  const s = await loadSettings();
  expect(s.chatThinking).toBe("low");
  expect(s.prepThinking).toBe("medium");
  expect(s.defaultProviderId).toBe("openai");
});

test("aiLanguage defaults to auto and an old file without it loads as auto", async () => {
  expect(DEFAULT_SETTINGS.aiLanguage).toBe("auto");
  fileContent = JSON.stringify({ defaultProviderId: "openai", defaultModelId: "gpt" });
  const s = await loadSettings();
  expect(s.aiLanguage).toBe("auto");
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
