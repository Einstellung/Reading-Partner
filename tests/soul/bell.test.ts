// Answering the bell (src/soul/bell.ts, docs/55): a bell becomes one soul turn
// held at the door, the reply lands in the day's conversation file, and only
// then is the bell acked. A turn that fails acks nothing.
// Run: scripts/t.sh tests/soul/bell.test.ts

import { beforeEach, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  type Api,
  type Context,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { answerBell, renderBell, type SendBellTurn } from "../../src/soul";
import { createBellStore, type BellIo, type BellStore } from "../../src/legion/bell";
import { createRunStore } from "../../src/legion/run/store";
import { holdHarness } from "../../src/legion/execute/held";
import { runHarnessTurn, type StreamFn } from "../../src/legion/execute/turn";
import { toPiMessages } from "../../src/ai/providers";
import { createSessionFileSystem } from "../../src/platform/app/session-fs";
import { doorKey, doorDate } from "../../src/soul";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import {
  createBookThread,
  rebuildThreadStoreForTests,
  threadFileName,
} from "../../src/platform/app/threads";
import { registerDelivery, type Delivery } from "../../src/soul";
import { createBoxStore, type BoxIo, type BoxStore } from "../../src/box";
import { installAppData, type FakeDisk } from "../support/appdata-fake";
import { memoryAppData } from "../support/memory-appdata";
import { turnEvents, type Turn } from "../support/scripted-turn";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;

let disk: FakeDisk;
beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
});

function bellStore(): { bells: BellStore; files: Map<string, string> } {
  const files = new Map<string, string>();
  const io: BellIo = {
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    write: async (name, contents) => {
      files.set(name, contents);
    },
  };
  return { bells: createBellStore(io), files };
}

// The real turn machinery on the real held harness, with the provider scripted:
// what is under test is what the bell puts in front of the model and what is
// done with what comes back, not how the stream is decoded.
function sender(turns: Turn[]): { send: SendBellTurn; rounds: Message[][] } {
  const rounds: Message[][] = [];
  let round = 0;
  const stream: StreamFn = (_model, context: Context) => {
    const i = round++;
    rounds.push(context.messages);
    const out = createAssistantMessageEventStream();
    const events = turnEvents(turns[i] ?? { error: "no scripted turn" });
    (async () => {
      for (const ev of events) {
        await Promise.resolve();
        out.push(ev);
      }
      out.end();
    })();
    return out;
  };
  const held = holdHarness({
    lane: { name: "soul", sessions: "soul" },
    fileSystem: createSessionFileSystem(memoryAppData()),
  });
  const send: SendBellTurn = (turn) =>
    new Promise<string>((resolve, reject) => {
      void runHarnessTurn({
        stream,
        model: MODEL,
        systemPrompt: turn.systemPrompt,
        messages: toPiMessages(turn.messages),
        tools: turn.tools,
        maxRounds: 4,
        held,
        onDelta: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onDone: (text) => resolve(text),
        onError: (message) => reject(new Error(message)),
      });
    });
  return { send, rounds };
}

function doorFile(): { messages: { role: string; text: string }[] } | null {
  const name = threadFileName(doorKey(doorDate(new Date(NOW))));
  const text = disk.files.get(name);
  if (!text) return null;
  const parsed = JSON.parse(text) as { threads: Record<string, { messages: { role: string; text: string }[] }> };
  const threads = Object.values(parsed.threads);
  return threads.length === 1 ? { messages: threads[0]!.messages } : null;
}

const NOW = new Date(2026, 8, 14, 9, 0, 0).getTime();

test("the bell says who is speaking, and says it before the payload", () => {
  const text = renderBell({
    id: "run-done-r1",
    type: "run-done",
    at: NOW,
    state: "queued",
    payload: { runId: "r1", kind: "translate-book", brief: "chapter 3", truncated: true, output: "runs/r1/out" },
  });
  expect(text.split("\n")[0]).toContain("not said by the reader");
  expect(text).toContain("r1");
  expect(text).toContain("translate-book");
  expect(text).toContain("chapter 3");
  expect(text).toContain("runs/r1/out");
});

test("nothing in the inbox costs one listing and no turn", async () => {
  const { bells } = bellStore();
  const { send, rounds } = sender([]);
  expect(await answerBell({ settings, bells, send, now: () => NOW })).toBe(0);
  expect(rounds).toEqual([]);
  expect(doorFile()).toBeNull();
});

test("a run-done bell starts one turn and its reply lands in today's door file", async () => {
  const { bells } = bellStore();
  await bells.ring(
    "run-done",
    { runId: "r1", kind: "translate-book", brief: "the book is translated", output: "runs/r1/out" },
    { at: NOW - 1000 },
  );
  const { send, rounds } = sender([{ text: "Your translation is ready." }]);

  const answered = await answerBell({
    settings,
    bells,
    send,
    now: () => NOW,
    newThreadId: () => "door-thread-1",
  });

  expect(answered).toBe(1);
  // One turn, and the bell is the last thing the model was sent.
  expect(rounds.length).toBe(1);
  const sent = rounds[0]!;
  const last = sent[sent.length - 1]!;
  expect(String(last.content)).toContain("not said by the reader");
  expect(String(last.content)).toContain("the book is translated");

  // The conversation holds what the soul said and nothing else: the bell was a
  // message to the soul, not a message from the reader.
  expect(doorFile()).toEqual({
    messages: [expect.objectContaining({ role: "ai", text: "Your translation is ready." })],
  });

  // Delivered and acked, in that order, after the reply was on disk.
  expect((await bells.get("run-done-r1"))?.state).toBe("acked");
  expect(await bells.read()).toEqual([]);
});

test("a turn that fails leaves the bell queued and writes nothing", async () => {
  const { bells } = bellStore();
  await bells.ring("run-failed", { runId: "r2", kind: "collect", reason: "the source is gone" }, { at: NOW });
  const { send } = sender([{ error: "overloaded" }]);
  const trouble: string[] = [];

  const answered = await answerBell({
    settings,
    bells,
    send,
    now: () => NOW,
    newThreadId: () => "door-thread-2",
    onTrouble: (bell, reason) => trouble.push(`${bell.id}:${reason}`),
  });

  expect(answered).toBe(0);
  expect(trouble.length).toBe(1);
  expect(trouble[0]).toContain("run-failed-r2");
  expect((await bells.get("run-failed-r2"))?.state).toBe("queued");
  expect((await bells.read()).map((b) => b.id)).toEqual(["run-failed-r2"]);
  expect(doorFile()?.messages ?? []).toEqual([]);
});

test("the ack stamps the run as delivered, which is what the fold waits on", async () => {
  const { bells } = bellStore();
  const files = new Map<string, string>();
  const runs = createRunStore({
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    write: async (name, contents) => {
      files.set(name, contents);
    },
    remove: async (name) => {
      files.delete(name);
    },
  });
  const { run } = await runs.create({
    kind: "translate-book",
    delegator: { kind: "soul" },
    brief: "briefs/translate-book.json",
    at: NOW - 10_000,
  });
  await bells.ring("run-done", { runId: run.id, kind: run.kind, brief: "done" }, { at: NOW - 1000 });

  const first = sender([{ text: "Your translation is ready." }]);
  const answered = await answerBell({
    settings,
    bells,
    runs,
    send: first.send,
    now: () => NOW,
    newThreadId: () => "door-thread-3",
  });
  expect(answered).toBe(1);
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);

  // Stamped once: the field only ever moves earlier in a merge, so a second
  // bell about the same run says nothing new.
  await bells.ring(
    "run-done",
    { runId: run.id, kind: run.kind, brief: "again" },
    { at: NOW, id: "run-done-again" },
  );
  const second = sender([{ text: "Still ready." }]);
  await answerBell({
    settings,
    bells,
    runs,
    send: second.send,
    now: () => NOW + 5_000,
    newThreadId: () => "door-thread-4",
  });
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);
});

// --- answering where the question was asked (docs/68) -----------------------

const BOOK = "book-hash";

function boxStore(): { box: BoxStore; files: Map<string, string> } {
  const files = new Map<string, string>();
  const io: BoxIo = {
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    write: async (name, contents) => {
      files.set(name, contents);
    },
  };
  return { box: createBoxStore(io), files };
}

// A domain's delivery opener, as reading registers one: it says where the reply
// goes and hands back a turn. The bell knows nothing else about a book.
// `seen` is what reading answers off what is on screen (reading/turn-box.ts);
// left out, the place has no notion of it, the way the door has none.
function bookDelivery(seen?: boolean): () => void {
  return registerDelivery("book", async (input) => {
    if (input.origin.place !== "book") return null;
    return {
      key: input.origin.bookId,
      threadId: input.origin.threadId,
      turn: {
        systemPrompt: "the book is on the desk",
        tools: [],
        messages: [{ role: "user", text: input.bell }],
        refusal: "",
      },
      ...(seen === undefined ? {} : { watching: () => seen }),
    } satisfies Delivery;
  });
}

function bookThreadFile(): { messages: { role: string; text: string }[] } | null {
  const text = disk.files.get(threadFileName(BOOK));
  if (!text) return null;
  const parsed = JSON.parse(text) as {
    threads: Record<string, { messages: { role: string; text: string }[] }>;
  };
  const thread = parsed.threads["thread-1"];
  return thread ? { messages: thread.messages } : null;
}

const bookOrigin = JSON.stringify({
  place: "book",
  bookId: BOOK,
  threadId: "thread-1",
  annotationId: "ann-1",
  page: 37,
});

test("a run delegated from a book is answered in that book's thread, not at the door", async () => {
  const off = bookDelivery();
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-done",
      {
        runId: "r-1",
        kind: "research-literature",
        brief: "the literature is in",
        output: "legion/outputs/r-1.md",
        deliverTo: bookOrigin,
      },
      { at: NOW - 1000 },
    );
    const { send, rounds } = sender([{ text: "Four papers came back. The first settles it." }]);

    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);

    // The book's own file holds the reply; the door was never opened.
    expect(bookThreadFile()!.messages).toEqual([
      expect.objectContaining({ role: "ai", text: "Four papers came back. The first settles it." }),
    ]);
    expect(doorFile()).toBeNull();
    expect(rounds.length).toBe(1);
    expect(String(rounds[0]![0]!.content)).toContain("not said by the reader");

    // One card, pointing back at what was just written.
    const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
    expect(item.boxId).toBe("r-1");
    expect(item.runId).toBe("r-1");
    expect(item.source).toBe("run");
    expect(item.state).toBe("in-box");
    expect(item.needsDecision).toBe(false);
    expect(item.body).toBe("legion/outputs/r-1.md");
    expect(item.cover).toBe("Four papers came back.");
    expect(item.origin).toEqual(JSON.parse(bookOrigin));
  } finally {
    off();
  }
});

test("the card is written before the bell is acked", async () => {
  const off = bookDelivery();
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box } = boxStore();
    let queuedWhenWritten = -1;
    const watched: BoxStore = {
      ...box,
      put: async (input) => {
        queuedWhenWritten = (await bells.read()).length;
        return box.put(input);
      },
    };
    await bells.ring(
      "run-done",
      { runId: "r-1", kind: "research-literature", brief: "in", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "Back." }]);
    await answerBell({ settings, bells, box: watched, send, now: () => NOW });
    // Still queued: the item is on disk before anything says the bell was answered.
    expect(queuedWhenWritten).toBe(1);
    expect(await bells.read()).toEqual([]);
  } finally {
    off();
  }
});

test("a failed run is a card the reader has to decide about", async () => {
  const off = bookDelivery();
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-failed",
      {
        runId: "r-2",
        kind: "research-literature",
        reason: "every attempt failed",
        deliverTo: bookOrigin,
      },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "The search could not finish." }]);
    await answerBell({ settings, bells, box, send, now: () => NOW });

    const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
    expect(item.needsDecision).toBe(true);
    expect(item.body).toBeUndefined();
  } finally {
    off();
  }
});

test("a run that named no place is answered at the door, and the card says so", async () => {
  const off = bookDelivery();
  try {
    const { bells } = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-done",
      { runId: "r-3", kind: "translate-book", brief: "done", deliverTo: "not json at all" },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "Your translation is ready." }]);
    await answerBell({
      settings,
      bells,
      box,
      send,
      now: () => NOW,
      newThreadId: () => "door-thread-1",
    });

    expect(doorFile()!.messages.length).toBe(1);
    expect(bookThreadFile()).toBeNull();
    const item = JSON.parse([...files.values()][0]!) as { origin: { place: string } };
    expect(item.origin.place).toBe("door");
  } finally {
    off();
  }
});

// The rule a plain reading turn follows, followed by a delivered run too
// (docs/68): the card is for an answer nobody saw land.
test("a reply the reader is watching land leaves no card, and is acked all the same", async () => {
  const off = bookDelivery(true);
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-done",
      {
        runId: "r-1",
        kind: "research-literature",
        brief: "the literature is in",
        output: "legion/outputs/r-1.md",
        deliverTo: bookOrigin,
      },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "Four papers came back." }]);

    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);

    // The answer is in the thread the reader has open; the box stays empty.
    expect(bookThreadFile()!.messages.length).toBe(1);
    expect([...files.keys()]).toEqual([]);
    expect(await bells.read()).toEqual([]);
  } finally {
    off();
  }
});

test("a failure the reader is watching land leaves no card either", async () => {
  const off = bookDelivery(true);
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-failed",
      { runId: "r-2", kind: "collect", reason: "every attempt failed", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "The search could not finish." }]);
    await answerBell({ settings, bells, box, send, now: () => NOW });

    expect(bookThreadFile()!.messages.length).toBe(1);
    expect([...files.keys()]).toEqual([]);
  } finally {
    off();
  }
});

test("a reply that landed with the thread off screen is a card", async () => {
  const off = bookDelivery(false);
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-done",
      { runId: "r-3", kind: "research-literature", brief: "in", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "Four papers came back." }]);
    await answerBell({ settings, bells, box, send, now: () => NOW });

    const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
    expect(item.boxId).toBe("r-3");
    expect(item.origin).toEqual(JSON.parse(bookOrigin));
  } finally {
    off();
  }
});
