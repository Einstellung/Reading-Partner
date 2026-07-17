// Lesson-prep data model (docs/09). One prep run per survey document, keyed by
// the same djb2 path hash as annotations/fulltext. The state file is a derived
// view — rebuildable from the survey plus the network — and lives under
// prep-<surveyHash>/ next to the notes it indexes.

export const PREP_VERSION = 1 as const;

// A chapter of the survey as the plan call reported it. `startPage` is 1-based
// and drives both lazy scheduling (which chapter is the user in) and the
// classroom context (which notes ride along).
export interface PrepChapter {
  index: number; // 1-based chapter order
  title: string;
  startPage: number;
}

// One entry of the survey's reference list (stage a output). `key` is the
// citation key as it appears in the survey (e.g. "12" or "Smith2023").
export interface PrepReference {
  key: string;
  title: string;
  authors: string[];
  year: number | null;
  arxivId: string | null;
  citedInChapters: number[];
  // Singled out in the survey body (its own paragraph/subsection), one of the
  // two nomination criteria.
  expanded: boolean;
}

export type PaperStatus =
  | "queued"
  | "fetching"
  | "digesting"
  | "done"
  | "failed"
  // Rate-limited: not fetched this round, waiting for retryAt to elapse.
  | "cooldown"
  | "abstract-only"
  | "skipped";

// A load-bearing paper being prepped (stage b output, or user-added). The slug
// names its note file (prep-<hash>/<slug>.md) and its cached PDF.
export interface PrepPaper {
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  arxivId: string | null;
  citedInChapters: number[];
  // Why the survey leans on it — from the nomination, injected into the digest
  // prompt so the note is written from the survey's angle.
  reason: string;
  status: PaperStatus;
  addedByUser?: boolean;
  error?: string;
  source?: "arxiv" | "openalex" | "semantic-scholar" | null;
  abstract?: string;
  // Page count of the fetched PDF, set after extraction.
  pages?: number | null;
  // Rate-limit bookkeeping. fetchAttempts counts the cooldown rounds a 429 has
  // cost this paper; retryAt is when the current cooldown lifts (status
  // "cooldown"). Both reset on a manual retry and after a successful fetch.
  fetchAttempts?: number;
  retryAt?: number;
}

export type PlanStatus = "pending" | "running" | "done" | "failed";

export interface PrepState {
  version: typeof PREP_VERSION;
  surveyHash: string;
  surveyName: string;
  createdAt: number;
  planStatus: PlanStatus;
  planError?: string;
  chapters: PrepChapter[];
  references: PrepReference[];
  papers: PrepPaper[];
}

export function createPrepState(surveyHash: string, surveyName: string, now: number): PrepState {
  return {
    version: PREP_VERSION,
    surveyHash,
    surveyName,
    createdAt: now,
    planStatus: "pending",
    chapters: [],
    references: [],
    papers: [],
  };
}
