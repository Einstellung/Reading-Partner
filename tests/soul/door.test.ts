// The door (src/soul/door.ts, docs/61): a conversation held with nothing on the
// desk. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  DOOR_KIND,
  doorDate,
  doorKey,
  doorLabel,
  listDoorUnits,
  openDoorTurn,
} from "../../src/soul";
import { resolvePalace } from "../../src/palace";
import { threadKindOf, topicOfThreadFile, type ConversationIo } from "../../src/conversations";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { rebuildThreadStoreForTests, type Thread } from "../../src/platform/app/threads";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

let disk: FakeDisk;
beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
});

// Written straight to the disk rather than through the store: the store's writes
// are debounced, and what these tests are about is what is read back off a file.
function seed(fileKey: string, threads: Record<string, Partial<Thread>>): void {
  const full: Record<string, Thread> = {};
  for (const [id, t] of Object.entries(threads)) {
    full[id] = { id, annotationId: "", path: "", createdAt: 0, messages: [], ...t } as Thread;
  }
  disk.files.set(`threads-${fileKey}.json`, JSON.stringify({ threads: full }, null, 2));
}

test("a day at the door is one file, and the catalogue knows whose it is", () => {
  expect(doorKey("2026-09-10")).toBe("door-2026-09-10");
  const hit = resolvePalace("threads-door-2026-09-10.json");
  expect(hit?.row.kind).toBe(DOOR_KIND);
  expect(hit?.id).toBe("2026-09-10");
  // The general reading row would otherwise swallow it, the way it would have
  // swallowed the retell and info files.
  expect(hit?.row.kind).not.toBe("reading-thread");
  expect(threadKindOf("threads-door-2026-09-10.json")).toBe("conversation");
});

test("the day is the reader's own, not UTC", () => {
  expect(doorDate(new Date(2026, 8, 10, 23, 30))).toBe("2026-09-10");
  expect(doorLabel("2026-09-10")).toBe("At the door 2026-09-10");
});

// Nothing was on the desk to say what the conversation is about, so nothing
// fills in for a topic it has not settled.
test("a conversation at the door is filed under its own topic, or under none", async () => {
  const io: ConversationIo = {
    listRoot: async () => [],
    readText: async () => null,
    peekThreads: async () => [],
  };
  expect(await topicOfThreadFile("door-2026-09-10", io, {})).toBeNull();
  expect(await topicOfThreadFile("door-2026-09-10", io, { topicId: "topic-1" })).toBe("topic-1");
});

// Nothing on the desk, and no topic yet. The offer to file the conversation
// waits for the screen that would show its card: nothing draws the door yet, so
// the door passes no surface and the soul mounts no propose_topic (soul/self.ts).
test("a turn at the door assembles over an empty desk", async () => {
  const turn = await openDoorTurn({ settings, threadId: "d1", date: "2026-09-10" });
  expect(turn!.systemPrompt).toBe("");
  expect(turn!.tools.map((t) => t.name)).not.toContain("propose_topic");
  expect(turn!.messages).toEqual([]);
  expect(turn!.refusal).toBe("");
});

test("the conversation the reader is holding is replayed, and its own file is not replayed twice", async () => {
  // The door's conversation, on disk under the day's key.
  seed(doorKey("2026-09-10"), {
    d1: { messages: [{ role: "user", text: "I have ten minutes", ts: 10 }] },
  });
  // And something said elsewhere, which is what the tail is for.
  seed("info-2026-07-21", { t1: { messages: [{ role: "user", text: "the debt cycle", ts: 5 }] } });

  const turn = await openDoorTurn({
    settings,
    threadId: "d1",
    date: "2026-09-10",
    messages: [{ role: "user", text: "I have ten minutes" }],
  });
  expect(turn!.messages).toEqual([
    { role: "user", text: "[over the briefing of 2026-07-21]\nthe debt cycle" },
    { role: "user", text: "I have ten minutes" },
  ]);
});

test("the turn is scoped to whatever topic the conversation settled on", async () => {
  seed(doorKey("2026-09-10"), { d1: { topicId: "topic-1" } });
  const turn = await openDoorTurn({
    settings,
    threadId: "d1",
    date: "2026-09-10",
    topics: async () => [{ id: "topic-1", name: "Attention" }],
  });
  // The observation tools only ride where there is a topic to scope them to
  // (soul/self.ts), so their presence is what says the topic reached the env.
  expect(turn!.tools.some((t) => t.name.startsWith("observation"))).toBe(true);
});

test("every day's conversations are offered to distillation, oldest first", async () => {
  seed(doorKey("2026-09-09"), {
    d0: { topicId: "topic-1", messages: [{ role: "user", text: "yesterday", ts: 1 }] },
  });
  seed(doorKey("2026-09-10"), {
    d1: { messages: [{ role: "user", text: "today", ts: 2 }] },
    // An empty conversation is nothing to distil.
    d2: {},
  });

  const units = await listDoorUnits();
  expect(units.map((u) => `${u.id} ${u.label} ${u.topicId}`)).toEqual([
    "d0 At the door 2026-09-09 topic-1",
    "d1 At the door 2026-09-10 null",
  ]);
});
