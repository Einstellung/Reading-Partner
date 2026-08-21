// Figure id semantics: what an id is, how two of them are compared, and how one
// written by the model or a [fig:N] citation is resolved against the index.
// Pure; shared by extract.ts (which mints ids), the view_figure tool, the
// citation grammar (reading/prep/anchors.ts) and the card.
//
// An id is the figure number exactly as the document prints it, minus the label
// and lower-cased: "3", "3a", "3.8", "3-1", "3-1a". It is deliberately not
// canonicalised on the way in — a book that numbers its figures "3-1" should
// show "3-1" in the catalog and in the chip, because that is what the reader
// sees on the page. Matching is where the forms are reconciled: "." and every
// dash fold together, so [fig:3.1] finds the figure printed as "Figure 3-1" and
// the model cannot miss a figure by picking the wrong separator. A translated
// book prints "Figure 3-1" and "图 3-1" over the same picture; both yield the
// id "3-1", so the id is the same whichever caption the extractor reached
// first, and the model writes one [fig:3-1] for either.

import type { Figure } from "./types";

// Separators inside a figure number: ASCII hyphen, the Unicode dashes a
// typesetter may substitute for it, and the dot of a section-numbered book.
const SEP_CLASS = "[.\\-\\u2010-\\u2015\\u2212]";

// The printed number: up to four digit groups joined by a separator, plus an
// optional single-letter panel suffix ("3.8a"). Groups are bounded so a run of
// digits in prose cannot pass for a figure number. Exported as a source string
// because the citation grammar embeds it in a larger pattern.
export const FIGURE_ID_PATTERN = `\\d{1,3}(?:${SEP_CLASS}\\d{1,3}){0,3}[a-z]?`;

// Whether a string is shaped like a figure id at all. Used to gate a citation
// href before it is read back as one.
export const FIGURE_ID_RE = new RegExp(`^${FIGURE_ID_PATTERN}$`, "i");

// The caption label in front of a number, in either language, plus whatever
// punctuation or space separates it from the number.
const LABEL_RE = /^(?:fig(?:ure)?|图表|插图|图)[.:：\s　]*/i;
const SEP_RE = new RegExp(SEP_CLASS, "g");
const TRAILING_PUNCT = new RegExp(`(?:${SEP_CLASS}|[:：\\s　])+$`);

// An id as written, with any label, spacing and trailing punctuation the model
// wrapped it in taken off: "Figure 3.8" / "图 3.8" / " 3.8. " all give "3.8".
export function normalizeFigureId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(LABEL_RE, "")
    .replace(/[\s　]+/g, "")
    .replace(TRAILING_PUNCT, "");
}

// The key two ids are matched on: normalized, with every separator folded to
// ".". "3-1", "3.1" and "3—1" share one canonical form.
export function canonicalFigureId(id: string): string {
  return normalizeFigureId(id).replace(SEP_RE, ".");
}

// Split a canonical id into its numeric groups and its panel letter, so ids sort
// the way a reader reads them: 3.8 before 3.10, 3.8 before 3.8a.
function idParts(id: string): { nums: number[]; suffix: string } {
  const canon = canonicalFigureId(id);
  const m = /^([\d.]*?)([a-z]*)$/.exec(canon);
  const digits = m ? m[1] : canon;
  const suffix = m ? m[2] : "";
  const nums = digits
    .split(".")
    .filter((s) => s !== "")
    .map((s) => Number(s));
  return { nums, suffix };
}

// Order figures by their printed number. Falls back to a plain string compare
// for anything that did not parse as numbers, so the sort is always total.
export function compareFigureIds(a: string, b: string): number {
  const pa = idParts(a);
  const pb = idParts(b);
  if (pa.nums.length === 0 || pb.nums.length === 0) return a.localeCompare(b);
  const n = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < n; i++) {
    const va = pa.nums[i] ?? -1;
    const vb = pb.nums[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  if (pa.suffix !== pb.suffix) return pa.suffix < pb.suffix ? -1 : 1;
  return 0;
}

// Resolve an id as the model or a [fig:N] citation writes it. An exact match on
// the printed form wins; failing that the separators are folded, so a citation
// that picked "." for a book that prints "-" still lands.
export function findFigureById<T extends Pick<Figure, "id">>(
  figures: readonly T[],
  id: string,
): T | null {
  const q = normalizeFigureId(id);
  if (!q) return null;
  const exact = figures.find((f) => f.id === q);
  if (exact) return exact;
  const canon = canonicalFigureId(id);
  return figures.find((f) => canonicalFigureId(f.id) === canon) ?? null;
}
