// The companion's name and its introduction (docs/companion/90): the setting
// and how it is read, how settings.json carries it, the short block every
// assembled turn leads with, what about_app hands back, and the voice front's
// spoken version. Run: scripts/t.sh.

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  COMPANION_NAME_CAP,
  DEFAULT_COMPANION_NAME,
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  companionNameOf,
  flushSettings,
  loadSettings,
  migrateSettings,
  rebuildSettingsStoreForTests,
  saveSettings,
  type Settings,
} from "../../src/platform/app/settings";
import { mergeFile } from "../../src/platform/sync/merge";
import { assembleTurn, type AssembleInput } from "../../src/soul";
import { ABOUT_APP_TOOL, aboutAppText, buildAboutAppTool, firstSentence, introBlock } from "../../src/soul/intro";
import { registerThinkDesk, thinkDesk } from "../../src/soul/think";
import type { AgentTool } from "../../src/legion/durable/contract";
import { openDesk, registerDeskItemKind, registerPlaces, type DeskEnv, type DeskItem } from "../../src/desk";
import { rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import {
  FRONT_DUTY,
  FRONT_TOKEN_CAP,
  estimateTokens,
  frontFixedPrompt,
  frontRequest,
  frontSystemPrompt,
} from "../../src/soul/voice/front/context";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

let disk: FakeDisk;
const undo: (() => void)[] = [];

beforeEach(() => {
  disk = installAppData();
  rebuildSettingsStoreForTests();
  rebuildThreadStoreForTests();
});

afterEach(() => {
  while (undo.length) undo.pop()!();
});

// --- the setting ------------------------------------------------------------

const named = (companionName: unknown) => ({ companionName }) as Pick<Settings, "companionName">;

test("an unset name is the default, Kris", () => {
  expect(DEFAULT_COMPANION_NAME).toBe("Kris");
  expect(DEFAULT_SETTINGS.companionName).toBe("");
  expect(companionNameOf(DEFAULT_SETTINGS)).toBe("Kris");
});

test("whitespace is no name, and the name is trimmed and flattened to one line", () => {
  expect(companionNameOf(named("   \n\t "))).toBe("Kris");
  expect(companionNameOf(named("  Momo  "))).toBe("Momo");
  expect(companionNameOf(named("Mo\nmo  chan"))).toBe("Mo mo chan");
  expect(companionNameOf(named("小明"))).toBe("小明");
});

test("a long name is cut at the cap, by characters rather than UTF-16 units", () => {
  expect(companionNameOf(named("x".repeat(40)))).toBe("x".repeat(COMPANION_NAME_CAP));
  const emoji = "\u{1F600}".repeat(30);
  expect(Array.from(companionNameOf(named(emoji)))).toHaveLength(COMPANION_NAME_CAP);
  // A cut that lands on a space does not leave it hanging.
  expect(companionNameOf(named(`${"a".repeat(COMPANION_NAME_CAP - 1)} b`))).toBe("a".repeat(COMPANION_NAME_CAP - 1));
});

test("a non-string from an old or hand-edited file reads as the default", () => {
  expect(companionNameOf(named(42))).toBe("Kris");
  expect(companionNameOf(named(null))).toBe("Kris");
  expect(companionNameOf(named(undefined))).toBe("Kris");
  expect(companionNameOf(named({ first: "Momo" }))).toBe("Kris");
});

// --- settings.json ----------------------------------------------------------

test("a file written before the field loads with it unset", async () => {
  disk.files.set(SETTINGS_FILE, JSON.stringify({ aiLanguage: "zh-CN" }));
  const s = await loadSettings();
  expect(s.companionName).toBe("");
  expect(s.aiLanguage).toBe("zh-CN");
});

test("a non-string in the file loads as unset", () => {
  expect(migrateSettings({ companionName: 7 } as unknown as Partial<Settings>).companionName).toBe("");
  expect(migrateSettings({ companionName: "Momo" }).companionName).toBe("Momo");
});

test("the name is the account's: it is written to settings.json, not device.json", async () => {
  saveSettings({ ...DEFAULT_SETTINGS, companionName: "Momo" });
  await flushSettings();
  const account = JSON.parse(disk.files.get(SETTINGS_FILE) as string) as Record<string, unknown>;
  expect(account.companionName).toBe("Momo");
  const device = disk.files.get("device.json");
  if (typeof device === "string") expect(JSON.parse(device)).not.toHaveProperty("companionName");
  rebuildSettingsStoreForTests();
  expect((await loadSettings()).companionName).toBe("Momo");
});

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
const read = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

test("a sync merges the name as one field of its own", () => {
  const base = json({ ...DEFAULT_SETTINGS });
  // One device renames the companion, the other changes something else.
  const renamed = json({ ...DEFAULT_SETTINGS, companionName: "Momo" });
  const other = json({ ...DEFAULT_SETTINGS, chatThinking: "high" });
  const out = mergeFile({ path: SETTINGS_FILE, base, local: renamed, remote: other });
  expect(out.contested).toBe(false);
  expect(read(out.merged).companionName).toBe("Momo");
  expect(read(out.merged).chatThinking).toBe("high");
  // Both rename it: one name wins whole, the same one either way round.
  const a = json({ ...DEFAULT_SETTINGS, companionName: "Momo" });
  const b = json({ ...DEFAULT_SETTINGS, companionName: "Nova" });
  const forward = read(mergeFile({ path: SETTINGS_FILE, base, local: a, remote: b }).merged).companionName;
  const backward = read(mergeFile({ path: SETTINGS_FILE, base, local: b, remote: a }).merged).companionName;
  expect(["Momo", "Nova"]).toContain(forward as string);
  expect(backward).toBe(forward);
});

// --- the always-on block ----------------------------------------------------

/** What the always-on block may cost a turn, in the front's token estimate. */
const INTRO_TOKEN_BUDGET = 60;

test("the always-on block is the name, what the companion is, its line, and where the rest is", () => {
  const block = introBlock("Momo");
  expect(block.startsWith("You are Momo, the Lumen app's companion in the corner of every screen.")).toBe(true);
  expect(block).toContain("not a person");
  expect(block).toContain(`call ${ABOUT_APP_TOOL} first`);
  // No lists: what the app holds is about_app's to say.
  expect(block).not.toContain("Places in this app:");
  expect(block).not.toContain("\n- ");
});

test("the always-on block stays within its budget", () => {
  expect(estimateTokens(introBlock(DEFAULT_COMPANION_NAME))).toBeLessThanOrEqual(INTRO_TOKEN_BUDGET);
  // The longest name the setting allows costs only its own characters.
  const longest = "x".repeat(COMPANION_NAME_CAP);
  expect(estimateTokens(introBlock(longest))).toBeLessThanOrEqual(INTRO_TOKEN_BUDGET + COMPANION_NAME_CAP / 4);
});

test("the always-on block depends on the name alone", () => {
  expect(introBlock("Kris")).toBe(introBlock("Kris"));
  expect(introBlock("Momo")).not.toBe(introBlock("Kris"));
  expect(introBlock("Momo").split("Momo").join("Kris")).toBe(introBlock("Kris"));
});

// --- about_app --------------------------------------------------------------

const PLACES = [
  { id: "today", about: "Where the reader lands." },
  { id: "settings", about: "The settings." },
];
const TOOLS = [
  { name: "statement_write", description: "Write down what the reader said about themselves. Use it only when..." },
  { name: "go_to", description: "Take the reader to one of the places in this app.\n- today: ..." },
];

test("about_app hands back the name, the rules, and exactly the places and tools it is built with", async () => {
  const text = aboutAppText({ name: "Momo", places: PLACES, tools: TOOLS });
  expect(text.startsWith("You are Momo, the companion inside the Lumen app.")).toBe(true);
  expect(text).toContain("say your name is Momo");
  expect(text).toContain("Never invent a feature");
  expect(text).toContain("say this app does not have it");
  expect(text).toContain("- today: Where the reader lands.\n- settings: The settings.");
  expect(text).toContain("- statement_write: Write down what the reader said about themselves.\n");
  expect(text).toContain("- go_to: Take the reader to one of the places in this app.");
  expect(text).not.toContain("Use it only when");
  const tool = buildAboutAppTool({ name: "Momo", places: PLACES, tools: TOOLS });
  expect(tool.name).toBe(ABOUT_APP_TOOL);
  expect(await tool.execute({})).toBe(text);
  // A read with nothing to confirm.
  expect(tool.effect).toBe("read");
  expect(tool.gate).toBeUndefined();
  expect(tool.replay).toBe("safe");
});

test("about_app's description and schema are the same whatever it is built from", () => {
  const full = buildAboutAppTool({ name: "Momo", places: PLACES, tools: TOOLS });
  const bare = buildAboutAppTool({ name: "Kris", places: [], tools: [] });
  expect(bare.description).toBe(full.description);
  expect(JSON.stringify(bare.parameters)).toBe(JSON.stringify(full.parameters));
  expect(full.description).not.toContain("today");
  expect(full.description).not.toContain("Momo");
});

test("nothing registered and no tools: no lists at all, not empty headings", () => {
  const text = aboutAppText({ name: "Kris", places: [], tools: [] });
  expect(text).not.toContain("Places in this app:");
  expect(text).not.toContain("What you can do in this conversation:");
});

test("same inputs, same text; another name, another text", () => {
  const one = aboutAppText({ name: "Kris", places: PLACES, tools: TOOLS });
  const two = aboutAppText({ name: "Kris", places: [...PLACES], tools: [...TOOLS] });
  expect(two).toBe(one);
  expect(aboutAppText({ name: "Momo", places: PLACES, tools: TOOLS })).not.toBe(one);
});

test("a tool's line is its first sentence, cut at a word when that runs long", () => {
  expect(firstSentence("Find a book. Then read it.")).toBe("Find a book.");
  expect(firstSentence("找一本书。然后读。")).toBe("找一本书。");
  expect(firstSentence("No full stop here")).toBe("No full stop here");
  const long = firstSentence(`${"word ".repeat(60)}end.`);
  expect(long.length).toBeLessThanOrEqual(161);
  expect(long.endsWith("…")).toBe(true);
});

// --- in the assembled turn --------------------------------------------------

const settings = (companionName = ""): Settings => ({ ...DEFAULT_SETTINGS, companionName });

function env(s: Settings): DeskEnv {
  return { settings: s, thread: { key: "book-1", id: "thread-1" } };
}

function fakeTool(name: string): AgentTool {
  return { name, description: `The ${name} tool.`, parameters: {}, execute: async () => "" } as never;
}

function item(kind: string, prompt: string, tools: string[] = []): DeskItem {
  return {
    kind,
    label: kind,
    tools: tools.map(fakeTool),
    toolPrompts: [],
    rungs: [],
    prompt: () => prompt,
    memory: { bookId: "book-1", topicId: "t-1", observations: [], snapshot: () => "" },
  };
}

async function turnWith(s: Settings, it: DeskItem, more: Omit<AssembleInput, "desk"> = {}) {
  registerDeskItemKind({ kind: it.kind, open: async () => it });
  const laid = await openDesk([{ kind: it.kind, ref: {} }], env(s));
  return (await assembleTurn({ desk: laid, ...more }))!;
}

async function aboutOf(tools: readonly AgentTool[]): Promise<string> {
  const tool = tools.find((t) => t.name === ABOUT_APP_TOOL);
  expect(tool).toBeDefined();
  return String(await tool!.execute({}));
}

test("the short intro leads the prompt, then the item's prompt byte for byte; the lists are about_app's", async () => {
  undo.push(registerPlaces(PLACES.map((p) => ({ ...p, go: () => {} }))));
  const turn = await turnWith(settings("Momo"), item("book-a", "THE BOOK", ["book_tool"]));
  expect(turn.systemPrompt).toBe(`${introBlock("Momo")}\n\nTHE BOOK`);
  // The places the shell registered, and the soul's own tools — go_to among
  // them, because places are registered — but not what the desk item brought,
  // nor about_app itself.
  const about = await aboutOf(turn.tools);
  expect(about).toContain("say your name is Momo");
  expect(about).toContain("- today: Where the reader lands.");
  expect(about).toContain("- go_to: Take the reader to one of the places in this app.");
  expect(about).not.toContain("- book_tool:");
  expect(about).not.toContain(`- ${ABOUT_APP_TOOL}:`);
  // Every tool the soul mounted has its line, and no line names a tool it did not.
  const listed = about
    .slice(about.indexOf("What you can do in this conversation:"))
    .split("\n")
    .slice(1)
    .map((l) => l.slice(2, l.indexOf(":")));
  const soulTools = turn.tools.map((t) => t.name).filter((n) => n !== "book_tool" && n !== ABOUT_APP_TOOL);
  expect(listed).toEqual(soulTools);
});

test("two turns with different tool sets carry the same always-on bytes", async () => {
  undo.push(registerPlaces(PLACES.map((p) => ({ ...p, go: () => {} }))));
  const one = await turnWith(settings(), item("book-b", "THE BOOK"));
  const two = await turnWith(settings(), item("book-c", "THE BOOK"), { tools: [fakeTool("door_tool")] });
  expect(two.tools.map((t) => t.name)).toContain("door_tool");
  expect(one.tools.map((t) => t.name)).not.toContain("door_tool");
  // The prompt and about_app's declaration are the same bytes; only what it hands back differs.
  expect(two.systemPrompt).toBe(one.systemPrompt);
  const declared = (tools: readonly AgentTool[]) => tools.find((t) => t.name === ABOUT_APP_TOOL)!.description;
  expect(declared(two.tools)).toBe(declared(one.tools));
  expect(await aboutOf(two.tools)).toContain("- door_tool: The door_tool tool.");
  expect(await aboutOf(one.tools)).not.toContain("door_tool");
  expect(one.systemPrompt.startsWith("You are Kris,")).toBe(true);
  const renamed = await turnWith(settings("Nova"), item("book-d", "THE BOOK"));
  expect(renamed.systemPrompt.startsWith("You are Nova,")).toBe(true);
  expect(renamed.systemPrompt.split("Nova").join("Kris")).toBe(one.systemPrompt);
});

// --- the voice front --------------------------------------------------------

test("the front's prompt opens with the name, then the duty, then the place and list", () => {
  const sys = frontSystemPrompt("On page 3 of 9.", [], "Momo");
  expect(sys.startsWith("You are Momo, the companion inside the Lumen app")).toBe(true);
  expect(sys.startsWith(frontFixedPrompt("Momo"))).toBe(true);
  expect(frontFixedPrompt("Momo").endsWith(FRONT_DUTY)).toBe(true);
  expect(sys.indexOf(FRONT_DUTY)).toBeLessThan(sys.indexOf("On page 3 of 9."));
  expect(sys).toContain("not a person");
  // What the app can do is handed off: the front never sees a tool's result.
  expect(sys).toContain("Asked what you or the app can do, or how to do something in it, delegate it");
  expect(frontSystemPrompt("x", [])).toBe(frontSystemPrompt("x", [], "Kris"));
});

test("the front request takes the name from its context and stays under the cap", () => {
  const ctx = { name: "Momo", place: "P".repeat(5000), list: [], lines: [{ role: "user" as const, turn: 1, text: "who are you", interrupted: false }] };
  const { system, messages } = frontRequest(ctx as never);
  expect(system.startsWith("You are Momo,")).toBe(true);
  expect(estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(m.text), 0)).toBeLessThanOrEqual(FRONT_TOKEN_CAP);
  // The fixed part is small beside the cap: the identity costs the call little.
  expect(estimateTokens(frontFixedPrompt("Momo"))).toBeLessThan(FRONT_TOKEN_CAP / 4);
});

test("a think run handed off from a call reads about_app off the place's turn", async () => {
  undo.push(registerPlaces(PLACES.map((p) => ({ ...p, go: () => {} }))));
  const turn = await turnWith(settings("Momo"), item("book-e", "THE BOOK"));
  // The door and the briefing lay a think run's desk from their own turn's tools
  // (reading/turn/door-think.ts, info-bell.ts); the run keeps the reads.
  undo.push(registerThinkDesk("door", async () => turn.tools));
  const laid = await thinkDesk({ place: "door", date: "2026-10-21" } as never);
  const about = await aboutOf(laid.tools);
  expect(about).toContain("say your name is Momo");
  expect(about).toContain("- today: Where the reader lands.");
});
