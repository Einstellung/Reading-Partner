// A document the reader took in, as the prep list sees it (docs/67 「和 ingest_url
// 合并」).
//
// One URL makes one document: a link pasted while reading becomes a supplement
// of the book, its bytes go in the library and its text into the full-text store
// under that document's id. The prep run is then handed what is already in hand
// — the same Fulltext, not a second fetch — so read_paper reads the pages the
// reader is looking at and cites them by the title on the Outline.
//
// Pure, and the mirror of prepareSavedArticle (reading/saved-article-tools.ts):
// what a captured source needs is a paper to mint and a fetch outcome to stand
// in for the fetch stage.

import type { Fulltext } from "../../../fulltext/types";
import { uniqueSlug } from "./plan";
import type { FetchOutcome } from "./pipeline";
import type { PrepPaper } from "./types";

/** The document, as much of it as the prep list records. */
export interface CapturedDocument {
  /** The document's id in the library, which is where its text is filed too. */
  documentId: string;
  /** What it is called on the Outline, and therefore how it is cited. */
  title: string;
  kind: "pdf" | "article";
  sourceUrl?: string;
}

export interface PreparedSource {
  mint(taken: Set<string>): PrepPaper;
  fetched: FetchOutcome;
}

/**
 * What a supplement becomes on the prep list: a user-added source whose fetch
 * stage is already over, pointing at the document the reader can open.
 */
export function prepareCapturedDocument(
  doc: CapturedDocument,
  fulltext: Fulltext,
  reason = "",
): PreparedSource {
  return {
    mint: (taken) => ({
      slug: uniqueSlug(taken, doc.title || doc.documentId),
      title: doc.title,
      authors: [],
      year: null,
      arxivId: null,
      citedInChapters: [],
      reason,
      status: "queued",
      addedByUser: true,
      captured: true,
      documentId: doc.documentId,
      ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
      kind: doc.kind,
    }),
    fetched: {
      source: "url",
      arxivId: null,
      abstract: "",
      pdfBytes: null,
      fulltext,
      kind: doc.kind,
      title: doc.title,
    },
  };
}
