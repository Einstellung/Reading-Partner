// Lazy-prep scheduling, pure. The queue follows the reader: papers cited by
// the chapter being read come first, then upcoming chapters in order, then
// chapters already behind. User-added papers jump the queue (an explicit ask).
// One paper runs at a time; the pipeline calls nextQueued after every finish.

import type { PrepChapter, PrepPaper, PrepState } from "./types";

// The chapter (1-based index) a page falls in: the last chapter whose startPage
// is at or before the page. Pages before the first chapter belong to it.
export function chapterIndexForPage(chapters: PrepChapter[], page: number): number {
  if (chapters.length === 0) return 1;
  let best = chapters[0].index;
  for (const c of chapters) {
    if (c.startPage <= page) best = c.index;
  }
  return best;
}

// Lower is sooner. Ahead-of-reader chapters count up from 0; behind-the-reader
// chapters queue after all upcoming ones. A paper cited in several chapters
// takes its best (soonest) one; a paper with no chapter data goes last.
export function paperPriority(paper: PrepPaper, currentChapter: number, chapterCount: number): number {
  if (paper.addedByUser) return -1;
  const span = Math.max(chapterCount, 1);
  if (paper.citedInChapters.length === 0) return 2 * span;
  let best = Infinity;
  for (const ch of paper.citedInChapters) {
    const score = ch >= currentChapter ? ch - currentChapter : span + (currentChapter - ch);
    if (score < best) best = score;
  }
  return best;
}

// The next paper to prep, or null when nothing is queued. Ties keep nomination
// order (stable sort over the original array order).
export function nextQueued(
  papers: PrepPaper[],
  currentChapter: number,
  chapterCount: number,
): PrepPaper | null {
  let best: PrepPaper | null = null;
  let bestScore = Infinity;
  for (const p of papers) {
    if (p.status !== "queued") continue;
    const score = paperPriority(p, currentChapter, chapterCount);
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

// The earliest retryAt among papers still cooling down, or null when none are.
// Drives how long the run loop waits before re-checking the cooldown queue.
export function earliestCooldown(papers: PrepPaper[]): number | null {
  let min = Infinity;
  for (const p of papers) {
    if (p.status === "cooldown" && typeof p.retryAt === "number") min = Math.min(min, p.retryAt);
  }
  return min === Infinity ? null : min;
}

// Recover a persisted state at load: statuses that only make sense mid-run
// ("fetching"/"digesting") go back to "queued", and an interrupted plan call
// back to "pending", so a restart resumes instead of hanging. Papers that were
// cooling down are requeued so a restart re-attempts them immediately. Old
// states predate the retry fields; they simply lack them and load unchanged.
export function normalizeOnLoad(state: PrepState): PrepState {
  return {
    ...state,
    planStatus: state.planStatus === "running" ? "pending" : state.planStatus,
    papers: state.papers.map((p) =>
      p.status === "fetching" || p.status === "digesting" || p.status === "cooldown"
        ? { ...p, status: "queued" as const, retryAt: undefined }
        : p,
    ),
  };
}

// Papers whose notes belong in the classroom context for a chapter: cited in
// that chapter and having a note on disk (done or abstract-only).
export function papersForChapter(papers: PrepPaper[], chapter: number): PrepPaper[] {
  return papers.filter(
    (p) =>
      (p.status === "done" || p.status === "abstract-only") &&
      p.citedInChapters.includes(chapter),
  );
}
