// What the reader's top bar prints where the reader is in the book.
//
// The block number stays the primary one: it is the coordinate citations,
// marks and notes use (docs/64, docs/39). A book that prints its own page
// numbers adds them beside it, quietly — they are what the reader would say
// out loud, but not what the app stores.

import type { ViewStats } from "../../../platform/app/reader-contract";
import type { Translate } from "../../../i18n";

export interface ReaderPageText {
  // "37 / 385", or the em-dashes before a book is open.
  blocks: string;
  // "printed 52", or null when the book prints no number on this page.
  printed: string | null;
}

export function readerPageText(stats: ViewStats | null, t: Translate): ReaderPageText {
  if (!stats) return { blocks: "— / —", printed: null };
  const printed = stats.printedLabel;
  return {
    blocks: t("reader.page.blocks", { index: stats.pageIndex + 1, count: stats.pagesCount }),
    printed: printed ? t("reader.page.printed", { label: printed }) : null,
  };
}
