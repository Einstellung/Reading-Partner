// An article on the shelf. A web article is the same document a book is
// (docs/67) and opens the same way, but it has no cover, so in a topic's
// Materials section it is a row of text instead of a card: title, the host it
// came from, and when it was published.
//
// Here because it is what the row says, not how it is drawn — the same split
// file-title.ts makes for cards.

import {
  displaySource,
  isArticleEntry,
  type LibraryEntry,
} from "../../../platform/app/library";
import type { FileRef } from "../../../platform/app/topics";
import { displayFileTitle } from "./file-title";

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/;

// The published date, short and the same in every locale: the ISO date, which is
// also what the page nearly always gave. A value with a date at the front is cut
// there verbatim rather than parsed, so no timezone can move a piece published
// late in the evening onto the next day. Anything else is parsed as a date in
// UTC, and something that is not a date at all is shown as it came: a
// wrong-looking date still says how old the piece is, where a blank says
// nothing (the same call saved-articles.ts makes).
export function formatArticleDate(publishedAt: string | undefined): string {
  const raw = (publishedAt ?? "").trim();
  if (raw === "") return "";
  const iso = ISO_DATE.exec(raw);
  if (iso) return iso[1];
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return raw;
  return at.toISOString().slice(0, 10);
}

// The line under an article's title. Empty when the entry says neither where it
// came from nor when — the row then shows its title alone, which is still a
// document you can open.
export function articleRowLine(entry: LibraryEntry): string {
  return [displaySource(entry.sourceUrl), formatArticleDate(entry.publishedAt)]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
}

// One article row, ready to render.
export interface ArticleRow {
  file: FileRef;
  title: string;
  // The source and date, already joined; "" when the entry knows neither.
  line: string;
}

export interface MaterialSplit {
  // The files that are drawn as cover cards, in the order they came in.
  books: FileRef[];
  articles: ArticleRow[];
}

/**
 * Split a topic's files into the cards and the rows.
 *
 * Both halves keep the order they arrived in, which is the order the shelf has
 * always used (topics.ts sortedFiles: most recently opened first, falling back
 * to when it was added). Articles go after the books rather than being
 * interleaved by date, because the grid and the rows cannot share one sequence —
 * and a section that already puts its rows under its grid is what the shelf
 * looks like today.
 *
 * A file with no book id, or one the registry has never heard of, is a book: an
 * unknown document is drawn the way every document was drawn before articles
 * existed.
 */
export function splitMaterials(
  files: FileRef[],
  entries: Record<string, LibraryEntry>,
): MaterialSplit {
  const books: FileRef[] = [];
  const articles: ArticleRow[] = [];
  for (const file of files) {
    const entry = file.hash ? entries[file.hash] : undefined;
    if (entry && isArticleEntry(entry)) {
      articles.push({ file, title: displayFileTitle(file.name), line: articleRowLine(entry) });
    } else {
      books.push(file);
    }
  }
  return { books, articles };
}
