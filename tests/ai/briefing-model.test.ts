// The briefing's own model and effort settings (docs/63, docs/65): which model
// each ThinkingKind resolves to, and what happens to a briefing model the
// provider has retired. The briefing is the one stage that spends money with
// nobody watching, so "it silently fell back to the chat model" is the failure
// this file exists to catch. AppData is in memory, the store is the real
// singleton. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { enforceKnownModel, resolveModel, type ThinkingKind } from "../../src/ai/model-call";
import { defaultModelFor, providers, type ProviderId } from "../../src/ai/providers";
import {
  DEFAULT_SETTINGS,
  rebuildSettingsStoreForTests,
  SETTINGS_FILE,
  type Settings,
} from "../../src/platform/app/settings";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
  rebuildSettingsStoreForTests();
});

function persist(over: Partial<Settings>): void {
  disk.files.set(
    SETTINGS_FILE,
    JSON.stringify({ ...DEFAULT_SETTINGS, defaultProviderId: "anthropic", ...over }),
  );
}

const BRIEFING: ThinkingKind[] = ["briefing", "briefing-screen"];
const CONVERSATIONAL: ThinkingKind[] = ["chat", "prep"];

test("with no briefing model set, every kind runs on the default model", async () => {
  persist({ defaultModelId: "chat-model", briefingModelId: null });
  for (const kind of [...CONVERSATIONAL, ...BRIEFING]) {
    expect((await resolveModel(kind)).modelId).toBe("chat-model");
  }
});

test("a briefing model is used by both briefing stages and by nothing else", async () => {
  persist({ defaultModelId: "chat-model", briefingModelId: "cheap-model" });
  for (const kind of BRIEFING) {
    expect((await resolveModel(kind)).modelId).toBe("cheap-model");
  }
  for (const kind of CONVERSATIONAL) {
    expect((await resolveModel(kind)).modelId).toBe("chat-model");
  }
});

// The provider is never the briefing's to choose: credentials are single-active
// (src/ai/credentials.ts), so a second provider here would have no key.
test("the briefing runs on the default provider, whatever model it names", async () => {
  persist({ defaultProviderId: "deepseek", defaultModelId: "chat-model", briefingModelId: "cheap" });
  for (const kind of BRIEFING) {
    expect((await resolveModel(kind)).providerId).toBe("deepseek");
  }
});

test("each kind reads its own effort setting", async () => {
  persist({
    defaultModelId: "chat-model",
    chatThinking: "high",
    prepThinking: "medium",
    briefingScreenThinking: "off",
    briefingThinking: "low",
  });
  expect((await resolveModel("chat")).reasoning).toBe("high");
  expect((await resolveModel("prep")).reasoning).toBe("medium");
  // "off" means no reasoning is passed at all, not a level named off.
  expect((await resolveModel("briefing-screen")).reasoning).toBeUndefined();
  expect((await resolveModel("briefing")).reasoning).toBe("low");
});

// An id no provider will ever carry: a settings file written against a model the
// catalog has since dropped, or synced in from a device on an older build.
const RETIRED = "claude-from-a-previous-build";

function settingsFor(over: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, defaultProviderId: "anthropic", ...over };
}

test("a retired briefing model is cleared rather than replaced, and the user is told", () => {
  const live = defaultModelFor("anthropic")!;
  const result = enforceKnownModel(settingsFor({ defaultModelId: live, briefingModelId: RETIRED }));
  // Cleared, not swapped for the widest window the provider has: unset follows
  // the chat model, and picking the widest one is what this setting exists to
  // avoid.
  expect(result.settings.briefingModelId).toBeNull();
  expect(result.settings.defaultModelId).toBe(live);
  expect(result.notice).toContain(RETIRED);
  expect(result.notice).toContain(providers.anthropic.name);
});

test("both models retired at once produces one notice naming both", () => {
  const result = enforceKnownModel(
    settingsFor({ defaultModelId: RETIRED, briefingModelId: "another-old-one" }),
  );
  expect(result.settings.defaultModelId).toBe(defaultModelFor("anthropic"));
  expect(result.settings.briefingModelId).toBeNull();
  expect(result.notice).toContain(RETIRED);
  expect(result.notice).toContain("another-old-one");
});

test("a briefing model the catalog still carries is left exactly as it was", () => {
  for (const id of Object.keys(providers) as ProviderId[]) {
    const model = defaultModelFor(id);
    if (!model) continue;
    const before = settingsFor({
      defaultProviderId: id,
      defaultModelId: model,
      briefingModelId: model,
    });
    const result = enforceKnownModel(before);
    expect(result.notice).toBeNull();
    expect(result.settings).toBe(before);
  }
});
