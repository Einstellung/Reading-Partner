// Marks drawn on the classroom's replies: the anchor's shape and tolerance
// (src/platform/app/reader-contract), where its words land in a rendering, the
// two groups the trace list shows, and what the engine is allowed to see
// (src/reading/chat-marks). Run: bun test.

import { expect, test } from "bun:test";
import {
  annotationPage,
  chatAnchorOf,
  chatMarks,
  isChatMark,
  isPageMark,
  pageMarks,
  type Annotation,
} from "../../src/platform/app/reader-contract";
import {
  buildChatMark,
  chatMarkNote,
  chatMarksOn,
  markedReplyText,
  locateChatMark,
  locateChatMarks,
  mayMarkReply,
  occurrenceAt,
  orderTraceMarks,
  traceGroups,
  type NewChatMark,
} from "../../src/reading/chat-marks";
import { annotationPageMap, observationScope } from "../../src/reading/lecture";
import type { Observation } from "../../src/observation";

const pageMark = (id: string, pageIndex = 0): Annotation => ({
  id,
  type: "highlight",
  text: `mark ${id}`,
  position: { pageIndex, rects: [[0, 0, 10, 10]] },
});

const chatMark = (id: string, over: Partial<Annotation> = {}): Annotation => ({
  ...(buildChatMark({
    id,
    pen: "underline",
    color: "#a28ae5",
    threadId: "lesson",
    messageTs: 1000,
    text: "the words",
    occurrence: 0,
    now: 1700000000000,
  }) as Annotation),
  ...over,
});

// A page mark carrying the engine's document-order key (reading/engine/convert.ts).
const onPage = (id: string, sortIndex: string): Annotation => ({ ...pageMark(id), sortIndex });

// --- the anchor -----------------------------------------------------------

test("a mark with no chatAnchor is a page mark, which is what every old file is", () => {
  const a = pageMark("p1");
  expect(chatAnchorOf(a)).toBeNull();
  expect(isPageMark(a)).toBe(true);
  expect(isChatMark(a)).toBe(false);
  expect(annotationPage(a as { position?: { pageIndex?: number } })).toBe(1);
});

test("a chat mark carries thread, message, words, occurrence and pen", () => {
  const a = chatMark("c1");
  expect(chatAnchorOf(a)).toEqual({
    threadId: "lesson",
    messageTs: 1000,
    text: "the words",
    occurrence: 0,
    pen: "underline",
  });
  expect(isChatMark(a)).toBe(true);
  // No page anchor, and the page helper every caller already tolerates says so.
  expect(annotationPage(a as { position?: { pageIndex?: number } })).toBeNull();
});

test("an anchor missing what locates the words reads as a page mark", () => {
  expect(chatAnchorOf({ chatAnchor: {} })).toBeNull();
  expect(chatAnchorOf({ chatAnchor: { threadId: "t", messageTs: 1 } })).toBeNull();
  expect(chatAnchorOf({ chatAnchor: { threadId: "", messageTs: 1, text: "x" } })).toBeNull();
  expect(chatAnchorOf({ chatAnchor: { threadId: "t", messageTs: NaN, text: "x" } })).toBeNull();
  expect(chatAnchorOf({ chatAnchor: "nonsense" })).toBeNull();
  expect(chatAnchorOf(null)).toBeNull();
});

test("a partial anchor keeps the mark: occurrence defaults to the first, pen to underline", () => {
  expect(chatAnchorOf({ chatAnchor: { threadId: "t", messageTs: 7, text: "x" } })).toEqual({
    threadId: "t",
    messageTs: 7,
    text: "x",
    occurrence: 0,
    pen: "underline",
  });
  expect(
    chatAnchorOf({ chatAnchor: { threadId: "t", messageTs: 7, text: "x", pen: "sharpie" } })?.pen,
  ).toBe("underline");
});

// --- what the engine may see ----------------------------------------------

test("only page marks go to the engine; the file keeps both", () => {
  const all = [pageMark("p1"), chatMark("c1"), pageMark("p2", 4)];
  expect(pageMarks(all).map((a) => a.id)).toEqual(["p1", "p2"]);
  expect(chatMarks(all).map((a) => a.id)).toEqual(["c1"]);
});

// --- locating the words ---------------------------------------------------

test("the anchor's words are found in the rendering", () => {
  expect(locateChatMark("a reply about entropy", { text: "entropy", occurrence: 0 })).toEqual({
    start: 14,
    end: 21,
  });
});

test("occurrence picks the copy that was drawn over", () => {
  const rendered = "heat is heat is heat";
  expect(locateChatMark(rendered, { text: "heat", occurrence: 0 })?.start).toBe(0);
  expect(locateChatMark(rendered, { text: "heat", occurrence: 1 })?.start).toBe(8);
  expect(locateChatMark(rendered, { text: "heat", occurrence: 2 })?.start).toBe(16);
});

test("a copy that is gone falls back to the last one; the words gone is null", () => {
  expect(locateChatMark("heat is heat", { text: "heat", occurrence: 5 })?.start).toBe(8);
  expect(locateChatMark("a regenerated reply", { text: "heat", occurrence: 0 })).toBeNull();
  expect(locateChatMark("", { text: "heat", occurrence: 0 })).toBeNull();
  expect(locateChatMark("heat", { text: "", occurrence: 0 })).toBeNull();
});

test("occurrenceAt is the number locateChatMark reads back", () => {
  const rendered = "heat is heat is heat";
  for (const start of [0, 8, 16]) {
    const n = occurrenceAt(rendered, "heat", start);
    expect(locateChatMark(rendered, { text: "heat", occurrence: n })?.start).toBe(start);
  }
  // Overlapping counting, so a selection inside a repeat is still nameable.
  expect(occurrenceAt("aaa", "aa", 1)).toBe(1);
  expect(locateChatMark("aaa", { text: "aa", occurrence: 1 })?.start).toBe(1);
  // Not those words at that offset.
  expect(occurrenceAt("heat is heat", "heat", 3)).toBe(-1);
  expect(occurrenceAt("heat", "", 0)).toBe(-1);
});

// --- marks per message ----------------------------------------------------

test("marks are found by thread and message, and located in reading order", () => {
  const first = chatMark("c1", {
    chatAnchor: { threadId: "lesson", messageTs: 1000, text: "second", occurrence: 0, pen: "ai" },
  });
  const second = chatMark("c2", {
    chatAnchor: {
      threadId: "lesson",
      messageTs: 1000,
      text: "first",
      occurrence: 0,
      pen: "highlight",
    },
  });
  const elsewhere = chatMark("c3", {
    chatAnchor: { threadId: "aside", messageTs: 1000, text: "first", occurrence: 0, pen: "ai" },
  });
  const otherMessage = chatMark("c4", {
    chatAnchor: { threadId: "lesson", messageTs: 2000, text: "first", occurrence: 0, pen: "ai" },
  });
  const all = [pageMark("p1"), first, second, elsewhere, otherMessage];

  expect(chatMarksOn(all, "lesson", 1000).map((a) => a.id)).toEqual(["c1", "c2"]);

  const located = locateChatMarks("first then second", all, "lesson", 1000);
  expect(located.map((m) => m.annotation.id)).toEqual(["c2", "c1"]);
  expect(located.map((m) => m.span.start)).toEqual([0, 11]);
  expect(located[0].anchor.pen).toBe("highlight");

  // A mark whose words the regenerated reply no longer has is left out.
  expect(locateChatMarks("nothing of the sort", all, "lesson", 1000)).toEqual([]);
});

// --- the trace list -------------------------------------------------------

test("the trace list is page marks first, classroom marks after, order kept inside", () => {
  const all = [chatMark("c1"), pageMark("p1"), chatMark("c2"), pageMark("p2", 3)];
  expect(orderTraceMarks(all).map((a) => a.id)).toEqual(["p1", "p2", "c1", "c2"]);
});

// The order is decided here and nowhere else. The list used to sort again on
// sortIndex, which a classroom mark has none of, and the empty key sorts before
// every page's — the second sort put the classroom group on top of the page one.
test("page marks come out in document order whatever order they arrive in", () => {
  const first = onPage("p1", "00001|000130|00100");
  const second = onPage("p2", "00002|000130|00100");
  expect(orderTraceMarks([second, first]).map((a) => a.id)).toEqual(["p1", "p2"]);
});

test("a classroom mark has no sortIndex and still lands after every page mark", () => {
  const all = [chatMark("c1"), onPage("p1", "00001|000130|00100")];
  expect(orderTraceMarks(all).map((a) => a.id)).toEqual(["p1", "c1"]);
});

test("the groups come out named, and an empty one is not a group", () => {
  const all = [chatMark("c1"), onPage("p1", "00002|000130|00100"), onPage("p2", "00001|000130|00100")];
  expect(traceGroups(all).map((g) => [g.key, g.marks.map((a) => a.id)])).toEqual([
    ["page", ["p2", "p1"]],
    ["chat", ["c1"]],
  ]);
  expect(traceGroups([chatMark("c1")]).map((g) => g.key)).toEqual(["chat"]);
  expect(traceGroups([])).toEqual([]);
});

// --- creation -------------------------------------------------------------

test("a pen's mark looks like every other mark downstream", () => {
  const made = buildChatMark({
    id: "c9",
    pen: "highlight",
    color: "#ffd400",
    threadId: "lesson",
    messageTs: 42,
    text: "a sentence",
    occurrence: 2,
    aiThreadId: "t9",
    now: 1700000000000,
  });
  expect(made).not.toBeNull();
  expect(made?.type).toBe("highlight");
  expect(made?.text).toBe("a sentence");
  expect(made?.color).toBe("#ffd400");
  expect(made?.aiThreadId).toBe("t9");
  expect(made?.dateCreated).toBe(new Date(1700000000000).toISOString());
  expect(chatAnchorOf(made)?.occurrence).toBe(2);
  // The AI pen draws the underline stroke here too.
  const drawn = buildChatMark({
    id: "c8",
    pen: "ai",
    color: "#a28ae5",
    threadId: "l",
    messageTs: 1,
    text: "x",
    occurrence: 0,
  });
  expect(drawn?.type).toBe("underline");
  expect(chatAnchorOf(drawn)?.pen).toBe("ai");
  // Nothing to anchor to is not a mark.
  expect(
    buildChatMark({
      id: "c7",
      pen: "ai",
      color: "#a28ae5",
      threadId: "l",
      messageTs: 1,
      text: "  ",
      occurrence: 0,
    }),
  ).toBeNull();
});

// --- observation still finds the book it belongs to -----------------------

test("an observation anchored on a classroom mark is still about this book", () => {
  const observation: Observation = {
    id: "o1",
    type: "stuck-point",
    summary: "s",
    body: "b",
    created: "2026-08-20",
    updated: "2026-08-20",
    anchors: { annotationIds: ["c1"], messageIds: [] },
  };
  const pages = annotationPageMap([pageMark("p1"), chatMark("c1")]);
  expect(pages.get("c1")).toBeNull();
  expect(pages.has("c1")).toBe(true);
  expect(observationScope(observation, "book-1", pages, null)).toBe("book");
  // No page, so it never counts as the chapter in focus.
  expect(
    observationScope(observation, "book-1", pages, { startPage: 1, endPage: 10 }),
  ).toBe("book");
});

// --- which rows a pen may be drawn across ----------------------------------

const reply = { role: "ai" as const, text: "attention heads are three matrices" };

// How deep the conversation is does not come into it: the highlight and the
// underline work on a reply inside a side conversation too (docs/09). Only the
// AI pen is withheld there, and that is decided before a stroke gets here.
test("a pen draws on a settled reply and on nothing else", () => {
  expect(mayMarkReply(reply)).toBe(true);
  // The reader's own words are not the book continued.
  expect(mayMarkReply({ role: "user", text: "what is a head" })).toBe(false);
  // Every delta rebuilds a streaming row, so a Range into it is dead in a
  // frame, and an anchor taken against half a sentence names words the finished
  // reply may not have.
  expect(mayMarkReply({ ...reply, streaming: true })).toBe(false);
  // The app's words standing in for a reply, not the model's.
  expect(mayMarkReply({ ...reply, failed: true })).toBe(false);
  expect(mayMarkReply({ role: "ai", text: "  " })).toBe(false);
});

// --- what a marked reply carries into the next turn -------------------------

const drawn = (id: string, over: Partial<NewChatMark> = {}): Annotation =>
  buildChatMark({
    id,
    pen: "underline",
    color: "#a28ae5",
    threadId: "lesson",
    messageTs: 1000,
    text: "the words",
    occurrence: 0,
    now: 1700000000000,
    ...over,
  }) as Annotation;

const said = { role: "ai" as const, text: "Attention is three matrices.", ts: 1000 };

test("a marked reply comes back with the marked words named after it", () => {
  const out = markedReplyText(said, [drawn("c1")], "lesson");
  // The reply's own sentences come back byte for byte: nothing is wrapped
  // around a phrase for the model to start writing that way itself.
  expect(out.startsWith(`${said.text}\n\n[`)).toBe(true);
  expect(out.endsWith("]")).toBe(true);
  expect(out).toContain("reader");
  expect(out).toContain("“the words”");
});

test("several marks are one block, one passage per line", () => {
  const out = markedReplyText(
    said,
    [drawn("c1", { text: "three matrices" }), drawn("c2", { text: "Attention" })],
    "lesson",
  );
  const block = out.slice(said.text.length + 2);
  expect(block.split("\n")).toEqual(["[marked by the reader in this reply:", "“three matrices”", "“Attention”]"]);
});

test("two pens on the same sentence say it once", () => {
  const out = markedReplyText(
    said,
    [drawn("c1", { text: "three matrices" }), drawn("c2", { text: "three matrices", pen: "highlight" })],
    "lesson",
  );
  expect(out.split("“three matrices”")).toHaveLength(2);
});

// A mark spanning two paragraphs would otherwise break the one-per-line shape.
test("a passage that runs across lines is collapsed to one", () => {
  const out = markedReplyText(said, [drawn("c1", { text: "one\n\n two   three" })], "lesson");
  expect(out).toContain("“one two three”");
});

test("nothing is added to a reply nobody drew on, or to the reader's own words", () => {
  expect(markedReplyText(said, [], "lesson")).toBe(said.text);
  expect(markedReplyText(said, [pageMark("p1")], "lesson")).toBe(said.text);
  // Another message of this conversation, and the same stamp in another one.
  expect(markedReplyText(said, [drawn("c1", { messageTs: 999 })], "lesson")).toBe(said.text);
  expect(markedReplyText(said, [drawn("c1")], "aside-1")).toBe(said.text);
  const asked = { role: "user" as const, text: "what is a head", ts: 1000 };
  expect(markedReplyText(asked, [drawn("c1")], "lesson")).toBe(asked.text);
});

test("the note names the reader as the one who marked, and quotes nothing else", () => {
  expect(chatMarkNote([])).toBe("");
  expect(chatMarkNote([drawn("c1", { text: "   " })])).toBe("");
  expect(chatMarkNote([drawn("c1")])).toBe("[marked by the reader in this reply: “the words”]");
});
