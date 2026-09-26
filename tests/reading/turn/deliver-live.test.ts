// A bell arriving on a conversation the reader is already talking on
// (src/reading/deliver.ts, docs/72): it goes into the turn in flight rather
// than opening a second one behind it, and a bell that does open one of its own
// holds the conversation while it runs.
// Run: scripts/t.sh tests/reading/deliver-live.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { deliverIntoReadingTurn, holdReadingTurn } from "../../../src/reading/turn/deliver";
import { createDelivered } from "../../../src/reading/turn/delivered";
import { readingTurns, resetReadingTurns, type LiveMessage } from "../../../src/reading/turn/live-turns";
import {
  createBookThread,
  flushThreads,
  getBookThread,
  rebuildThreadStoreForTests,
  threadFileName,
} from "../../../src/platform/app/threads";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";
import type { SteerPort } from "../../../src/legion/execute/contract";

const BOOK = "book-hash";
const THREAD = "thread-1";
const origin = { place: "book", bookId: BOOK, threadId: THREAD } as const;

let disk: FakeDisk;
beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
  resetReadingTurns();
});
afterEach(resetReadingTurns);

// A port that takes everything and reports it drained straight away, which is
// what a round boundary does.
function fakePort(said: { text: string; internal?: boolean }[], onQueued: (id: string) => void): SteerPort {
  return async (message) => {
    said.push(typeof message === "string" ? { text: message } : message);
    const id = `e${said.length}`;
    onQueued(id);
    return { ok: true, id };
  };
}

function startLiveTurn(): { said: { text: string; internal?: boolean }[] } {
  const said: { text: string; internal?: boolean }[] = [];
  const delivered = createDelivered(() => {});
  const port = fakePort(said, (id) => delivered.injected([id]));
  readingTurns<LiveMessage>().start({
    threadId: THREAD,
    bookId: BOOK,
    home: BOOK,
    controller: new AbortController(),
    message: { ts: 1 },
    delivered,
  });
  delivered.open(port);
  return { said };
}

function threadMessages(): { role: string; text: string }[] {
  const text = disk.files.get(threadFileName(BOOK));
  if (!text) return [];
  const parsed = JSON.parse(text) as {
    threads: Record<string, { messages: { role: string; text: string }[] }>;
  };
  return parsed.threads[THREAD]?.messages ?? [];
}

test("nothing running on that conversation: the bell is answered by a turn of its own", async () => {
  expect(await deliverIntoReadingTurn({ origin, bell: "[bell] back", runId: "r-1" })).toBeNull();
});

test("a turn with no queue of its own takes nothing", async () => {
  readingTurns<LiveMessage>().start({
    threadId: THREAD,
    bookId: BOOK,
    home: BOOK,
    controller: new AbortController(),
    message: { ts: 1 },
  });
  expect(await deliverIntoReadingTurn({ origin, bell: "[bell] back", runId: "r-1" })).toBeNull();
});

test("the bell goes into the turn in flight, and nothing goes into the thread file", async () => {
  createBookThread(BOOK, THREAD);
  const { said } = startLiveTurn();

  const handed = await deliverIntoReadingTurn({ origin, bell: "[bell] the literature is in", runId: "r-1" });
  expect(handed).toEqual({ threadId: THREAD, watching: false });
  // Internal: the model reads it, and it is not the reader speaking.
  expect(said).toEqual([{ text: "[bell] the literature is in", internal: true }]);

  await flushThreads();
  expect(threadMessages()).toEqual([]);
});

test("a bell for another book's conversation is not this one's to take", async () => {
  startLiveTurn();
  expect(
    await deliverIntoReadingTurn({
      origin: { place: "door", date: "2026-09-18" },
      bell: "[bell]",
      runId: "r-1",
    }),
  ).toBeNull();
});

test("a bell's own turn holds the conversation: the thread is busy while it runs", () => {
  createBookThread(BOOK, THREAD);
  const turns = readingTurns<LiveMessage>();
  const hold = holdReadingTurn(BOOK, THREAD);
  expect(turns.has(THREAD)).toBe(true);
  // It draws no row of its own: nothing streams a bell's turn, so there is
  // nothing for the reader to watch arrive.
  expect(turns.get(THREAD)?.silent).toBe(true);
  expect(turns.withLive(THREAD, [])).toEqual([]);
  hold.release();
  expect(turns.has(THREAD)).toBe(false);
});

test("the reader talking into a bell's turn steers it, and lands in the file when the model has it", async () => {
  createBookThread(BOOK, THREAD);
  const hold = holdReadingTurn(BOOK, THREAD);
  const turns = readingTurns<LiveMessage>();
  const said: { text: string }[] = [];
  let queued: string | null = null;
  const port = fakePort(said, (id) => (queued = id));

  turns.get(THREAD)!.steering!.say(7, "wait, what about chapter 3");
  hold.steerable(port);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(said).toEqual([{ text: "wait, what about chapter 3" }]);
  // Queued is not handed over: nothing is in the file yet.
  await flushThreads();
  expect(threadMessages()).toEqual([]);

  turns.get(THREAD)!.steering!.injected([queued!]);
  await flushThreads();
  expect(threadMessages()).toEqual([
    expect.objectContaining({ role: "user", text: "wait, what about chapter 3" }),
  ]);
  hold.release();
});

test("what the model was never handed still goes into the file when the turn lands", async () => {
  createBookThread(BOOK, THREAD);
  const hold = holdReadingTurn(BOOK, THREAD);
  readingTurns<LiveMessage>().get(THREAD)!.steering!.say(7, "never mind");
  hold.release();
  await flushThreads();
  expect(threadMessages()).toEqual([expect.objectContaining({ role: "user", text: "never mind" })]);
  expect(getBookThread(BOOK)?.id).toBe(THREAD);
});

test("the reader's Stop reaches a bell's turn through the signal it was sent with", () => {
  createBookThread(BOOK, THREAD);
  const turns = readingTurns<LiveMessage>();
  const hold = holdReadingTurn(BOOK, THREAD);
  expect(hold.signal.aborted).toBe(false);
  turns.stop(THREAD);
  expect(hold.signal.aborted).toBe(true);
});

test("the signal the bell pass was given aborts the held turn too", () => {
  createBookThread(BOOK, THREAD);
  const outer = new AbortController();
  const hold = holdReadingTurn(BOOK, THREAD, outer.signal);
  outer.abort();
  expect(hold.signal.aborted).toBe(true);
});
