// Unit tests for the chapter prompt builders (src/notes/chapter.ts): the chat
// thread block (in-range filtering, roles, clipping, caps, empty case) and the
// system prompt embedding it with its instruction. Run: bun test.

import { expect, test } from "bun:test";
import {
  chapterSystemPrompt,
  formatChatThreads,
  type ChatThread,
} from "../../src/notes/chapter";
import type { NoteChapter } from "../../src/notes/types";

function thread(page: number, createdAt: number, msgs: [ChatThread["messages"][number]["role"], string][]): ChatThread {
  return { page, createdAt, messages: msgs.map(([role, text]) => ({ role, text })) };
}

test("formatChatThreads keeps only threads in range, tagged by role and page", () => {
  const out = formatChatThreads(
    [
      thread(5, 1, [["user", "why is this?"], ["ai", "because X"]]),
      thread(20, 2, [["user", "out of range"]]),
      thread(2, 3, [["user", "before range"]]),
    ],
    3,
    10,
  );
  expect(out).toContain("[p.5]");
  expect(out).toContain("reader: why is this?");
  expect(out).toContain("assistant: because X");
  expect(out).not.toContain("out of range");
  expect(out).not.toContain("before range");
});

test("formatChatThreads returns empty string when nothing is in range", () => {
  expect(formatChatThreads([thread(1, 1, [["user", "hi"]])], 5, 9)).toBe("");
  expect(formatChatThreads([], 1, 100)).toBe("");
});

test("formatChatThreads drops empty and whitespace-only messages and threads", () => {
  const out = formatChatThreads(
    [
      thread(4, 1, [["user", "   "], ["ai", ""]]),
      thread(4, 2, [["user", "real question"], ["ai", "  "]]),
    ],
    1,
    10,
  );
  // The all-empty thread contributes nothing; only the real message survives.
  expect(out).toBe("[p.4]\nreader: real question");
});

test("formatChatThreads clips a long message", () => {
  const long = "word ".repeat(400).trim(); // ~2000 chars
  const out = formatChatThreads([thread(3, 1, [["ai", long]])], 1, 5);
  expect(out).toContain("…");
  expect(out.length).toBeLessThan(long.length);
});

test("formatChatThreads keeps only the last 6 messages of a thread", () => {
  const msgs = Array.from({ length: 10 }, (_, i): [ChatThread["messages"][number]["role"], string] => [
    i % 2 === 0 ? "user" : "ai",
    `m${i}`,
  ]);
  const out = formatChatThreads([thread(2, 1, msgs)], 1, 5);
  expect(out).not.toContain("m3");
  expect(out).toContain("m4");
  expect(out).toContain("m9");
  expect(out.match(/^(reader|assistant):/gm)?.length).toBe(6);
});

test("formatChatThreads trims oldest threads first past the total cap", () => {
  // Six ~600-char messages per thread (each near the per-message clip) make a
  // block of ~3.6k chars, so the ~8k total cap admits two threads, not three.
  const bulky = (marker: string): ChatThread["messages"] =>
    Array.from({ length: 6 }, (_, i): ChatThread["messages"][number] => ({
      role: i % 2 === 0 ? "user" : "ai",
      text: `${i === 0 ? marker + " " : ""}${"x".repeat(560)}`,
    }));
  const out = formatChatThreads(
    [
      { page: 2, createdAt: 1, messages: bulky("OLDEST") },
      { page: 2, createdAt: 3, messages: bulky("NEWEST") },
      { page: 2, createdAt: 2, messages: bulky("MIDDLE") },
    ],
    1,
    5,
  );
  expect(out).toContain("NEWEST");
  expect(out).toContain("MIDDLE");
  expect(out).not.toContain("OLDEST");
});

const CHAPTER: NoteChapter = {
  index: 2,
  title: "Method",
  startPage: 4,
  endPage: 9,
  status: "pending",
};

test("chapterSystemPrompt embeds the chat block and its endorsement instruction", () => {
  const chats = formatChatThreads([thread(5, 1, [["user", "note this down"], ["ai", "here is the idea"]])], 4, 9);
  const prompt = chapterSystemPrompt({ bookName: "Book", chapter: CHAPTER, chats });
  expect(prompt).toContain("here is the idea");
  expect(prompt).toContain("[p.5]");
  expect(prompt).toMatch(/endorsed an explanation or asked for it to be recorded/);
  expect(prompt).toMatch(/rewritten in the/);
});

test("chapterSystemPrompt omits the chat instruction when there are no chats", () => {
  const prompt = chapterSystemPrompt({ bookName: "Book", chapter: CHAPTER, chats: "" });
  expect(prompt).not.toMatch(/asked for it to be recorded/);
});

test("chapterSystemPrompt appends the output-language instruction only when set", () => {
  const pinned = chapterSystemPrompt({ bookName: "Book", chapter: CHAPTER, aiLanguage: "fr" });
  expect(pinned).toContain("All user-facing output must be written in Français.");
  expect(chapterSystemPrompt({ bookName: "Book", chapter: CHAPTER })).not.toContain(
    "must be written in",
  );
  expect(
    chapterSystemPrompt({ bookName: "Book", chapter: CHAPTER, aiLanguage: "auto" }),
  ).not.toContain("must be written in");
});
