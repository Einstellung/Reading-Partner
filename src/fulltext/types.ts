// Full-text cache shape. One fulltext-<pathHash>.json per document under
// AppData, keyed by the same djb2 path hash as annotations (see storage.ts).
// Pages are 1-based in this module's public API: pages[0] is page 1, and
// OutlineItem.page / SearchHit.page are 1-based.

export const FULLTEXT_VERSION = 1 as const;

export type FulltextStatus = "ok" | "no-text-layer";

export interface OutlineItem {
  title: string;
  page: number; // 1-based
  level: number; // 0 = top level of the table of contents
}

export interface Fulltext {
  version: typeof FULLTEXT_VERSION;
  status: FulltextStatus;
  pages: string[]; // pages[i] is the plain text of page i+1
  outline: OutlineItem[];
  // Which kind of document this was read out of. Absent means PDF: every file
  // written before EPUB ingestion existed is one, so nothing is owed a
  // migration and FULLTEXT_VERSION does not move (docs/39 §1).
  kind?: "pdf" | "epub";
  // EPUB only: the version of the pagination table the pages were cut on. A
  // text cut on an older table is stale even though FULLTEXT_VERSION did not
  // move (docs/64); the EPUB reader passes a freshness check that reads this.
  paginationVersion?: number;
  // EPUB only. A page is a laid-out page, and these hold each page's start as a
  // CFI — the precise layer under a page number, for navigating to [p.N] and
  // for placing a mark. Same length as pages.
  pageLocators?: string[];
  // EPUB only, and only for a book that carries the printed edition's own page
  // numbers: what to show in place of the block number. Same length as pages.
  pageLabels?: string[];
}

export interface SearchDoc {
  label: string;
  fulltext: Fulltext;
}

export interface SearchHit {
  label: string;
  page: number; // 1-based
  score: number;
  snippet: string;
}
