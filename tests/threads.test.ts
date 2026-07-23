// Unit tests for the thread store's book-level thread (docs/03: the top-bar AI
// button). The store keys off an in-memory cache, so create/get round-trips
// without touching disk. Run: bun test.

import { expect, test } from "bun:test";
import {
  appendMessage,
  createBookThread,
  createThread,
  getBookThread,
  getThread,
  patchThreadMessage,
  type PersistedPart,
  type Thread,
  type ThreadMessage,
} from "../src/app/threads";

test("createBookThread marks the thread and leaves it unanchored", () => {
  const path = "/books/book-thread-a.pdf";
  const thread = createBookThread(path, "bt-1");
  expect(thread.book).toBe(true);
  expect(thread.annotationId).toBe("");
  expect(thread.messages).toEqual([]);
  // Reachable both by its id and by the book-thread lookup.
  expect(getThread(path, "bt-1")).toBe(thread);
  expect(getBookThread(path)).toBe(thread);
});

test("getBookThread ignores mark-anchored threads", () => {
  const path = "/books/book-thread-b.pdf";
  createThread(path, "ann-1", "th-1");
  expect(getBookThread(path)).toBeUndefined();
  expect(getThread(path, "th-1")?.book).toBeUndefined();

  const book = createBookThread(path, "bt-2");
  // A book thread and mark threads coexist; only the marked one is returned.
  expect(getBookThread(path)).toBe(book);
});

test("the book thread hosts messages like any other", () => {
  const path = "/books/book-thread-c.pdf";
  createBookThread(path, "bt-3");
  appendMessage(path, "bt-3", { role: "user", text: "what is this chapter about", ts: 1 });
  appendMessage(path, "bt-3", { role: "ai", text: "it covers X", ts: 2 });
  expect(getThread(path, "bt-3")?.messages).toHaveLength(2);
});

test("the book marker survives the JSON persistence shape", () => {
  const thread: Thread = {
    id: "bt-4",
    annotationId: "",
    book: true,
    path: "/books/book-thread-d.pdf",
    createdAt: 123,
    messages: [],
  };
  const restored = JSON.parse(JSON.stringify({ threads: { "bt-4": thread } })) as {
    threads: Record<string, Thread>;
  };
  expect(restored.threads["bt-4"].book).toBe(true);
  expect(restored.threads["bt-4"].annotationId).toBe("");
});

// --- parts format (new) vs the plain { role, text, ts } shape (old) ---------

test("a message's card parts round-trip through the store and JSON", () => {
  const path = "/books/parts-a.pdf";
  createThread(path, "info", "th-p");
  const card: PersistedPart = {
    type: "card",
    id: "probe-1",
    card: { kind: "probe-confirm", added: true, descriptor: { id: "s1", name: "Example" } },
  };
  appendMessage(path, "th-p", { role: "ai", text: "", ts: 5, parts: [card] });

  const stored = getThread(path, "th-p")?.messages[0];
  expect(stored?.parts?.[0]).toMatchObject({ type: "card", id: "probe-1" });

  // The on-disk JSON shape preserves parts.
  const wire = JSON.parse(JSON.stringify({ threads: { "th-p": getThread(path, "th-p") } })) as {
    threads: Record<string, Thread>;
  };
  const revived = wire.threads["th-p"].messages[0];
  expect((revived.parts?.[0] as Extract<PersistedPart, { type: "card" }>).card.kind).toBe("probe-confirm");
});

test("an old-format message (no parts) still loads and coexists with new ones", () => {
  const path = "/books/parts-b.pdf";
  createThread(path, "info", "th-o");
  const old: ThreadMessage = { role: "user", text: "hi", ts: 1 }; // pre-parts shape
  appendMessage(path, "th-o", old);
  appendMessage(path, "th-o", {
    role: "ai",
    text: "",
    ts: 2,
    parts: [{ type: "text", text: "answer" }],
  });
  const msgs = getThread(path, "th-o")?.messages ?? [];
  expect(msgs[0].parts).toBeUndefined();
  expect(msgs[0].text).toBe("hi");
  expect(msgs[1].parts?.[0]).toEqual({ type: "text", text: "answer" });
});

test("patchThreadMessage merges into the stored message by ts (e.g. a card flip)", () => {
  const path = "/books/parts-c.pdf";
  createThread(path, "info", "th-c");
  appendMessage(path, "th-c", {
    role: "ai",
    text: "",
    ts: 9,
    parts: [{ type: "card", id: "probe-1", card: { kind: "probe-confirm", added: false } }],
  });
  patchThreadMessage(path, "th-c", 9, {
    parts: [{ type: "card", id: "probe-1", card: { kind: "probe-confirm", added: true } }],
  });
  const part = getThread(path, "th-c")?.messages[0].parts?.[0] as Extract<PersistedPart, { type: "card" }>;
  expect(part.card.added).toBe(true);
  // A miss (unknown ts) is a no-op, not a throw.
  expect(() => patchThreadMessage(path, "th-c", 999, { text: "x" })).not.toThrow();
});
