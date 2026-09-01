// Which observations ride a lecture turn (src/reading/lecture/stuck.ts). The
// three failures this is written against are all measured (docs/09): page
// numbers in an observation's prose picking the wrong book, a chapter focus
// throwing away the best cross-book material, and corrections never reaching a
// prompt at all. Run: bun test.

import { expect, test } from "bun:test";
import type { Annotation } from "../../../src/platform/app/reader-contract";
import type { Observation, ObservationType } from "../../../src/memory";
import {
  annotationPageMap,
  lectureObservationSnapshot,
  observationScope,
  selectLectureObservations,
  CORRECTION_QUOTA,
  LECTURE_OBSERVATION_CAP,
} from "../../../src/reading/lecture";

const BOOK = "book-hash";
const OTHER = "other-hash";

function obs(over: Partial<Observation> & { id: string }): Observation {
  return {
    type: "stuck-point",
    summary: `summary of ${over.id}`,
    body: `body of ${over.id}`,
    created: "2026-08-01",
    updated: "2026-08-01",
    anchors: { annotationIds: [], messageIds: [] },
    ...over,
  };
}

function mark(id: string, page: number): Annotation {
  return { id, type: "highlight", position: { pageIndex: page - 1 } } as unknown as Annotation;
}

// The measured collision: 20 observations whose bodies name pages 149-193 are
// all about Hands-On, and chapter 5 of the book actually open is p.149-193.
// Anything that reads the page out of the prose picks the wrong book every
// time; the anchors are the evidence, and the stamped bookId is the same answer
// without the lookup.
test("which book an observation is about comes from its anchors, not its prose", () => {
  const pages = annotationPageMap([mark("ann-here", 160)]);
  const focus = { startPage: 149, endPage: 193 };

  const anchored = obs({ id: "m-1", anchors: { annotationIds: ["ann-here"], messageIds: [] } });
  expect(observationScope(anchored, BOOK, pages, focus)).toBe("chapter");

  // Same page numbers in the body, no anchor on this book: another book's.
  const elsewhere = obs({ id: "m-2", body: "stuck on p.162 of the other book" });
  expect(observationScope(elsewhere, BOOK, pages, focus)).toBe("other");

  // Stamped at write time (record/types.ts), which needs no lookup at all.
  const stamped = obs({ id: "m-3", bookId: BOOK });
  expect(observationScope(stamped, BOOK, pages, focus)).toBe("book");
  expect(observationScope(obs({ id: "m-4", bookId: OTHER }), BOOK, pages, focus)).toBe("other");
});

// The two most useful citations in the measured lecture came out of a different
// book, so the focus orders and never filters.
test("the chapter's own come first, and everything else is still reachable", () => {
  const pages = annotationPageMap([mark("in", 160), mark("out", 20)]);
  const observations = [
    obs({ id: "cross", bookId: OTHER, updated: "2026-08-18" }),
    obs({ id: "elsewhere", anchors: { annotationIds: ["out"], messageIds: [] }, updated: "2026-08-17" }),
    obs({ id: "here", anchors: { annotationIds: ["in"], messageIds: [] }, updated: "2026-08-01" }),
  ];
  const picked = selectLectureObservations({
    observations,
    bookId: BOOK,
    annotationPages: pages,
    focus: { startPage: 149, endPage: 193 },
  });
  expect(picked.map((p) => p.observation.id)).toEqual(["here", "elsewhere", "cross"]);
  expect(picked.map((p) => p.scope)).toEqual(["chapter", "book", "other"]);
});

// In the shared snapshot corrections sort last under a total cap the types above
// them exhaust: one topic's six corrections had never once reached a prompt.
test("corrections have a quota of their own, past everything above them", () => {
  const filler = Array.from({ length: 30 }, (_, i) =>
    obs({ id: `filler-${i}`, type: "stuck-point", bookId: BOOK, updated: "2026-08-19" }),
  );
  const corrections = Array.from({ length: 6 }, (_, i) =>
    obs({ id: `fix-${i}`, type: "correction" as ObservationType, updated: "2026-07-01" }),
  );
  const picked = selectLectureObservations({
    observations: [...filler, ...corrections],
    bookId: BOOK,
    annotationPages: new Map(),
    focus: null,
  });
  const kept = picked.filter((p) => p.observation.type === "correction");
  expect(kept.length).toBe(CORRECTION_QUOTA);
  expect(picked.length).toBeLessThanOrEqual(LECTURE_OBSERVATION_CAP);
});

// docs/09, 2026-08-20: the classroom's reader has read none of the book, so
// "they are on p.132" is the least of what a lecture turn should open with — and
// reading-position entries are the newest there are, which is what put them
// first. Kept, but last, and only if there is room.
test("the reading position sinks to the end at book level and holds its place on a mark", () => {
  const observations = [
    obs({ id: "where", type: "reading-position", bookId: BOOK, updated: "2026-08-20" }),
    obs({ id: "stuck", type: "stuck-point", bookId: BOOK, updated: "2026-08-01" }),
  ];
  const input = { observations, bookId: BOOK, annotationPages: new Map(), focus: null };
  expect(
    selectLectureObservations({ ...input, bookLevel: true }).map((p) => p.observation.id),
  ).toEqual(["stuck", "where"]);
  expect(selectLectureObservations(input).map((p) => p.observation.id)).toEqual(["where", "stuck"]);
});

// The band it is kept out of is the one with a cap, so a book-level turn full of
// this book's own material spends none of it on the position.
test("a full book-level turn spends no room on the reading position", () => {
  const observations = [
    ...Array.from({ length: 20 }, (_, i) =>
      obs({ id: `pos-${i}`, type: "reading-position", bookId: BOOK, updated: "2026-08-20" }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      obs({ id: `stuck-${i}`, type: "stuck-point", bookId: BOOK, updated: "2026-08-19" }),
    ),
  ];
  const picked = selectLectureObservations({
    observations,
    bookId: BOOK,
    annotationPages: new Map(),
    focus: null,
    bookLevel: true,
  });
  expect(picked.length).toBe(LECTURE_OBSERVATION_CAP);
  expect(picked.every((p) => p.observation.type === "stuck-point")).toBe(true);
});

test("the cap holds and nothing is picked twice", () => {
  const observations = Array.from({ length: 40 }, (_, i) =>
    obs({ id: `m-${i}`, bookId: BOOK, updated: `2026-08-${String((i % 28) + 1).padStart(2, "0")}` }),
  );
  const picked = selectLectureObservations({
    observations,
    bookId: BOOK,
    annotationPages: new Map(),
    focus: null,
  });
  expect(picked.length).toBe(LECTURE_OBSERVATION_CAP);
  expect(new Set(picked.map((p) => p.observation.id)).size).toBe(picked.length);

  const tight = selectLectureObservations({
    observations,
    bookId: BOOK,
    annotationPages: new Map(),
    focus: null,
    limit: 4,
  });
  expect(tight.length).toBe(4);
});

// The prescription is in the body ("non-AI analogy plus a worked example with
// real numbers; leading with the formula does not work"); the summary line is
// the half of it a lecture cannot act on.
test("this book's entries print their bodies, other books' print their line", () => {
  const pages = annotationPageMap([mark("in", 160)]);
  const picked = selectLectureObservations({
    observations: [
      obs({
        id: "m-here",
        anchors: { annotationIds: ["in"], messageIds: [] },
        body: "non-AI analogy plus a worked example with real numbers",
      }),
      obs({ id: "m-cross", bookId: OTHER, body: "a body nobody asked for" }),
    ],
    bookId: BOOK,
    annotationPages: pages,
    focus: { startPage: 149, endPage: 193 },
  });
  const snapshot = lectureObservationSnapshot(picked, { startPage: 149, endPage: 193 });
  expect(snapshot).toContain("non-AI analogy plus a worked example with real numbers");
  expect(snapshot).toContain("this book, the chapter in focus");
  expect(snapshot).toContain("another book in this topic");
  expect(snapshot).not.toContain("a body nobody asked for");
  expect(lectureObservationSnapshot([])).toBe("");
});
