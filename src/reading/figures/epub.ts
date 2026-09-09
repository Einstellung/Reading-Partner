// The figure index of an EPUB. Where the PDF extractor spends 638 lines putting
// back geometry the format never stated — CTM stacks, noise filtering, union-find
// clustering, caption pairing across columns — a book that was authored as HTML
// says all of it outright: <img> is the picture, <figcaption> is the caption
// (docs/39 §3). None of that machinery is reachable from here and none of it is
// wanted.
//
// This lives under figures/ rather than under epub/, and the direction is the
// point: figures reads reading/epub, reading/epub never reads figures, so the
// two never close a cycle.

import { blockNumberAt, type Pagination } from "../epub/paginate";
import type { EpubBook, SpineDocument } from "../epub/parse";
import { SVG_NS, XLINK_NS } from "../epub/sanitize";
import { resolveZipPath } from "../epub/zip";
import { figureCaptionId } from "./extract";
import { canonicalFigureId, compareFigureIds } from "./lookup";
import { FIGURES_VERSION, type CaptionSource, type Figure, type FiguresIndex } from "./types";

// A paragraph next to a picture is only read as its caption when it is short.
// A caption is a line; the first paragraph of the section is not one, and taking
// it would put a page of prose where the AI expects a label.
const NEARBY_MAX_CHARS = 200;

const BLOCK_SIBLINGS = new Set(["p", "div", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6"]);

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function closestFigure(el: Element): Element | null {
  let node: Element | null = el;
  while (node) {
    if (node.localName.toLowerCase() === "figure") return node;
    node = node.parentElement;
  }
  return null;
}

// The rung of the ladder a caption came off, and its text (docs/39 §3). The
// vision-model rung is stage 5's; nothing here calls a model.
export function captionFor(el: Element): { caption: string; source: CaptionSource } {
  const figure = closestFigure(el);
  if (figure) {
    const cap = textOf(figure.getElementsByTagName("figcaption")[0]);
    if (cap) return { caption: cap, source: "figcaption" };
  }
  const alt = (el.getAttribute("alt") ?? "").trim();
  if (alt) return { caption: alt, source: "alt" };
  const aria = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "").trim();
  if (aria) return { caption: aria, source: "aria" };

  // The paragraph right after the picture's own block, then the one right
  // before it: a caption printed as body text sits on one side or the other.
  const anchor = figure ?? el.parentElement ?? el;
  for (const sibling of [anchor.nextElementSibling, anchor.previousElementSibling]) {
    if (!sibling) continue;
    if (!BLOCK_SIBLINGS.has(sibling.localName.toLowerCase())) continue;
    const text = textOf(sibling);
    if (text && text.length <= NEARBY_MAX_CHARS) return { caption: text, source: "nearby" };
  }
  return { caption: "", source: "none" };
}

/** The archive entry a picture element points at, or null when it points nowhere. */
export function figureHref(el: Element, entryPath: string): string | null {
  const raw =
    el.getAttributeNS(XLINK_NS, "href") ??
    el.getAttribute("xlink:href") ??
    el.getAttribute("src") ??
    el.getAttribute("href");
  if (!raw || raw.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // an absolute URL is not in the book
  return resolveZipPath(entryPath, raw);
}

function pictures(doc: SpineDocument): Element[] {
  const out: Element[] = [];
  for (const img of Array.from(doc.doc.getElementsByTagName("img"))) out.push(img);
  for (const image of Array.from(doc.doc.getElementsByTagNameNS(SVG_NS, "image"))) out.push(image);
  // Document order, so a book's figures are numbered the way they are read.
  out.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & 4 /* FOLLOWING */) return -1;
    if (pos & 2 /* PRECEDING */) return 1;
    return 0;
  });
  return out;
}

/**
 * Build the figure index. Ids come off the caption when the book printed one
 * ("Figure 3", "图 3-1"), so [fig:3] means the same thing it does in a PDF of
 * the same edition; a picture whose caption carries no number is given
 * "c<spine>-<n>", which normalizeFigureId passes through untouched and which
 * cannot collide with a printed number (docs/39 §3).
 */
export function epubFigures(book: EpubBook, pagination: Pagination): FiguresIndex {
  const byId = new Map<string, Figure>();
  const figures: Figure[] = [];
  for (const doc of book.docs) {
    let unnumbered = 0;
    for (const el of pictures(doc)) {
      const href = figureHref(el, doc.entry);
      if (!href || !book.zip.has(href)) continue;
      const { caption, source } = captionFor(el);
      const printed = caption ? figureCaptionId(caption) : null;
      const id = printed ?? `c${doc.index + 1}-${++unnumbered}`;
      const key = canonicalFigureId(id);
      if (byId.has(key)) continue; // the same picture captioned twice (a bilingual edition)
      const offset = doc.text.offsets.get(el) ?? 0;
      const figure: Figure = {
        id,
        page: blockNumberAt(pagination, doc.index, offset),
        caption,
        source: { kind: "epub", href },
        captionSource: source,
      };
      byId.set(key, figure);
      figures.push(figure);
    }
  }
  figures.sort((a, b) => a.page - b.page || compareFigureIds(a.id, b.id));
  return { version: FIGURES_VERSION, status: "ok", figures };
}
