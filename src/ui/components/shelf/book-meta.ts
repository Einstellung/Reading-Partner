// What a card says about a book beyond its title: where the reader left off, how
// long the book is, and how much of it has been marked. Three optional reads —
// a book that was never opened has no view state, no full-text cache and no
// annotation file, which is the normal case and not an error.
//
// One copy, because two screens ask the same question: the topic's Materials
// grid, and the Continue reading card on Today.

import { loadAnnotations } from "../../../platform/app/annotations";
import { getViewState } from "../../../platform/app/storage";
import { getFulltext } from "../../../fulltext";
import type { FileRef } from "../../../platform/app/topics";
import type { BookMeta } from "./file-title";

// A file with no book id has never been opened since the upgrade that gave books
// one, so there is nothing on disk keyed by it.
export async function readBookMeta(file: FileRef): Promise<BookMeta> {
  if (!file.hash) return { marks: 0 };
  const [state, fulltext, annotations] = await Promise.all([
    getViewState(file.hash).catch(() => null),
    getFulltext(file.hash).catch(() => null),
    loadAnnotations(file.hash).catch(() => []),
  ]);
  return {
    page: state ? state.pageIndex + 1 : undefined,
    pages: fulltext?.pages.length || undefined,
    marks: annotations.length,
  };
}
