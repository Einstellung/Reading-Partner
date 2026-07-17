// Unit tests for the lazy-prep scheduler (src/prep/scheduler.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  chapterIndexForPage,
  nextQueued,
  normalizeOnLoad,
  paperPriority,
  papersForChapter,
} from "../../src/prep/scheduler";
import { createPrepState, type PrepChapter, type PrepPaper } from "../../src/prep/types";

const CHAPTERS: PrepChapter[] = [
  { index: 1, title: "Introduction", startPage: 1 },
  { index: 2, title: "Perception", startPage: 5 },
  { index: 3, title: "Control", startPage: 12 },
];

function paper(slug: string, chapters: number[], status: PrepPaper["status"] = "queued"): PrepPaper {
  return {
    slug,
    title: slug,
    authors: [],
    year: null,
    arxivId: null,
    citedInChapters: chapters,
    reason: "",
    status,
  };
}

test("chapterIndexForPage picks the last chapter at or before the page", () => {
  expect(chapterIndexForPage(CHAPTERS, 1)).toBe(1);
  expect(chapterIndexForPage(CHAPTERS, 4)).toBe(1);
  expect(chapterIndexForPage(CHAPTERS, 5)).toBe(2);
  expect(chapterIndexForPage(CHAPTERS, 99)).toBe(3);
  expect(chapterIndexForPage([], 7)).toBe(1);
});

test("intro/current-chapter papers come first, then upcoming, then behind", () => {
  const papers = [paper("behind", [1]), paper("current", [2]), paper("ahead", [3])];
  expect(nextQueued(papers, 2, 3)?.slug).toBe("current");
  const withoutCurrent = [paper("behind", [1]), paper("ahead", [3])];
  expect(nextQueued(withoutCurrent, 2, 3)?.slug).toBe("ahead");
});

test("a paper cited in several chapters takes its soonest one", () => {
  expect(paperPriority(paper("x", [1, 3]), 2, 3)).toBe(1); // chapter 3 is 1 ahead
  expect(paperPriority(paper("y", [1]), 2, 3)).toBe(4); // behind: span 3 + distance 1
});

test("user-added papers jump the queue; unknown-chapter papers go last", () => {
  const added = { ...paper("mine", []), addedByUser: true };
  const papers = [paper("current", [1]), added, paper("unknown", [])];
  expect(nextQueued(papers, 1, 3)?.slug).toBe("mine");
  expect(paperPriority(paper("unknown", []), 1, 3)).toBe(6);
});

test("nextQueued ignores non-queued papers and returns null when drained", () => {
  const papers = [
    paper("done", [1], "done"),
    paper("skipped", [1], "skipped"),
    paper("failed", [1], "failed"),
  ];
  expect(nextQueued(papers, 1, 3)).toBeNull();
});

test("normalizeOnLoad requeues in-flight work and restarts an interrupted plan", () => {
  const state = createPrepState("h", "s.pdf", 0);
  state.planStatus = "running";
  state.papers = [paper("a", [1], "fetching"), paper("b", [1], "digesting"), paper("c", [1], "done")];
  const out = normalizeOnLoad(state);
  expect(out.planStatus).toBe("pending");
  expect(out.papers.map((p) => p.status)).toEqual(["queued", "queued", "done"]);
  // done/failed plans are left alone
  expect(normalizeOnLoad({ ...state, planStatus: "done" }).planStatus).toBe("done");
});

test("normalizeOnLoad requeues cooldown papers and tolerates pre-retry state", () => {
  const state = createPrepState("h", "s.pdf", 0);
  state.planStatus = "done";
  state.papers = [
    { ...paper("a", [1], "cooldown"), retryAt: 999, fetchAttempts: 2 },
    paper("b", [1], "queued"), // old persisted state: no retry fields at all
  ];
  const out = normalizeOnLoad(state);
  expect(out.papers[0].status).toBe("queued");
  expect(out.papers[0].retryAt).toBeUndefined();
  expect(out.papers[1].status).toBe("queued");
});

test("papersForChapter returns only noted papers cited in that chapter", () => {
  const papers = [
    paper("a", [1], "done"),
    paper("b", [1], "abstract-only"),
    paper("c", [1], "queued"),
    paper("d", [2], "done"),
  ];
  expect(papersForChapter(papers, 1).map((p) => p.slug)).toEqual(["a", "b"]);
});
