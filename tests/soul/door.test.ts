// The door (src/soul/door.ts, docs/61): a conversation held with nothing on the
// desk. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  DOOR_KIND,
  doorDate,
  doorKey,
  doorLabel,
  listDoorUnits,
  openDoorThread,
  openDoorTurn,
} from "../../src/soul";
import { resolvePalace } from "../../src/palace";
import { threadKindOf, topicOfThreadFile, type ConversationIo } from "../../src/conversations";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import {
  rebuildThreadStoreForTests,
  threadFileName,
  type Thread,
} from "../../src/platform/app/threads";
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
  disk.files.set(threadFileName(fileKey), JSON.stringify({ threads: full }, null, 2));
}

test("a day at the door is one file, and the catalogue knows whose it is", () => {
  expect(doorKey("2026-09-10")).toBe("door-2026-09-10");
  // The file is named for what it holds, not for the store that holds it: the
  // key keeps the door's prefix and the store substitutes it on the way to disk.
  expect(threadFileName(doorKey("2026-09-10"))).toBe("conversation-2026-09-10.json");
  const hit = resolvePalace("conversation-2026-09-10.json");
  expect(hit?.row.kind).toBe(DOOR_KIND);
  expect(hit?.id).toBe("2026-09-10");
  expect(threadKindOf("conversation-2026-09-10.json")).toBe("conversation");
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
// waits for a screen that would show its card: a caller that passes no surface
// (the bell) gets no propose_topic (soul/self.ts).
test("a turn at the door assembles over an empty desk", async () => {
  const turn = await openDoorTurn({ settings, threadId: "d1", date: "2026-09-10" });
  expect(turn!.systemPrompt).toBe("");
  expect(turn!.tools.map((t) => t.name)).not.toContain("propose_topic");
  expect(turn!.messages).toEqual([]);
  expect(turn!.refusal).toBe("");
});

// The chat typed to Lumen draws cards, so it offers to file the conversation,
// and what the door mounts of its own rides beside the soul's set.
test("the chat at the door mounts its own tools and a topic offer", async () => {
  const tool = { name: "door_tool", description: "", parameters: {}, execute: async () => "" } as never;
  const turn = await openDoorTurn({
    settings,
    threadId: "d1",
    date: "2026-09-10",
    tools: [tool],
    topic: { onCard: () => {}, list: async () => [] },
  });
  const names = turn!.tools.map((t) => t.name);
  expect(names).toContain("door_tool");
  expect(names).toContain("propose_topic");
  expect(names).toContain("delegate");
});

test("the day's conversation at the door is one thread, opened once", async () => {
  let n = 0;
  const first = await openDoorThread("2026-09-10", () => `t${++n}`);
  const again = await openDoorThread("2026-09-10", () => `t${++n}`);
  expect(again.id).toBe(first.id);
  // A day that already has one is opened, not added to.
  seed(doorKey("2026-09-11"), { held: { book: true, messages: [{ role: "user", text: "hi", ts: 1 }] } });
  rebuildThreadStoreForTests();
  const held = await openDoorThread("2026-09-11", () => "fresh");
  expect(held.id).toBe("held");
  expect(held.messages.map((m) => m.text)).toEqual(["hi"]);
});

test("the conversation the reader is holding is replayed, and nothing said elsewhere", async () => {
  // The door's conversation, on disk under the day's key.
  seed(doorKey("2026-09-10"), {
    d1: { messages: [{ role: "user", text: "I have ten minutes", ts: 10 }] },
  });
  // Something said over another desk reaches the model through memory, never
  // as a replayed message.
  seed("info-2026-07-21", { t1: { messages: [{ role: "user", text: "the debt cycle", ts: 5 }] } });

  const turn = await openDoorTurn({
    settings,
    threadId: "d1",
    date: "2026-09-10",
    messages: [{ role: "user", text: "I have ten minutes" }],
  });
  expect(turn!.messages).toEqual([{ role: "user", text: "I have ten minutes" }]);
});

// The soul carries its memory to the door like everywhere else, but a topic is
// where an observation is filed, and a conversation filed under none has nowhere
// to put one: recall rides, the write does not (soul/self.ts).
test("what the conversation is filed under decides whether memory can be written", async () => {
  seed(doorKey("2026-09-10"), { d1: { topicId: "topic-1" }, d2: {} });
  const filed = await openDoorTurn({ settings, threadId: "d1", date: "2026-09-10" });
  expect(filed!.tools.map((t) => t.name)).toContain("observation_update");

  const unfiled = await openDoorTurn({ settings, threadId: "d2", date: "2026-09-10" });
  expect(unfiled!.tools.map((t) => t.name)).toContain("observation_search");
  expect(unfiled!.tools.map((t) => t.name)).not.toContain("observation_update");
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
