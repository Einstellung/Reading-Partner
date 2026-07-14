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
