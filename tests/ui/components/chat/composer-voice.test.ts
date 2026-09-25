// The composer's voice input, the pure half (src/ui/components/chat/composer-voice.ts):
// which surfaces get the mic, and which model polishes a transcript.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  cleanupModelFromSettings,
  resolveComposerVoice,
} from "../../../../src/ui/components/chat/composer-voice";

test("the mic is on unless the caller opts out or the host cannot", () => {
  expect(resolveComposerVoice(undefined, true)).toEqual({ glossary: "" });
  expect(resolveComposerVoice({}, true)).toEqual({ glossary: "" });
  expect(resolveComposerVoice({ glossary: "CD-LAM" }, true)).toEqual({ glossary: "CD-LAM" });
  expect(resolveComposerVoice(false, true)).toBeNull();
  expect(resolveComposerVoice({ glossary: "CD-LAM" }, false)).toBeNull();
});

test("the cleanup model is the default chat model at the chat's thinking level", () => {
  expect(
    cleanupModelFromSettings({ defaultProviderId: "anthropic", defaultModelId: "m", chatThinking: "low" }),
  ).toEqual({ providerId: "anthropic", modelId: "m", reasoning: "low" });
  // "off" omits reasoning rather than sending a level.
  expect(
    cleanupModelFromSettings({ defaultProviderId: "anthropic", defaultModelId: "m", chatThinking: "off" }),
  ).toEqual({ providerId: "anthropic", modelId: "m", reasoning: undefined });
});

test("no default provider or model means no polish pass", () => {
  expect(
    cleanupModelFromSettings({ defaultProviderId: null, defaultModelId: "m", chatThinking: "low" }),
  ).toBeNull();
  expect(
    cleanupModelFromSettings({ defaultProviderId: "anthropic", defaultModelId: null, chatThinking: "low" }),
  ).toBeNull();
  expect(
    cleanupModelFromSettings({ defaultProviderId: "", defaultModelId: "m", chatThinking: "low" }),
  ).toBeNull();
});
