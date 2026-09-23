// The two model tiers (docs/75): which tier each kind of work is classified
// into, which model a tier resolves to, and what happens to an everyday model
// the provider has retired. The everyday tier is what spends money with nobody
// watching — the briefing every night, the meals line all week — so "it silently
// fell back to the talk model" and "a conversation quietly ran on the cheap one"
// are the two failures this file exists to catch. AppData is in memory, the
// store is the real singleton. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { enforceKnownModel, resolveModel, type ThinkingKind } from "../../src/ai/model-call";
import { tierForKind } from "../../src/ai/model-tier";
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

const EVERYDAY: ThinkingKind[] = ["prep", "distill", "briefing", "briefing-screen", "meals"];
const TALK: ThinkingKind[] = ["chat"];

// The table itself, read straight. Which work is everyday is a decision made in
// code, in one place; a task that wants to be cheap is a line there and nothing
// else, and this is that line's only public statement.
test("every kind of headless work is classified, and the classification is the table", () => {
  for (const kind of EVERYDAY) expect(tierForKind(kind)).toBe("everyday");
  for (const kind of TALK) expect(tierForKind(kind)).toBe("talk");
});

// Lesson prep, the sub-agent runs, the nightly dream and the distillation passes
// are background work nobody waits on. Named here so moving any of them back is
// a deliberate edit to this file rather than a drift.
test("lesson prep and distillation are everyday work", () => {
  expect(tierForKind("prep")).toBe("everyday");
  expect(tierForKind("distill")).toBe("everyday");
});

// Moving distillation to the everyday model must not move its effort: it keeps
// thinking at the chat setting, not at the pipelines' one.
test("distillation runs on the everyday model at the chat effort", async () => {
  persist({
    defaultModelId: "chat-model",
    everydayModelId: "cheap-model",
    chatThinking: "high",
    prepThinking: "low",
  });
  const distill = await resolveModel("distill");
  expect(distill.modelId).toBe("cheap-model");
  expect(distill.reasoning).toBe("high");
  const prep = await resolveModel("prep");
  expect(prep.modelId).toBe("cheap-model");
  expect(prep.reasoning).toBe("low");
});

test("with no everyday model set, every kind runs on the default model", async () => {
  persist({ defaultModelId: "chat-model", everydayModelId: null });
  for (const kind of [...TALK, ...EVERYDAY]) {
    expect((await resolveModel(kind)).modelId).toBe("chat-model");
  }
});

test("an everyday model is used by the everyday kinds and by nothing else", async () => {
  persist({ defaultModelId: "chat-model", everydayModelId: "cheap-model" });
  for (const kind of EVERYDAY) {
    expect((await resolveModel(kind)).modelId).toBe("cheap-model");
  }
  for (const kind of TALK) {
    expect((await resolveModel(kind)).modelId).toBe("chat-model");
  }
});

// The provider is never the tier's to choose: credentials are single-active
// (src/ai/credentials.ts), so a second provider here would have no key.
test("everyday work runs on the default provider, whatever model it names", async () => {
  persist({ defaultProviderId: "deepseek", defaultModelId: "chat-model", everydayModelId: "cheap" });
  for (const kind of EVERYDAY) {
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
  expect((await resolveModel("distill")).reasoning).toBe("high");
  // "off" means no reasoning is passed at all, not a level named off.
  expect((await resolveModel("briefing-screen")).reasoning).toBeUndefined();
  expect((await resolveModel("briefing")).reasoning).toBe("low");
  // The meals turn borrows the conversational effort rather than adding a
  // setting of its own.
  expect((await resolveModel("meals")).reasoning).toBe("high");
});

// --- a model the provider has dropped ----------------------------------------

// An id no provider will ever carry: a settings file written against a model the
// catalog has since dropped, or synced in from a device on an older build.
const RETIRED = "claude-from-a-previous-build";

function settingsFor(over: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, defaultProviderId: "anthropic", ...over };
}

test("a retired everyday model is cleared rather than replaced, and the user is told", () => {
  const live = defaultModelFor("anthropic")!;
  const result = enforceKnownModel(settingsFor({ defaultModelId: live, everydayModelId: RETIRED }));
  // Cleared, not swapped for the widest window the provider has: unset follows
  // the chat model, and picking the widest one is what this setting exists to
  // avoid.
  expect(result.settings.everydayModelId).toBeNull();
  expect(result.settings.defaultModelId).toBe(live);
  expect(result.notice).toContain(RETIRED);
  expect(result.notice).toContain(providers.anthropic.name);
});

test("both models retired at once produces one notice naming both", () => {
  const result = enforceKnownModel(
    settingsFor({ defaultModelId: RETIRED, everydayModelId: "another-old-one" }),
  );
  expect(result.settings.defaultModelId).toBe(defaultModelFor("anthropic"));
  expect(result.settings.everydayModelId).toBeNull();
  expect(result.notice).toContain(RETIRED);
  expect(result.notice).toContain("another-old-one");
});

test("an everyday model the catalog still carries is left exactly as it was", () => {
  for (const id of Object.keys(providers) as ProviderId[]) {
    const model = defaultModelFor(id);
    if (!model) continue;
    const before = settingsFor({
      defaultProviderId: id,
      defaultModelId: model,
      everydayModelId: model,
    });
    const result = enforceKnownModel(before);
    expect(result.notice).toBeNull();
    expect(result.settings).toBe(before);
  }
});
