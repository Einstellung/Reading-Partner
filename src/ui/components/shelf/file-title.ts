// What a book is called on screen, and what is known about reading it.
//
// The title is derived, never stored: FileRef.name stays the name on disk, so a
// file can always be traced back to the thing it came from. Only the display
// goes through here.

// Per-book reading state. `page`/`pages` are absent until the book has been
// opened at least once (no reading position, no full-text cache).
export interface BookMeta {
  page?: number; // 1-based
  pages?: number;
  marks: number;
}

const BRACKET_GROUP = /[([{【（][^([{【（)\]}】）]*[)\]}】）]/g;

// A bare host name. The suffix list is deliberate rather than a catch-all
// `\.\w{2,}`: "Node.js in Action" and "vol.2" are titles, not sources.
const DOMAIN =
  /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|co|uk|us|ru|sk|se|pl|it|de|fr|es|nl|cz|to|cc|me|tv|fm|la|st|is|in|info|biz|xyz|site|club|onion|cn|jp)\b/i;

// The shadow-library brands, which do not always come with a suffix. Each one
// needs something more than "lib" in it: a book can be called "Standard Lib".
const KNOWN_SOURCE =
  /\b(?:z-?lib(?:rary)?|\d+lib|libgen|b-?ok|sci-?hub|anna'?s[- ]?archive|torrent)\b/i;

const URLISH = /(?:https?:\/\/|www\.)/i;

// Separators a stripped fragment leaves behind at either end.
const EDGE_JUNK = /^[\s\-–—_·,;:.|]+|[\s\-–—_·,;:.|]+$/g;

function looksLikeSource(text: string): boolean {
  return URLISH.test(text) || DOMAIN.test(text) || KNOWN_SOURCE.test(text);
}

// The name a book is shown under: the file name with its extension gone and any
// bracketed group that is a download site's calling card removed. Other groups
// stay — "(麦克斯·班尼特)" is the author, and dropping every bracket would take
// the author with the pirate.
//
// Falls back to the original name rather than ever rendering an empty string: a
// file called "(z-lib.org).pdf" has nothing left after cleaning, and a nameless
// card is worse than an ugly one.
export function displayFileTitle(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "");
  const withoutSourceGroups = withoutExtension.replace(BRACKET_GROUP, (group) =>
    looksLikeSource(group) ? " " : group,
  );
  // A source can also sit loose in the name ("Deep Learning - z-lib.org").
  const withoutSourceWords = withoutSourceGroups
    .split(/\s+/)
    .filter((word) => !looksLikeSource(word))
    .join(" ");
  const cleaned = withoutSourceWords.replace(EDGE_JUNK, "").replace(/\s{2,}/g, " ");
  return cleaned || fileName;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// The line under a book's title. How far in and what has been marked; no
// timestamp, which says nothing a percentage does not. A percentage rather than
// a page number because it is the same size for every book, and the bar under
// the card is already drawing it.
//
// A page reached in a book of unknown length falls back to the page number: the
// length comes from the full-text cache, which a book being read for the first
// time may not have yet.
export function readingLabel(meta: BookMeta | undefined): string {
  const parts: string[] = [];
  const progress = readingProgress(meta);
  if (progress !== null) {
    // Never "Read 0%": a reader who has opened a book has read some of it, and
    // a first page out of four hundred rounds to nothing.
    parts.push(`Read ${Math.max(1, Math.round(progress * 100))}%`);
  } else if (meta?.page) {
    parts.push(`Page ${meta.page}`);
  }
  if (meta?.marks) parts.push(plural(meta.marks, "mark"));
  // Said out loud rather than left blank: an empty line under a title reads as
  // something that failed to load.
  return parts.length ? parts.join(" · ") : "Not opened yet";
}

// How far in, 0 to 1, for the bar under the cover. Null when either end of the
// fraction is unknown, which is what a book that was never opened looks like.
// Clamped: a stale reading position in a re-imported, shorter file must not
// draw a bar past the end of the card.
export function readingProgress(meta: BookMeta | undefined): number | null {
  if (!meta?.page || !meta.pages) return null;
  return Math.min(1, Math.max(0, meta.page / meta.pages));
}
