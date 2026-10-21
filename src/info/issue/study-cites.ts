// How a study's book marks what the reader can tap (docs/info/91 条目格式):
// the section a sentence stands on, and the item a page is about. The book is
// sanitized at build time (workshop/bindery/sanitize.ts), which keeps `id`,
// `class` and a relative `href` and drops every `data-*` attribute, so the
// marks are made of those three. Pure; the reader (slice H) parses with the same
// functions it was written with.
//
//   a cite:   <a class="rp-cite" id="rp-cite-E7-3" href="#rp-cite-M3-2">§3.3</a>
//             the anchor "M3.§2" (material M3 of the study's result file,
//             section 2), the third cite on item E7's page
//   an item:  <div class="rp-study-item" id="rp-item-E7"> around an entry's
//             page, and around each note in the Notes

import type { EntryPartName, EntryParts, EntrySentence } from "../topic-search/result-types";

/** The class of a tappable section reference. */
export const CITE_CLASS = "rp-cite";
/** The class of the block holding one item's page or note. */
export const ITEM_CLASS = "rp-study-item";

const HREF_PREFIX = "#rp-cite-";
const ANCHOR = /^(M\d+)(?:\.§(\d+))?$/;
const HREF = /#rp-cite-(M\d+)(?:-(\d+))?$/;

/** "M3.§2" to "#rp-cite-M3-2", "M3" to "#rp-cite-M3"; null for anything that is not an anchor. */
export function citeHref(anchor: string): string | null {
  const m = ANCHOR.exec(anchor);
  if (!m) return null;
  return `${HREF_PREFIX}${m[1]}${m[2] ? `-${m[2]}` : ""}`;
}

/**
 * The anchor a cite's href names, "M3.§2" (or "M3" for a whole material); null
 * for any other link. Takes the href as written or resolved against the page
 * ("text/section-005.xhtml#rp-cite-M3-2").
 */
export function anchorOfHref(href: string): string | null {
  const m = HREF.exec(href);
  if (!m) return null;
  return m[2] ? `${m[1]}.§${m[2]}` : m[1];
}

/** The id of one cite: the item's id and its place among the cites on that page, from 1. */
export function citeId(itemId: string, n: number): string {
  return `rp-cite-${itemId}-${n}`;
}

/** The id of the block holding an item's page or note: "rp-item-E7". */
export function itemAnchorId(itemId: string): string {
  return `rp-item-${itemId}`;
}

/** The item id an item block's id names; null for any other id. */
export function itemOfAnchorId(id: string): string | null {
  const m = /^rp-item-(E\d+)$/.exec(id);
  return m ? m[1] : null;
}

/** A section heading read from a PDF's text layer (topic-search/verify.ts): no number of its own. */
const PDF_PART = /^PDF part (\d+)$/;
/** "3.3", "3", "A.1", "IV" at the start of a heading, before a space or the end. */
const NUMBERED = /^((?:\d+(?:\.\d+)*)|(?:[A-Z]\.\d+(?:\.\d+)*)|(?:[IVX]+))\.?(?=\s|$)/;
/** Characters of an unnumbered heading kept on a cite. */
const LABEL_CHARS = 24;

/**
 * What a cite says on the page: "§3.3" from a numbered heading; for a PDF read
 * as plain text, `pdfPart(n)` (the book's "part 2"); the heading itself, cut,
 * when it has no number; "§k" when the heading is unknown.
 */
export function citeLabel(heading: string | null | undefined, section: number | null, pdfPart: (n: number) => string, whole: string): string {
  if (section === null) return whole;
  const h = heading?.trim() ?? "";
  const pdf = PDF_PART.exec(h);
  if (pdf) return pdfPart(Number(pdf[1]));
  const numbered = NUMBERED.exec(h);
  if (numbered) return `§${numbered[1]}`;
  if (h) {
    const chars = [...h];
    return chars.length <= LABEL_CHARS ? h : `${chars.slice(0, LABEL_CHARS - 1).join("")}…`;
  }
  return `§${section}`;
}

/** "M3.§2" split: the material and the section (null for a whole material); null when it is not an anchor. */
export function splitAnchor(anchor: string): { material: string; section: number | null } | null {
  const m = ANCHOR.exec(anchor);
  return m ? { material: m[1], section: m[2] ? Number(m[2]) : null } : null;
}

/** "rp-cite-E7-3": the item and the cite's place on its page, from 1; null for any other id. */
export function citeOfId(id: string): { item: string; n: number } | null {
  const m = /^rp-cite-(E\d+)-(\d+)$/.exec(id);
  return m ? { item: m[1], n: Number(m[2]) } : null;
}

/** An entry's sentences in the order its page draws them (render-study.ts partsHtml), which is the order its cites are counted in. */
export function entrySentences(parts: EntryParts): { part: EntryPartName; sentence: EntrySentence }[] {
  const of = (part: EntryPartName, xs: readonly EntrySentence[]) => xs.map((sentence) => ({ part, sentence }));
  return [
    ...of("background", parts.background),
    ...of("prior", parts.prior),
    ...of("gap", parts.gap),
    ...of("method", parts.method.flat()),
    ...of("results", parts.results),
    ...of("helps", parts.relevance.helps),
    ...of("cannot", parts.relevance.cannot),
    ...of("admitted", parts.confidence.admitted),
    ...of("ours", parts.confidence.ours),
  ];
}

/**
 * The sentence the n-th cite on an entry's page belongs to, and the anchor it
 * names. Counted the way the page numbered them: only anchors that make a link.
 */
export function citeAt(parts: EntryParts, n: number): { part: EntryPartName; sentence: EntrySentence; anchor: string } | null {
  let k = 0;
  for (const { part, sentence } of entrySentences(parts)) {
    for (const anchor of sentence.cites) {
      if (citeHref(anchor) === null) continue;
      k++;
      if (k === n) return { part, sentence, anchor };
    }
  }
  return null;
}
