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
  createStrokeGate,
  hostMarkIds,
  markDoorThread,
  markOpenAction,
  markedReplyText,
  locateChatMark,
  locateChatMarks,
  mayMarkReply,
  occurrenceAt,
  orderTraceMarks,
  traceGroups,
  traceSelectAction,
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

// --- what a deleted conversation takes with it ----------------------------

test("a deleted conversation takes the page mark hosting it and no mark off a reply", () => {
  const hosted = { ...pageMark("p1"), aiThreadId: "aside-1" };
  const elsewhere = { ...pageMark("p2"), aiThreadId: "aside-2" };
  // The AI pen on a reply records the conversation it opened just as it does on
  // a passage, and that is exactly the mark this must not reach.
  const drawnOnAReply = chatMark("c1", { aiThreadId: "aside-1" });
  const all = [hosted, elsewhere, drawnOnAReply, chatMark("c2")];

  expect(hostMarkIds(all, ["aside-1"])).toEqual(["p1"]);
  expect(hostMarkIds(all, ["aside-1", "aside-2"])).toEqual(["p1", "p2"]);
  expect(hostMarkIds(all, [])).toEqual([]);
});

// --- the click a stroke ends on -------------------------------------------

test("a stroke swallows one click, and only until the next gesture begins", () => {
  const gate = createStrokeGate();
  // A plain tap on a mark: nothing drew, nothing is swallowed.
  expect(gate.closesAStroke()).toBe(false);

  gate.drew();
  expect(gate.closesAStroke()).toBe(true);
  // The next click is the reader pressing the mark they just made.
  expect(gate.closesAStroke()).toBe(false);

  // A touch that draws and produces no click at all must not leave the tap
  // after it swallowed.
  gate.drew();
  gate.began();
  expect(gate.closesAStroke()).toBe(false);
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

test("what a mark is found by and what it is read as are two strings", () => {
  // A stroke across two paragraphs. The rendering holds no character between
  // them, so the anchor holds none either — that is what it is looked up by.
  const made = buildChatMark({
    id: "c6",
    pen: "underline",
    color: "#a28ae5",
    threadId: "lesson",
    messageTs: 7,
    text: "the model.The next step",
    display: "the model. The next step",
    occurrence: 0,
    now: 1700000000000,
  });
  expect(chatAnchorOf(made)?.text).toBe("the model.The next step");
  // The trace list, read_annotations and the note replayed to the model all
  // read this field, and none of them wants two sentences run together.
  expect(made?.text).toBe("the model. The next step");
  expect(chatMarkNote([made as Annotation])).toBe(
    "[marked by the reader in this reply: \u201Cthe model. The next step\u201D]",
  );
  // A stroke inside one block separates nothing, and a mark written before the
  // two strings were told apart has only the one.
  const inside = buildChatMark({
    id: "c5",
    pen: "highlight",
    color: "#ffd400",
    threadId: "lesson",
    messageTs: 7,
    text: "one block",
    occurrence: 0,
  });
  expect(inside?.text).toBe("one block");
  const legacy = { ...(inside as Annotation) };
  delete (legacy as { text?: unknown }).text;
  expect(chatMarkNote([legacy])).toContain("\u201Cone block\u201D");
});

// --- what a mark's door opens ---------------------------------------------

// The conversations this device has a record of.
const there =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);

test("a mark whose conversation is gone is a mark with no door", () => {
  const withAside = chatMark("c1", { aiThreadId: "aside-1" });
  expect(markDoorThread(withAside, there("aside-1"))).toBe("aside-1");
  // annotations and threads are two files that sync apart: a device can hold
  // the mark and not the conversation it points at. Opening a call on that id
  // makes an empty one with no way back, and its first message is written down
  // as a conversation of its own.
  expect(markDoorThread(withAside, there())).toBeNull();
  expect(markDoorThread(chatMark("c2"), there("aside-1"))).toBeNull();
  expect(markDoorThread(pageMark("p1"), there("aside-1"))).toBeNull();
  expect(markDoorThread(undefined, there("aside-1"))).toBeNull();
  // A page mark's door is the same door.
  expect(markDoorThread({ ...pageMark("p2"), aiThreadId: "t2" }, there("t2"))).toBe("t2");
});

test("the door on a trace row points the engine at nothing that has no page", () => {
  // The sparkle button is a door. A page mark is selected and jumped to as it
  // opens; a classroom mark is on no page and must not reach the engine at all
  // (platform/app/reader-contract.ts: pageMarks).
  expect(markOpenAction({ ...pageMark("p1"), aiThreadId: "t1" }, there("t1"))).toEqual({
    jump: true,
    threadId: "t1",
  });
  expect(markOpenAction(pageMark("p2"), there())).toEqual({ jump: true, threadId: null });
  expect(markOpenAction(chatMark("c1", { aiThreadId: "aside-1" }), there("aside-1"))).toEqual({
    jump: false,
    threadId: "aside-1",
  });
  // The conversation is gone: the row still shows the words, and the engine is
  // no more the answer than it was.
  expect(markOpenAction(chatMark("c2", { aiThreadId: "aside-1" }), there())).toEqual({
    jump: false,
    threadId: null,
  });
});

test("a trace row jumps to a page, opens a conversation, or shows nothing but itself", () => {
  expect(traceSelectAction(pageMark("p1"), there())).toEqual({ act: "page" });
  // A page mark with a live conversation still jumps to the page: the row is
  // the jump, the sparkle button is the door.
  expect(traceSelectAction({ ...pageMark("p2"), aiThreadId: "t2" }, there("t2"))).toEqual({
    act: "page",
  });
  // A classroom mark is on no page. It opens the side conversation it made,
  // and failing that the lesson it was drawn in.
  expect(
    traceSelectAction(chatMark("c1", { aiThreadId: "aside-1" }), there("aside-1", "lesson")),
  ).toEqual({ act: "thread", threadId: "aside-1" });
  expect(traceSelectAction(chatMark("c2"), there("lesson"))).toEqual({
    act: "thread",
    threadId: "lesson",
  });
  expect(traceSelectAction(chatMark("c3", { aiThreadId: "aside-1" }), there("lesson"))).toEqual({
    act: "thread",
    threadId: "lesson",
  });
  // Neither is left. The row is the only place those words are shown, so the
  // drawer has to stay open around it.
  expect(traceSelectAction(chatMark("c4"), there())).toEqual({ act: "mark" });
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
