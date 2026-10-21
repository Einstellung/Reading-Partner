// The companion's name and its introduction (docs/companion/90): the setting
// and how it is read, how settings.json carries it, the block every assembled
// turn leads with, and the voice front's spoken version. Run: scripts/t.sh.

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
import { assembleTurn } from "../../src/soul";
import { firstSentence, introBlock } from "../../src/soul/intro";
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

// --- the intro block --------------------------------------------------------

const PLACES = [
  { id: "today", about: "Where the reader lands." },
  { id: "settings", about: "The settings." },
];
const TOOLS = [
  { name: "statement_write", description: "Write down what the reader said about themselves. Use it only when..." },
  { name: "go_to", description: "Take the reader to one of the places in this app.\n- today: ..." },
];

test("the block names the companion and lists exactly the places and tools it is handed", () => {
  const block = introBlock({ name: "Momo", places: PLACES, tools: TOOLS });
  expect(block.startsWith("You are Momo, the companion inside the Lumen app.")).toBe(true);
  expect(block).toContain("say your name is Momo");
  expect(block).toContain("not a person");
  expect(block).toContain("Never invent a feature");
  expect(block).toContain("- today: Where the reader lands.\n- settings: The settings.");
  expect(block).toContain("- statement_write: Write down what the reader said about themselves.\n");
  expect(block).toContain("- go_to: Take the reader to one of the places in this app.");
  expect(block).not.toContain("Use it only when");
});

test("nothing registered and no tools: no lists at all, not empty headings", () => {
  const block = introBlock({ name: "Kris", places: [], tools: [] });
  expect(block).not.toContain("Places in this app:");
  expect(block).not.toContain("What you can do in this conversation:");
});

test("same inputs, same bytes; another name, another block", () => {
  const one = introBlock({ name: "Kris", places: PLACES, tools: TOOLS });
  const two = introBlock({ name: "Kris", places: [...PLACES], tools: [...TOOLS] });
  expect(two).toBe(one);
  expect(introBlock({ name: "Momo", places: PLACES, tools: TOOLS })).not.toBe(one);
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

function item(kind: string, prompt: string, tools: string[] = []): DeskItem {
  return {
    kind,
    label: kind,
    tools: tools.map((name) => ({ name, description: `The ${name} tool.`, parameters: {}, execute: async () => "" }) as never),
    toolPrompts: [],
    rungs: [],
    prompt: () => prompt,
    memory: { bookId: "book-1", topicId: "t-1", observations: [], snapshot: () => "" },
  };
}

async function turnWith(s: Settings, it: DeskItem) {
  registerDeskItemKind({ kind: it.kind, open: async () => it });
  const laid = await openDesk([{ kind: it.kind, ref: {} }], env(s));
  return (await assembleTurn({ desk: laid }))!;
}

test("the intro leads the prompt, then the item's prompt byte for byte", async () => {
  undo.push(registerPlaces(PLACES.map((p) => ({ ...p, go: () => {} }))));
  const turn = await turnWith(settings("Momo"), item("book-a", "THE BOOK", ["book_tool"]));
  expect(turn.systemPrompt.startsWith("You are Momo, the companion inside the Lumen app.")).toBe(true);
  expect(turn.systemPrompt.endsWith("\n\nTHE BOOK")).toBe(true);
  // The places the shell registered, and the soul's own tools — go_to among
  // them, because places are registered — but not what the desk item brought.
  expect(turn.systemPrompt).toContain("- today: Where the reader lands.");
  expect(turn.systemPrompt).toContain("- go_to: Take the reader to one of the places in this app.");
  expect(turn.systemPrompt).not.toContain("- book_tool:");
  // Every tool the soul mounted has its line, and no line names a tool it did not.
  const intro = turn.systemPrompt.slice(0, turn.systemPrompt.indexOf("\n\nTHE BOOK"));
  const listed = intro
    .slice(intro.indexOf("What you can do in this conversation:"))
    .split("\n")
    .slice(1)
    .map((l) => l.slice(2, l.indexOf(":")));
  const soulTools = turn.tools.map((t) => t.name).filter((n) => n !== "book_tool");
  expect(listed).toEqual(soulTools);
});

test("two turns on the same settings, shell and desk carry the same intro bytes", async () => {
  undo.push(registerPlaces(PLACES.map((p) => ({ ...p, go: () => {} }))));
  const one = await turnWith(settings(), item("book-b", "THE BOOK"));
  const two = await turnWith(settings(), item("book-c", "THE BOOK"));
  expect(two.systemPrompt).toBe(one.systemPrompt);
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
