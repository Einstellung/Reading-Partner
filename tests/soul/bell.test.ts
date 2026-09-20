// Answering the bell (src/soul/bell.ts, docs/55): a bell becomes one soul turn
// held at the door, the reply lands in the day's conversation file, and only
// then is the bell acked. A turn that fails acks nothing.
// Run: scripts/t.sh tests/soul/bell.test.ts

import { beforeEach, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { answerBell, renderBell, OUTPUT_MAX, type SendBellTurn } from "../../src/soul";
import { createBellStore, BRIEF_MAX, type Bell, type BellStore } from "../../src/legion/bell";
import { createRunStore } from "../../src/legion/run/store";
import { doorKey, doorDate } from "../../src/soul";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import {
  createBookThread,
  rebuildThreadStoreForTests,
  threadFileName,
} from "../../src/platform/app/threads";
import { registerDelivery, registerLiveDelivery, type Delivery, type LiveDelivery } from "../../src/soul";
import type { SteerPort } from "../../src/legion/execute/contract";
import { createBoxStore, type BoxStore } from "../../src/box";
import { installAppData, type FakeDisk } from "../support/appdata-fake";
import { mapDisk } from "../support/map-disk";
import type { Turn } from "../support/scripted-turn";
import { scriptedBellSender } from "../support/scripted-runner";

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

function bellStore(): { bells: BellStore; files: Map<string, string> } {
  const io = mapDisk();
  return { bells: createBellStore(io), files: io.files };
}

// What the bell put in front of the model each round, which is what this file
// reads; what is done with what comes back is the other half.
function sender(turns: Turn[]): { send: SendBellTurn; rounds: Message[][] } {
  const rounds: Message[][] = [];
  const send = scriptedBellSender(turns, {
    onContext: (context) => void rounds.push(context.messages),
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

const doneBell = (payload: Record<string, unknown>): Bell =>
  ({
    id: "run-done-r1",
    type: "run-done",
    at: NOW,
    state: "queued",
    payload: { runId: "r1", kind: "translate-book", ...payload },
  }) as Bell;

test("the bell says who is speaking, and says it before the payload", () => {
  const text = renderBell(
    doneBell({ brief: "legion/briefs/b1.md", output: "legion/outputs/r1.md" }),
    {
      brief: "Translate chapter 3.",
      briefCut: false,
      output: "Chapter 3, in English.",
      outputCut: false,
      outputMissing: false,
    },
  );
  expect(text.split("\n")[0]).toContain("not said by the reader");
  expect(text).toContain("translate-book");
  // What was asked and what came back, both as text: the turn has no tool that
  // opens a path, so no path is put in front of it.
  expect(text).toContain("Translate chapter 3.");
  expect(text).toContain("Chapter 3, in English.");
  expect(text).not.toContain("legion/");
});

test("a bell says what was cut and what is not here, rather than where it is", () => {
  const cut = renderBell(doneBell({ brief: "legion/briefs/b1.md", output: "legion/outputs/r1.md" }), {
    brief: "Translate chapter 3.",
    briefCut: true,
    output: "Chapter 3, in English.",
    outputCut: true,
    outputMissing: false,
  });
  expect(cut).toContain("The task above was cut to fit.");
  expect(cut).toContain("cut to fit here");

  const gone = renderBell(doneBell({ brief: "legion/briefs/b1.md", output: "legion/outputs/r1.md" }), {
    brief: null,
    briefCut: false,
    output: null,
    outputCut: false,
    outputMissing: true,
  });
  expect(gone).toContain("The output is not on this device.");
  expect(gone).toContain("The task it was given is not on this device.");
  expect(gone).not.toContain("legion/");
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
  const runs = createRunStore(mapDisk());
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
  const io = mapDisk();
  return { box: createBoxStore(io), files: io.files };
}

// What a run left on disk, as the soul reads it back: the brief the soul wrote
// when it delegated and the output the worker wrote. A path nothing was written
// to throws, the way the disk throws.
function leftOnDisk(files: Record<string, string>): (path: string) => Promise<string> {
  return async (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  };
}

const BRIEF_TEXT = "Find what has been written about the 1971 result.";
const OUTPUT_TEXT = "Four papers, oldest first. Kuhn 1971 settles it.";

const RUN_FILES = leftOnDisk({
  "legion/briefs/b-1.md": BRIEF_TEXT,
  "legion/outputs/r-1.md": OUTPUT_TEXT,
});

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
        brief: "legion/briefs/b-1.md",
        output: "legion/outputs/r-1.md",
        deliverTo: bookOrigin,
      },
      { at: NOW - 1000 },
    );
    const { send, rounds } = sender([{ text: "Four papers came back. The first settles it." }]);

    expect(
      await answerBell({ settings, bells, box, send, readFile: RUN_FILES, now: () => NOW }),
    ).toBe(1);

    // The book's own file holds the reply; the door was never opened.
    expect(bookThreadFile()!.messages).toEqual([
      expect.objectContaining({ role: "ai", text: "Four papers came back. The first settles it." }),
    ]);
    expect(doorFile()).toBeNull();
    expect(rounds.length).toBe(1);
    // The turn was handed what the run was asked and what it produced, not the
    // two paths — it has no tool that would open either.
    const asked = String(rounds[0]![0]!.content);
    expect(asked).toContain("not said by the reader");
    expect(asked).toContain(BRIEF_TEXT);
    expect(asked).toContain(OUTPUT_TEXT);
    expect(asked).not.toContain("legion/");

    // One card, pointing back at what was just written.
    const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
    expect(item.boxId).toBe("r-1");
    expect(item.runId).toBe("r-1");
    expect(item.source).toBe("run");
    expect(item.state).toBe("in-box");
    expect(item.needsDecision).toBe(false);
    // The item travels between devices and the output file does not, so the
    // card holds the text of it.
    expect(item.body).toBe(OUTPUT_TEXT);
    expect(item.cover).toBe("Four papers came back.");
    expect(item.origin).toEqual(JSON.parse(bookOrigin));
  } finally {
    off();
  }
});

test("a brief and an output too long for a turn are cut, and the turn is told they were", async () => {
  const off = bookDelivery();
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box } = boxStore();
    await bells.ring(
      "run-done",
      {
        runId: "r-1",
        kind: "research-literature",
        brief: "legion/briefs/b-1.md",
        output: "legion/outputs/r-1.md",
        deliverTo: bookOrigin,
      },
      { at: NOW - 1000 },
    );
    const { send, rounds } = sender([{ text: "Back." }]);
    await answerBell({
      settings,
      bells,
      box,
      send,
      readFile: leftOnDisk({
        "legion/briefs/b-1.md": "b".repeat(BRIEF_MAX + 500),
        "legion/outputs/r-1.md": "o".repeat(OUTPUT_MAX + 500),
      }),
      now: () => NOW,
    });

    const asked = String(rounds[0]![0]!.content);
    expect(asked).toContain("b".repeat(BRIEF_MAX));
    expect(asked).not.toContain("b".repeat(BRIEF_MAX + 1));
    expect(asked).toContain("The task above was cut to fit.");
    expect(asked).toContain("o".repeat(OUTPUT_MAX));
    expect(asked).not.toContain("o".repeat(OUTPUT_MAX + 1));
    expect(asked).toContain("cut to fit here");
  } finally {
    off();
  }
});

test("a run whose files are not on this device says so rather than naming them", async () => {
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
        brief: "legion/briefs/b-1.md",
        output: "legion/outputs/r-1.md",
        deliverTo: bookOrigin,
      },
      { at: NOW - 1000 },
    );
    const { send, rounds } = sender([{ text: "Nothing came through." }]);
    await answerBell({ settings, bells, box, send, readFile: leftOnDisk({}), now: () => NOW });

    const asked = String(rounds[0]![0]!.content);
    expect(asked).toContain("The task it was given is not on this device.");
    expect(asked).toContain("The output is not on this device.");
    expect(asked).not.toContain("legion/");
    // Nothing to put on the card either, so it carries the cover alone.
    const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
    expect(item.body).toBeUndefined();
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

// --- runs a program delegated (docs/55 step 12) -----------------------------

// The run store a bell is read back against, kept here so each of these tests
// can put a run of its own on disk.
function runFiles() {
  const io = mapDisk();
  return { runs: createRunStore(io), files: io.files };
}

test("a run a program delegated is acked without a turn, a line, or a card", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  const { runs } = runFiles();
  const { run } = await runs.create({
    kind: "collect",
    delegator: { kind: "program", name: "daily-round" },
    brief: "briefs/collect.json",
    at: NOW - 10_000,
  });
  await bells.ring(
    "run-done",
    { runId: run.id, kind: run.kind, brief: "the round is in", output: "info/briefing-2026-09-14.json" },
    { at: NOW - 1000 },
  );
  const { send, rounds } = sender([]);

  expect(await answerBell({ settings, bells, runs, box, send, now: () => NOW })).toBe(1);

  // No model call, nothing said at the door, and no card: the day's briefing
  // puts its own there (info/boxes/red-box.ts).
  expect(rounds).toEqual([]);
  expect(doorFile()).toBeNull();
  expect([...cards.values()]).toEqual([]);
  // The ledger still gets everything it waits on.
  expect((await bells.get(`run-done-${run.id}`))?.state).toBe("acked");
  expect(await bells.read()).toEqual([]);
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);
});

test("the delegator on the bell is enough, with no run file to read", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  await bells.ring(
    "run-done",
    {
      runId: "r-local",
      kind: "collect",
      brief: "the round is in",
      delegator: { kind: "program", name: "daily-round" },
    },
    { at: NOW - 1000 },
  );
  const { send, rounds } = sender([]);

  expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);
  expect(rounds).toEqual([]);
  expect(doorFile()).toBeNull();
  expect([...cards.values()]).toEqual([]);
  expect((await bells.get("run-done-r-local"))?.state).toBe("acked");
});

test("a program's run that failed is one card to decide about, and no turn", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  const { runs } = runFiles();
  const { run } = await runs.create({
    kind: "collect",
    delegator: { kind: "program", name: "daily-round" },
    brief: "briefs/collect.json",
    at: NOW - 10_000,
  });
  await bells.ring(
    "run-failed",
    { runId: run.id, kind: run.kind, reason: "every source timed out" },
    { at: NOW - 1000 },
  );
  const { send, rounds } = sender([]);

  expect(await answerBell({ settings, bells, runs, box, send, now: () => NOW })).toBe(1);

  expect(rounds).toEqual([]);
  expect(doorFile()).toBeNull();
  // The failure left nothing else behind, so the card is its only trace and the
  // cover is the error itself.
  const item = JSON.parse([...cards.values()][0]!) as Record<string, unknown>;
  expect(item.boxId).toBe(run.id);
  expect(item.runId).toBe(run.id);
  expect(item.source).toBe("run");
  expect(item.kind).toBe("collect");
  expect(item.needsDecision).toBe(true);
  expect(item.cover).toContain("every source timed out");
  expect(item.origin).toEqual({ place: "door", date: doorDate(new Date(NOW)) });
  expect((await bells.get(`run-failed-${run.id}`))?.state).toBe("acked");
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);
});

test("a run the soul delegated is still answered in a turn", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  const { runs } = runFiles();
  const { run } = await runs.create({
    kind: "research-literature",
    delegator: { kind: "soul" },
    brief: "briefs/research.json",
    at: NOW - 10_000,
  });
  await bells.ring("run-done", { runId: run.id, kind: run.kind, brief: "four papers" }, { at: NOW - 1000 });
  const { send, rounds } = sender([{ text: "Four papers came back." }]);

  expect(
    await answerBell({ settings, bells, runs, box, send, now: () => NOW, newThreadId: () => "door-thread-9" }),
  ).toBe(1);
  expect(rounds.length).toBe(1);
  expect(doorFile()).toEqual({
    messages: [expect.objectContaining({ role: "ai", text: "Four papers came back." })],
  });
  expect([...cards.values()].length).toBe(1);
});


// --- a bell for a conversation that already has a turn running (docs/72) ---

// The other half of what a domain registers: how it hands a bell to the turn it
// already has in flight. `watching` is the same question the opener answers.
function liveBookDelivery(
  taken: LiveDelivery[],
  answer: { threadId: string; watching: boolean } | null,
): () => void {
  return registerLiveDelivery("book", async (input) => {
    taken.push(input);
    return answer;
  });
}

test("a bell for a conversation with a turn running goes into that turn, not a second one", async () => {
  const taken: LiveDelivery[] = [];
  const off = liveBookDelivery(taken, { threadId: "thread-1", watching: true });
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box, files: cards } = boxStore();
    const { runs } = runFiles();
    await bells.ring(
      "run-done",
      { runId: "r-1", kind: "research-literature", brief: "the literature is in", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    const { send, rounds } = sender([{ text: "should never be sent" }]);

    expect(await answerBell({ settings, bells, runs, box, send, now: () => NOW })).toBe(1);

    // No turn of its own, and the bell text is what a trailing message carries.
    expect(rounds).toEqual([]);
    expect(taken.length).toBe(1);
    expect(taken[0]!.runId).toBe("r-1");
    expect(taken[0]!.bell).toContain("not said by the reader");
    expect(taken[0]!.origin).toEqual(JSON.parse(bookOrigin));
    // Nothing of the bell's is written into the conversation — the file was
    // never touched, so there is nothing on disk at all.
    expect(bookThreadFile()).toBeNull();
    expect(doorFile()).toBeNull();
    // Handed over is answered: the ledger is stamped and the inbox is empty.
    expect((await bells.read()).length).toBe(0);
    expect((await bells.get("run-done-r-1"))?.state).toBe("acked");
    // The reader is looking at it, so there is no card.
    expect([...cards.values()].length).toBe(0);
  } finally {
    off();
  }
});

test("a delivery into a running turn nobody is watching still leaves a card", async () => {
  const off = liveBookDelivery([], { threadId: "thread-1", watching: false });
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box, files: cards } = boxStore();
    await bells.ring(
      "run-done",
      {
        runId: "r-1",
        kind: "research-literature",
        brief: "Four papers came back. The first settles it.",
        output: "legion/outputs/r-1.md",
        deliverTo: bookOrigin,
      },
      { at: NOW - 1000 },
    );
    const { send } = sender([]);
    expect(
      await answerBell({ settings, bells, box, send, readFile: RUN_FILES, now: () => NOW }),
    ).toBe(1);

    const item = JSON.parse([...cards.values()][0]!) as Record<string, unknown>;
    expect(item.runId).toBe("r-1");
    expect(item.body).toBe(OUTPUT_TEXT);
    // No reply to take a first sentence from: the run's own brief says it.
    expect(item.cover).toBe("Four papers came back.");
  } finally {
    off();
  }
});

test("a bell the running turn never took is answered by a turn of its own", async () => {
  const offLive = liveBookDelivery([], null);
  const off = bookDelivery(true);
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box } = boxStore();
    await bells.ring(
      "run-done",
      { runId: "r-1", kind: "research-literature", brief: "in", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    const { send, rounds } = sender([{ text: "Back." }]);
    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);
    expect(rounds.length).toBe(1);
    expect(bookThreadFile()!.messages).toEqual([
      expect.objectContaining({ role: "ai", text: "Back." }),
    ]);
  } finally {
    off();
    offLive();
  }
});

test("the line the bell's own turn writes says which run it answers", async () => {
  const off = bookDelivery(true);
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box } = boxStore();
    await bells.ring(
      "run-done",
      { runId: "r-7", kind: "translate-book", brief: "done", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "The translation is in." }]);
    await answerBell({ settings, bells, box, send, now: () => NOW });
    expect(bookThreadFile()!.messages).toEqual([
      expect.objectContaining({ role: "ai", text: "The translation is in.", origin: { runId: "r-7" } }),
    ]);
  } finally {
    off();
  }
});

test("the place holds the conversation for the length of the bell's turn", async () => {
  let held = 0;
  let released = 0;
  let port: SteerPort | null = null;
  const controller = new AbortController();
  const off = registerDelivery("book", async (input) => {
    if (input.origin.place !== "book") return null;
    return {
      key: input.origin.bookId,
      threadId: input.origin.threadId,
      turn: { systemPrompt: "", tools: [], messages: [{ role: "user", text: input.bell }], refusal: "" },
      watching: () => true,
      hold: () => {
        held += 1;
        return {
          signal: controller.signal,
          steerable: (p) => (port = p),
          release: () => (released += 1),
        };
      },
    } satisfies Delivery;
  });
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box } = boxStore();
    await bells.ring(
      "run-done",
      { runId: "r-1", kind: "collect", brief: "in", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    // A sender that reports a run to queue into, the way the app's does.
    const send: SendBellTurn = async (turn) => {
      expect(turn.signal).toBe(controller.signal);
      // Stamped with the place it was answered in, so a process that finds this
      // turn still open can finish it there (recover.ts).
      expect(turn.deliverTo).toEqual(JSON.parse(bookOrigin));
      turn.onSteerable?.(async () => ({ ok: true, id: "e1" }));
      return "Back.";
    };
    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);
    expect(held).toBe(1);
    expect(released).toBe(1);
    expect(port).not.toBeNull();
  } finally {
    off();
  }
});

test("a bell's turn that failed releases the conversation all the same", async () => {
  let released = 0;
  const off = registerDelivery("book", async (input) => {
    if (input.origin.place !== "book") return null;
    return {
      key: input.origin.bookId,
      threadId: input.origin.threadId,
      turn: { systemPrompt: "", tools: [], messages: [{ role: "user", text: input.bell }], refusal: "" },
      hold: () => ({
        signal: new AbortController().signal,
        steerable: () => {},
        release: () => (released += 1),
      }),
    } satisfies Delivery;
  });
  try {
    createBookThread(BOOK, "thread-1");
    const { bells } = bellStore();
    const { box } = boxStore();
    await bells.ring(
      "run-done",
      { runId: "r-1", kind: "collect", brief: "in", deliverTo: bookOrigin },
      { at: NOW - 1000 },
    );
    const send: SendBellTurn = async () => {
      throw new Error("the model would not answer");
    };
    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(0);
    expect(released).toBe(1);
    // Nothing answered: the bell is where it was.
    expect((await bells.read()).length).toBe(1);
  } finally {
    off();
  }
});
