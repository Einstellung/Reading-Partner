// Which of the two kinds of prep material a document is getting, pure. One
// answer per document: a paper reaches outward and gets notes on the works it
// leans on, a book reaches inward and gets a spine per chapter (docs/09). Never
// both — which is what lets the Prep panel be one panel.
//
// A run that exists outranks the measurement. The citation density is a good
// judge and not a perfect one, and once a document has been prepped one way, the
// material on disk is the answer: a panel that switched sides because the
// classifier changed its mind would hide work that is sitting right there.

import type { DocumentShape } from "../../fulltext";

export type PrepKind = "papers" | "chapters";

export interface PrepPresence {
  // A paper-prep run exists for this document (prep-<hash>/state.json).
  papers: boolean;
  // A chapter-spine run exists (prep-<hash>/chapters/state.json).
  chapters: boolean;
  // What the text measures as. Only consulted when nothing has been prepped yet.
  shape: DocumentShape;
}

export function prepKind({ papers, chapters, shape }: PrepPresence): PrepKind {
  if (papers !== chapters) return papers ? "papers" : "chapters";
  // Nothing prepped, or — after a build that once started both — one of each.
  // The measurement is the tie-break either way.
  //
  // "unknown" means too little text to measure, and lands on chapters: a
  // document that short has no reference list worth following outward, and the
  // chapter pass finds no chapters and says so, which costs nothing. Sending it
  // down the paper path would spend a plan call and a round of downloads first.
  return shape === "paper" ? "papers" : "chapters";
}
