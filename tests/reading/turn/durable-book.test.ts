// The book's lander and history reader for the durable runtime
// (reading/turn/durable-book.ts).

import { expect, test } from "bun:test";
import { fakeThreads } from "./support/durable-threads";
import {
  AssembledTurns,
  bookHistoryFromFile,
  bookHistoryReader,
  bookLander,
  bookThreadKey,
  bookThreadOrigin,
  type BookOrigin,
  type BookThreads,
} from "../../../src/reading/turn/durable-book";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";

const BOOK: BookOrigin = { place: "book", bookId: "b1", threadId: "t1", home: "b1" };

const turn = {
  conversationId: 1 as never,
  status: "done" as const,
  rows: [
    { role: "assistant" as const, ts: 1001, text: "", tools: [{ callId: "c1", name: "note", args: {}, isError: false, details: { label: "Noted", summary: "tides" } }] },
    { role: "user" as const, ts: 5000, text: "Only page one" },
    { role: "assistant" as const, ts: 5001, text: "Page one says the moon.", tools: [] },
  ],
};

function lander(threads: BookThreads, log: string[], watching = false) {
  return bookLander({
    threads,
    describe: (name) => ({ label: `Used ${name}` }),
    watching: () => watching,
    card: async (_origin, ts, text) => {
      log.push(`card:${ts}:${text}`);
    },
  });
}

test("a landed turn goes into the file with its trace, then the flush, then the card", async () => {
  const { threads, messages, log } = fakeThreads([{ role: "user", ts: 1000, text: "Q" }]);
  await lander(threads, log)(bookThreadOrigin(BOOK), turn, ctx);
  expect(log).toEqual(["append:ai:1001", "append:user:5000", "append:ai:5001", "flush", "card:5001:Page one says the moon."]);
  expect(messages[1]).toEqual({
    role: "ai",
    text: "",
    ts: 1001,
    parts: [{ type: "trace", tools: [{ name: "note", label: "Used note", state: "done", receipt: { label: "Noted", summary: "tides" } }] }],
  });
});

test("a landing rerun skips the rows already there and puts no card while the reader watches", async () => {
  const { threads, log } = fakeThreads([
    { role: "user", ts: 1000, text: "Q" },
    { role: "ai", ts: 1001, text: "" },
    { role: "user", ts: 5000, text: "Only page one" },
  ]);
  await lander(threads, log, true)(bookThreadOrigin(BOOK), turn, ctx);
  expect(log).toEqual(["append:ai:5001", "flush"]);
});

test("a refusal is not written and puts no card", async () => {
  const { threads, log } = fakeThreads();
  await lander(threads, log)(bookThreadOrigin(BOOK), { conversationId: 1 as never, status: "unanswered", rows: [], refusal: "Too long" }, ctx);
  expect(log).toEqual([]);
});

test("the history is the live assembly's while there is one, else the file without the reader's line", async () => {
  const { threads } = fakeThreads([
    { role: "ai", ts: 1, text: "An old answer" },
    { role: "user", ts: 2, text: "This turn's line" },
  ]);
  const assembled = new AssembledTurns();
  const read = bookHistoryReader(threads, assembled);
  const fromFile = await read(bookThreadOrigin(BOOK), { excludeTs: 2 }, ctx);
  expect(fromFile.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(bookHistoryFromFile(threads.messages("b1", "t1")!, 2).map((m) => m.text)[1]).toBe("An old answer");
  assembled.put(bookThreadKey(BOOK), { history: [{ role: "user", text: "Assembled" }], tools: [] });
  const live = await read(bookThreadOrigin(BOOK), { excludeTs: 2 }, ctx);
  expect(live).toHaveLength(1);
  expect(live[0]).toMatchObject({ role: "user", content: "Assembled" });
});
