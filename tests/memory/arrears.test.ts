// The arrears model (src/memory/observations/arrears.ts): given what the
// registered sources owe every topic and the clock, whether anything is owed and
// which single debt to pay. Pure — no fs, no model, no clock of its own.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  countNewMarks,
  countUnitOwed,
  distillUnitOf,
  distillUnits,
  pagelessMarkIds,
  isTopicDue,
  maxUnitMarks,
  selectDistillJob,
  toDistillAnnotations,
  topicDebt,
  unitArrears,
  MIN_DISTILL_GAP_MS,
  MIN_NEW_MARKS,
  type SourceArrears,
  type SourceMarksUnit,
  type SourceMessagesUnit,
  type TopicArrears,
  type UnitThread,
} from "../../src/memory/observations/arrears";
import type { DistillAnnotation, DistillMessage } from "../../src/memory/observations/distill";

const NOW = new Date("2026-08-10T12:00:00Z").getTime();
const HOUR = 60 * 60_000;

function mark(overrides: Partial<DistillAnnotation> = {}): DistillAnnotation {
  return { id: "m1", page: 3, text: "a passage", createdAt: 100, ...overrides };
}

function marks(n: number, from = 1): DistillAnnotation[] {
  return Array.from({ length: n }, (_, i) => mark({ id: `m${from + i}`, createdAt: from + i }));
}

function said(n: number): DistillMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "ai") as "user" | "ai",
    text: `t${i}`,
    ts: i,
  }));
}

function convo(over: Partial<SourceMessagesUnit> = {}): SourceMessagesUnit {
  return {
    cursor: "distilledMessages",
    id: "thread-1",
    topicId: "t1",
    label: "b.pdf",
    bookId: "book-1",
    annotationId: "ann-1",
    page: 3,
    markedText: "a passage",
    messages: [],
    ...over,
  };
}

function marked(over: Partial<SourceMarksUnit> = {}): SourceMarksUnit {
  return { cursor: "distilledMarks", id: "book-1", topicId: "t1", label: "b.pdf", marks: [], ...over };
}

function owes(unit: SourceMessagesUnit | SourceMarksUnit, owed: number): SourceArrears {
  return { source: unit.cursor === "distilledMarks" ? "annotations" : "reading-thread", unit, owed };
}

function topic(overrides: Partial<TopicArrears> = {}): TopicArrears {
  return { topicId: "t1", topicName: "investing", lastDistilledAt: null, units: [], ...overrides };
}

// --- measuring ---

test("toDistillAnnotations reduces engine marks, and treats an unreadable date as new", () => {
  const [a, b] = toDistillAnnotations(
    [
      {
        id: "a1",
        type: "highlight",
        position: { pageIndex: 11 },
        text: "owner earnings",
        comment: "why not FCF?",
        dateCreated: "2026-08-01T00:00:00.000Z",
      },
      { id: "a2", type: "highlight" },
    ],
    () => NOW,
  );
  expect(a).toEqual({
    id: "a1",
    page: 12,
    text: "owner earnings",
    comment: "why not FCF?",
    createdAt: Date.parse("2026-08-01T00:00:00.000Z"),
  });
  expect(b).toEqual({ id: "a2", page: null, text: "", comment: undefined, createdAt: NOW });
});

test("countNewMarks counts past the cursor and drops marks with nothing in them", () => {
  const list = [
    mark({ id: "a", createdAt: 100 }),
    mark({ id: "b", createdAt: 300 }),
    mark({ id: "c", createdAt: 400, text: "  ", comment: "  " }), // nothing to read
    mark({ id: "d", createdAt: 500, text: "", comment: "a note" }), // note counts
  ];
  expect(countNewMarks(list, null)).toBe(3);
  expect(countNewMarks(list, 100)).toBe(2);
  expect(countNewMarks(list, 500)).toBe(0);
});

test("countUnitOwed measures new reader messages from the stored cursor", () => {
  expect(countUnitOwed(convo({ messages: said(6) }), 2)).toBe(2); // rows 2 and 4
  expect(countUnitOwed(convo({ messages: said(6) }), 6)).toBe(0);
  // A unit merged from several threads takes a cursor per part.
  const merged = convo({
    messages: said(4),
    parts: [
      { threadId: "lesson", messages: said(2) },
      { threadId: "aside", messages: said(2) },
    ],
  });
  expect(countUnitOwed(merged, (threadId) => (threadId === "lesson" ? 2 : 0))).toBe(1);
});

test("countUnitOwed measures marks made after the stored timestamp", () => {
  const unit = marked({ marks: marks(5) });
  expect(countUnitOwed(unit, null)).toBe(5);
  expect(countUnitOwed(unit, 3)).toBe(2);
  expect(unitArrears("annotations", unit, 3)).toEqual({ source: "annotations", unit, owed: 2 });
});

test("topicDebt separates what is owed in marks from what is owed in messages", () => {
  const t = topic({
    units: [
      owes(marked({ id: "b1" }), 3),
      owes(marked({ id: "b2" }), 4),
      owes(convo({ messages: said(4) }), 2),
    ],
  });
  expect(topicDebt(t)).toEqual({ marks: 7, messages: 2 });
});

// --- the gates ---

test("nothing owed, nothing run", () => {
  expect(isTopicDue(topic(), NOW)).toBe(false);
  expect(selectDistillJob([topic()], NOW)).toBeNull();
});

test("a few marks and no conversation is not worth a pass", () => {
  const t = topic({ units: [owes(marked({ marks: marks(4) }), 4)] });
  expect(isTopicDue(t, NOW)).toBe(false);
});

test("the mark threshold is per book, not per topic", () => {
  // Three here and two there is not five marks' worth of a pass: a pass runs
  // over one book.
  const t = topic({
    units: [owes(marked({ id: "b1" }), 3), owes(marked({ id: "b2" }), 2)],
  });
  expect(maxUnitMarks(t)).toBe(3);
  expect(topicDebt(t).marks).toBe(5);
  expect(isTopicDue(t, NOW)).toBe(false);
  expect(selectDistillJob([t], NOW)).toBeNull();
});

test("enough marks alone is worth a pass, even with nothing said", () => {
  const t = topic({ units: [owes(marked({ marks: marks(MIN_NEW_MARKS) }), MIN_NEW_MARKS)] });
  expect(isTopicDue(t, NOW)).toBe(true);
  expect(selectDistillJob([t], NOW)).toMatchObject({ topicId: "t1", source: "annotations" });
});

test("one thing the reader said is worth a pass on its own", () => {
  const t = topic({ units: [owes(convo({ messages: said(2) }), 1)] });
  expect(selectDistillJob([t], NOW)).toMatchObject({ topicId: "t1", source: "reading-thread" });
});

test("a topic distilled minutes ago waits, however much it owes", () => {
  const t = topic({
    lastDistilledAt: NOW - MIN_DISTILL_GAP_MS + 60_000,
    units: [owes(marked({ marks: marks(30) }), 30), owes(convo(), 5)],
  });
  expect(isTopicDue(t, NOW)).toBe(false);
  expect(selectDistillJob([t], NOW)).toBeNull();
  // The same topic half an hour later.
  expect(isTopicDue({ ...t, lastDistilledAt: NOW - MIN_DISTILL_GAP_MS }, NOW)).toBe(true);
});

test("a topic never distilled has no gap to wait out", () => {
  expect(isTopicDue(topic({ units: [owes(marked({ marks: marks(6) }), 6)] }), NOW)).toBe(true);
});

// --- choosing ---

test("the topic that owes most is the one that runs, and only that one", () => {
  const small = topic({ topicId: "t-small", units: [owes(marked({ id: "b1" }), 6)] });
  const large = topic({ topicId: "t-large", units: [owes(marked({ id: "b2" }), 30)] });
  expect(selectDistillJob([small, large], NOW)).toMatchObject({
    topicId: "t-large",
    source: "annotations",
  });
});

test("within a topic a conversation wins over marks, and the fullest one wins", () => {
  const t = topic({
    units: [
      owes(marked({ marks: marks(20) }), 20),
      owes(convo({ id: "quiet", messages: said(2) }), 1),
      owes(convo({ id: "busy", messages: said(8) }), 4),
    ],
  });
  expect(selectDistillJob([t], NOW)?.unit.id).toBe("busy");
});

test("with nothing said, the book with the most unread marks is the one taken", () => {
  const t = topic({
    units: [owes(marked({ id: "b1" }), 3), owes(marked({ id: "b2" }), 9)],
  });
  const job = selectDistillJob([t], NOW);
  expect(job?.source).toBe("annotations");
  expect(job?.unit.id).toBe("b2");
});

test("every registered source's conversations stand in the same queue", () => {
  // A briefing and a book's thread are chosen between on what each owes, not on
  // which domain wrote them.
  const t = topic({
    units: [
      { source: "reading-thread", unit: convo({ id: "book" }), owed: 2 },
      { source: "info-thread", unit: convo({ id: "brief", bookId: undefined }), owed: 5 },
    ],
  });
  expect(selectDistillJob([t], NOW)).toMatchObject({ source: "info-thread", topicId: "t1" });
});

test("a failed pass leaves the debt, so the next sweep picks the same job", () => {
  // A failed pass advances nothing (runDistillPass), so the arrears read back
  // unchanged and the gap is measured from the last pass that did finish.
  const t = topic({ lastDistilledAt: NOW - 2 * HOUR, units: [owes(marked({ marks: marks(8) }), 8)] });
  expect(selectDistillJob([t], NOW)).toMatchObject({ source: "annotations" });
  expect(selectDistillJob([t], NOW + HOUR)).toMatchObject({ source: "annotations" });
});

test("a pass that just finished settles the topic until the gap is out", () => {
  // What a finished pass leaves behind: cursors moved, so no arrears, and a
  // fresh stamp.
  const settled = topic({ lastDistilledAt: NOW, units: [owes(marked({ marks: marks(8) }), 0)] });
  expect(selectDistillJob([settled], NOW + 1000)).toBeNull();
  expect(selectDistillJob([settled], NOW + 2 * HOUR)).toBeNull();
});

test("ties between topics resolve the same way every sweep", () => {
  const a = topic({ topicId: "aaa", units: [owes(marked({ marks: marks(6) }), 6)] });
  const b = topic({ topicId: "bbb", units: [owes(marked({ marks: marks(6) }), 6)] });
  expect(selectDistillJob([a, b], NOW)?.topicId).toBe("aaa");
  expect(selectDistillJob([b, a], NOW)?.topicId).toBe("aaa");
});

test("ties between units resolve on the earlier id", () => {
  const t = topic({
    units: [owes(convo({ id: "zzz" }), 3), owes(convo({ id: "aaa" }), 3)],
  });
  expect(selectDistillJob([t], NOW)?.unit.id).toBe("aaa");
});

// --- what counts as one conversation (docs/03: asides) ---

function said1(id: string, ts: number, role: "user" | "ai" = "user"): DistillMessage {
  return { role, text: id, ts };
}

function unit(over: Partial<UnitThread> & { id: string }): UnitThread {
  return { annotationId: "", messages: [], ...over };
}

// The lesson at ts 1-2 and 7-8, the aside it was interrupted by at 4-5. One
// cursor, counted in messages, has to index the lot — so the merge is by time.
test("a chat-span aside joins its parent's transcript, in the order it happened", () => {
  const threads: UnitThread[] = [
    unit({
      id: "bt",
      messages: [said1("l1", 1), said1("l2", 2, "ai"), said1("l3", 7), said1("l4", 8, "ai")],
    }),
    unit({ id: "as", parentThreadId: "bt", messages: [said1("a1", 4), said1("a2", 5, "ai")] }),
  ];
  const units = distillUnits(threads);
  expect(units).toHaveLength(1);
  expect(units[0].threadId).toBe("bt");
  expect(units[0].messages.map((m) => m.text)).toEqual(["l1", "l2", "a1", "a2", "l3", "l4"]);
  // Asking about the aside answers with the conversation it belongs to.
  expect(distillUnitOf(threads, "as")?.threadId).toBe("bt");
  expect(distillUnitOf(threads, "bt")?.threadId).toBe("bt");
});

// An aside drawn on a page has a mark and a page, so the pass can say where in
// the book it happened. It stays its own unit, exactly like the mark thread it
// is drawn beside.
test("a page-anchored aside keeps a unit of its own", () => {
  const threads: UnitThread[] = [
    unit({ id: "bt", messages: [said1("l1", 1)] }),
    unit({ id: "as", annotationId: "ann-drawn", parentThreadId: "bt", messages: [said1("a1", 2)] }),
  ];
  const units = distillUnits(threads).map((u) => u.threadId).sort();
  expect(units).toEqual(["as", "bt"]);
  expect(distillUnitOf(threads, "as")?.messages.map((m) => m.text)).toEqual(["a1"]);
  expect(distillUnitOf(threads, "bt")?.messages.map((m) => m.text)).toEqual(["l1"]);
});

// Sync can leave an aside whose parent was deleted elsewhere. Folding it into a
// thread that is not there is how the reader's best material goes quietly
// missing, so it becomes a unit and gets its own pass.
test("an aside with no parent left is distilled on its own rather than dropped", () => {
  const threads: UnitThread[] = [
    unit({ id: "as", parentThreadId: "gone", messages: [said1("a1", 2)] }),
  ];
  expect(distillUnits(threads).map((u) => u.threadId)).toEqual(["as"]);
  expect(distillUnitOf(threads, "as")?.messages.map((m) => m.text)).toEqual(["a1"]);
});

// A pen can mark an AI reply too (docs/09), and the aside that opens off one is
// an annotation with no page. It folds into the lesson like a chat-span aside:
// a pass over it could not say where in the book it happened.
test("an aside drawn on a reply folds into its parent", () => {
  const threads: UnitThread[] = [
    unit({ id: "bt", messages: [said1("l1", 1)] }),
    unit({ id: "as", annotationId: "ann-chat", parentThreadId: "bt", messages: [said1("a1", 2)] }),
  ];
  const pageless = pagelessMarkIds([
    { id: "ann-page", page: 4, text: "x", createdAt: 1 },
    { id: "ann-chat", page: null, text: "y", createdAt: 2 },
  ]);
  expect(distillUnits(threads, pageless).map((u) => u.threadId)).toEqual(["bt"]);
  expect(distillUnitOf(threads, "as", pageless)?.threadId).toBe("bt");
  // A mark the caller could not look up is left where it was: its own unit, the
  // answer every record written before chat marks existed gets.
  expect(distillUnits(threads, new Set()).map((u) => u.threadId).sort()).toEqual(["as", "bt"]);
  expect(distillUnits(threads).map((u) => u.threadId).sort()).toEqual(["as", "bt"]);
});

test("a book with no asides is one unit per thread, unchanged", () => {
  const threads: UnitThread[] = [
    unit({ id: "bt", messages: [said1("l1", 1)] }),
    unit({ id: "t1", annotationId: "ann-1", messages: [said1("m1", 2)] }),
  ];
  expect(distillUnits(threads).map((u) => u.threadId)).toEqual(["bt", "t1"]);
  expect(distillUnitOf(threads, "missing")).toBeNull();
});

// Only the fields a transcript is made of: a stored message also carries image
// filenames and the display row's parts, and neither is the retell.
test("a folded transcript carries role, text, ts and the message's own thread id", () => {
  const threads = [
    unit({ id: "bt", messages: [{ ...said1("l1", 1), images: ["a.png"] } as DistillMessage] }),
    unit({ id: "as", parentThreadId: "bt", messages: [said1("a1", 2)] }),
  ];
  // Stamped here because this is the last place that knows it: after the merge
  // the only thread id in scope is the parent's (transcript.ts).
  expect(distillUnits(threads)[0].messages[0]).toEqual({
    role: "user",
    text: "l1",
    ts: 1,
    threadId: "bt",
  });
});
