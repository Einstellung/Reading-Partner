// The arrears model (src/observation/distill/arrears.ts): given what every topic has on
// disk and the clock, whether anything is owed and which single debt to pay.
// Pure — no fs, no model, no clock of its own. Run: bun test.

import { expect, test } from "bun:test";
import {
  countNewMarks,
  distillUnitOf,
  distillUnits,
  pagelessMarkIds,
  isTopicDue,
  maxBookMarks,
  selectDistillJob,
  threadArrears,
  toDistillAnnotations,
  topicDebt,
  MIN_DISTILL_GAP_MS,
  MIN_NEW_MARKS,
  type BookArrears,
  type ThreadArrears,
  type TopicArrears,
  type UnitThread,
} from "../../src/observation/distill/arrears";
import type { DistillAnnotation, DistillMessage } from "../../src/observation/distill/distill";

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

function thread(overrides: Partial<ThreadArrears> = {}): ThreadArrears {
  return {
    threadId: "thread-1",
    annotationId: "ann-1",
    page: 3,
    markedText: "a passage",
    messages: [],
    newMessages: 0,
    ...overrides,
  };
}

function book(overrides: Partial<BookArrears> = {}): BookArrears {
  return { bookId: "book-1", bookName: "b.pdf", marks: [], newMarks: 0, threads: [], ...overrides };
}

function topic(overrides: Partial<TopicArrears> = {}): TopicArrears {
  return {
    topicId: "t1",
    topicName: "investing",
    lastDistilledAt: null,
    books: [book()],
    ...overrides,
  };
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

test("threadArrears measures new reader messages from the stored cursor", () => {
  const t = threadArrears({ ...thread(), messages: said(6) }, 2);
  expect(t.newMessages).toBe(2); // rows 2 and 4
  expect(threadArrears({ ...thread(), messages: said(6) }, 6).newMessages).toBe(0);
});

test("topicDebt adds up marks and messages across every book", () => {
  const t = topic({
    books: [
      book({ bookId: "b1", newMarks: 3, threads: [thread({ newMessages: 2 })] }),
      book({ bookId: "b2", newMarks: 4 }),
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
  const t = topic({ books: [book({ marks: marks(4), newMarks: 4 })] });
  expect(isTopicDue(t, NOW)).toBe(false);
});

test("the mark threshold is per book, not per topic", () => {
  // Three here and two there is not five marks' worth of a pass: a pass runs
  // over one book.
  const t = topic({
    books: [
      book({ bookId: "b1", marks: marks(3), newMarks: 3 }),
      book({ bookId: "b2", marks: marks(2, 100), newMarks: 2 }),
    ],
  });
  expect(maxBookMarks(t)).toBe(3);
  expect(topicDebt(t).marks).toBe(5);
  expect(isTopicDue(t, NOW)).toBe(false);
  expect(selectDistillJob([t], NOW)).toBeNull();
});

test("enough marks alone is worth a pass, even with nothing said", () => {
  const t = topic({ books: [book({ marks: marks(MIN_NEW_MARKS), newMarks: MIN_NEW_MARKS })] });
  expect(isTopicDue(t, NOW)).toBe(true);
  expect(selectDistillJob([t], NOW)).toMatchObject({ kind: "marks", topicId: "t1" });
});

test("one thing the reader said is worth a pass on its own", () => {
  const t = topic({
    books: [book({ threads: [thread({ messages: said(2), newMessages: 1 })] })],
  });
  expect(selectDistillJob([t], NOW)).toMatchObject({ kind: "thread", topicId: "t1" });
});

test("a topic distilled minutes ago waits, however much it owes", () => {
  const t = topic({
    lastDistilledAt: NOW - MIN_DISTILL_GAP_MS + 60_000,
    books: [book({ marks: marks(30), newMarks: 30, threads: [thread({ newMessages: 5 })] })],
  });
  expect(isTopicDue(t, NOW)).toBe(false);
  expect(selectDistillJob([t], NOW)).toBeNull();
  // The same topic half an hour later.
  expect(isTopicDue({ ...t, lastDistilledAt: NOW - MIN_DISTILL_GAP_MS }, NOW)).toBe(true);
});

test("a topic never distilled has no gap to wait out", () => {
  const t = topic({ books: [book({ marks: marks(6), newMarks: 6 })] });
  expect(isTopicDue(t, NOW)).toBe(true);
});

// --- choosing ---

test("the topic that owes most is the one that runs, and only that one", () => {
  const small = topic({
    topicId: "t-small",
    books: [book({ bookId: "b1", marks: marks(6), newMarks: 6 })],
  });
  const large = topic({
    topicId: "t-large",
    books: [book({ bookId: "b2", marks: marks(30), newMarks: 30 })],
  });
  const job = selectDistillJob([small, large], NOW);
  expect(job).toMatchObject({ kind: "marks", topicId: "t-large" });
});

test("within a topic a conversation wins over marks, and the fullest thread wins", () => {
  const t = topic({
    books: [
      book({
        bookId: "b1",
        marks: marks(20),
        newMarks: 20,
        threads: [
          thread({ threadId: "quiet", messages: said(2), newMessages: 1 }),
          thread({ threadId: "busy", messages: said(8), newMessages: 4 }),
        ],
      }),
    ],
  });
  const job = selectDistillJob([t], NOW);
  expect(job?.kind).toBe("thread");
  expect(job?.kind === "thread" && job.thread.threadId).toBe("busy");
});

test("with nothing said, the book with the most unread marks is the one taken", () => {
  const t = topic({
    books: [
      book({ bookId: "b1", marks: marks(3), newMarks: 3 }),
      book({ bookId: "b2", marks: marks(9, 100), newMarks: 9 }),
    ],
  });
  const job = selectDistillJob([t], NOW);
  expect(job).toMatchObject({ kind: "marks" });
  expect(job?.kind === "marks" && job.book.bookId).toBe("b2");
});

test("a failed pass leaves the debt, so the next sweep picks the same job", () => {
  // A failed pass advances nothing (runDistillPass), so the arrears read back
  // unchanged and the gap is measured from the last pass that did finish.
  const t = topic({
    lastDistilledAt: NOW - 2 * HOUR,
    books: [book({ marks: marks(8), newMarks: 8 })],
  });
  expect(selectDistillJob([t], NOW)).toMatchObject({ kind: "marks" });
  expect(selectDistillJob([t], NOW + HOUR)).toMatchObject({ kind: "marks" });
});

test("a pass that just finished settles the topic until the gap is out", () => {
  // What a finished pass leaves behind: cursors moved, so no arrears, and a
  // fresh stamp.
  const settled = topic({ lastDistilledAt: NOW, books: [book({ marks: marks(8), newMarks: 0 })] });
  expect(selectDistillJob([settled], NOW + 1000)).toBeNull();
  expect(selectDistillJob([settled], NOW + 2 * HOUR)).toBeNull();
});

test("ties between topics resolve the same way every sweep", () => {
  const a = topic({ topicId: "aaa", books: [book({ marks: marks(6), newMarks: 6 })] });
  const b = topic({ topicId: "bbb", books: [book({ marks: marks(6), newMarks: 6 })] });
  expect(selectDistillJob([a, b], NOW)?.topicId).toBe("aaa");
  expect(selectDistillJob([b, a], NOW)?.topicId).toBe("aaa");
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

// Only the three fields a transcript is made of: a stored message also carries
// image filenames and the display row's parts, and neither is the retell.
test("a folded transcript carries no more than role, text and ts", () => {
  const threads = [
    unit({ id: "bt", messages: [{ ...said1("l1", 1), images: ["a.png"] } as DistillMessage] }),
    unit({ id: "as", parentThreadId: "bt", messages: [said1("a1", 2)] }),
  ];
  expect(distillUnits(threads)[0].messages[0]).toEqual({ role: "user", text: "l1", ts: 1 });
});
