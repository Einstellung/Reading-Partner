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

// The line under a book's title. Where the reader is and what they have marked;
// no timestamp, which says nothing about a book that a page number does not.
// Empty for a book that was never opened, which renders as no line at all.
export function readingLabel(meta: BookMeta | undefined): string {
  const parts: string[] = [];
  if (meta?.page) {
    parts.push(meta.pages ? `Page ${meta.page} of ${meta.pages}` : `Page ${meta.page}`);
  }
  if (meta?.marks) parts.push(plural(meta.marks, "mark"));
  return parts.join(" · ");
}

// How far in, 0 to 1, for the bar under the cover. Null when either end of the
// fraction is unknown, which is what a book that was never opened looks like.
// Clamped: a stale reading position in a re-imported, shorter file must not
// draw a bar past the end of the card.
export function readingProgress(meta: BookMeta | undefined): number | null {
  if (!meta?.page || !meta.pages) return null;
  return Math.min(1, Math.max(0, meta.page / meta.pages));
}
