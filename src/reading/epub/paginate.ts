// Cutting a book into pages — what Fulltext.pages[] holds and what [p.N]
// counts. A page is a page: what fits on one sheet of the fixed paper
// (page-geometry.ts) when the spine document is laid out on it (docs/64).
//
// The laying out is not done here. This module takes a ruler — a function that
// says where each page of a document begins — and turns its answers into the
// table: a CFI and a text offset per page, the printed page number the book
// says is there, and the spine count everything was measured against. The real
// ruler is the webview (page-ruler.ts); a test hands in one that cuts by
// character count and the table comes out the same shape.
//
// Cut once and kept. The table is written on the first open and synced between
// devices, and every other device shows the pages it names rather than cutting
// its own (pagination-store.ts). The page numbers it produces are written into
// notes as [p.N] strings that nothing rewrites, so recutting a book moves all
// of them at once.

import { elementSteps, epubCfi, parseEpubCfi, pointSteps, resolvePoint, textSteps } from "./cfi";
import type { NavEntry } from "./nav";
import { PAGE_GEOMETRY, type PageGeometry } from "./page-geometry";
import type { EpubBook, SpineDocument } from "./parse";
import { indexRuns, offsetOfPoint, runAt } from "./text";

// Version 2 is the laid-out page. Version 1 cut 1800 characters a block and is
// read as absent: a book that has one is cut again, the one time a table is
// ever replaced, and its marks are moved by their CFIs (migrate.ts).
export const PAGINATION_VERSION = 2 as const;

export type PaginationSource = "layout";

/** One page's start. The page runs to the next one's start, or to the end of its document. */
export interface PositionBlock {
  /** Spine index of the document the page is in. A page never spans two. */
  spine: number;
  /** Offset into that document's extracted text (text.ts). */
  charOffset: number;
  /** Where the page's text ends, in the same offsets. */
  endOffset: number;
  /** The start as a CFI, for the reading line to show and navigate to. */
  cfi: string;
  /** The page number the paper edition printed here, when the book says. */
  label: string | null;
}

export interface Pagination {
  version: typeof PAGINATION_VERSION;
  kind: "epub";
  source: PaginationSource;
  /** The paper the pages were laid out on. */
  geometry: PageGeometry;
  /** Spine length the offsets were computed against. */
  spineCount: number;
  blocks: PositionBlock[];
}

/** Where a page begins in a laid-out document: a text node and offset, or an element. */
export interface PagePoint {
  node: Node;
  offset: number | null;
}

/**
 * What lays a document out on the paper and reports where each page begins.
 * The first point is the document's start; a document that fits on one page
 * reports one point. An empty answer is read as one page.
 */
export type PageRuler = (doc: SpineDocument) => Promise<PagePoint[]>;

function localOf(doc: SpineDocument, offset: number): string {
  const run = runAt(doc.text.runs, offset);
  const local = run ? textSteps(run.node, run.offset) : null;
  if (local) return local;
  // A document with no text at all: address its root element instead, which is
  // still a place the renderer can scroll to.
  const body = doc.doc.getElementsByTagName("body")[0];
  const steps = body ? elementSteps(body) : null;
  return steps ?? "/4";
}

interface Cut {
  offset: number;
  local: string;
}

// A ruler's points, as offsets and local CFIs, in order and without repeats.
// A point on an element is a page that begins at a picture or a rule; its CFI
// names the element and its offset is where the element's text would start.
//
// The ruler's nodes belong to whatever tree it laid out — the webview's clone,
// not the parsed document the offsets are counted on — so a point goes through
// its CFI: steps off the ruler's node, resolved back on the parsed tree, and
// only then an offset (docs/pitfall/267).
function cutsOf(doc: SpineDocument, points: PagePoint[]): Cut[] {
  const runs = indexRuns(doc.text);
  const cuts: Cut[] = [];
  const root = doc.doc.documentElement;
  for (const point of points) {
    const local = pointSteps(point.node, point.offset) ?? localOf(doc, 0);
    const parsed = parseEpubCfi(epubCfi(doc.index, doc.idref, local));
    const own = parsed ? resolvePoint(root, parsed) : null;
    const offset = own ? offsetOfPoint(doc.text, runs, own.node, own.offset) : 0;
    const last = cuts[cuts.length - 1];
    if (last && (offset < last.offset || (offset === last.offset && local === last.local))) continue;
    cuts.push({ offset, local });
  }
  if (cuts.length === 0 || cuts[0].offset !== 0) cuts.unshift({ offset: 0, local: localOf(doc, 0) });
  return cuts;
}

/**
 * The book's pages. Written once per book and then read forever: the caller
 * persists this and never asks for it again (pagination-store.ts).
 */
export async function paginate(book: EpubBook, ruler: PageRuler): Promise<Pagination> {
  const blocks: PositionBlock[] = [];
  for (const doc of book.docs) {
    const cuts = cutsOf(doc, await ruler(doc));
    for (let i = 0; i < cuts.length; i++) {
      const next = cuts[i + 1];
      blocks.push({
        spine: doc.index,
        charOffset: cuts[i].offset,
        endOffset: next ? next.offset : doc.text.text.length,
        cfi: epubCfi(doc.index, doc.idref, cuts[i].local),
        label: null,
      });
    }
  }
  labelPages(book, blocks);
  return {
    version: PAGINATION_VERSION,
    kind: "epub",
    source: "layout",
    geometry: { ...PAGE_GEOMETRY },
    spineCount: book.docs.length,
    blocks,
  };
}

// The printed page numbers, laid over our pages: a page shows the number of
// the printed page it begins in. A page-list entry counts only when its
// fragment names an element the sanitized tree still has, and two is the least
// that says the book really carries printed numbers; one is a stray link.
function labelPages(book: EpubBook, blocks: PositionBlock[]): void {
  const byEntry = new Map(book.docs.map((d) => [d.entry, d]));
  const marks: Array<{ spine: number; offset: number; label: string }> = [];
  for (const item of book.nav.pageList as NavEntry[]) {
    const doc = byEntry.get(item.entry);
    if (!doc || !item.title) continue;
    let offset = 0;
    if (item.fragment !== null) {
      const el = doc.text.ids.get(item.fragment);
      if (el === undefined) continue;
      offset = doc.text.offsets.get(el) ?? 0;
    }
    marks.push({ spine: doc.index, offset, label: item.title });
  }
  if (marks.length < 2) return;
  marks.sort((a, b) => a.spine - b.spine || a.offset - b.offset);
  let at = 0;
  for (const block of blocks) {
    while (
      at + 1 < marks.length &&
      (marks[at + 1].spine < block.spine ||
        (marks[at + 1].spine === block.spine && marks[at + 1].offset <= block.charOffset))
    ) {
      at++;
    }
    const mark = marks[at];
    const before = mark.spine < block.spine || (mark.spine === block.spine && mark.offset <= block.charOffset);
    block.label = before ? mark.label : null;
  }
}

/**
 * The text of each page, sliced out of the spine documents the same table was
 * cut from. Derived — this is what makes the table the only thing that has to
 * be kept.
 */
export function blockTexts(book: EpubBook, pagination: Pagination): string[] {
  return pagination.blocks.map((block) => {
    const doc = book.docs[block.spine];
    if (!doc) return "";
    return doc.text.text.slice(block.charOffset, block.endOffset);
  });
}

/**
 * The page a point in the book falls in, 1-based — the page number every
 * existing reading path already speaks (fulltext, [p.N], chapter ranges).
 */
export function blockNumberAt(pagination: Pagination, spine: number, charOffset: number): number {
  const { blocks } = pagination;
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const b = blocks[mid];
    if (b.spine < spine || (b.spine === spine && b.charOffset <= charOffset)) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * A ruler that cuts by character count, for tests and for a table of a book no
 * webview has laid out yet. Cuts snap back to a line break within a tenth of a
 * page so a page never starts mid-word in ordinary prose.
 */
export function characterRuler(charsPerPage: number): PageRuler {
  const window = Math.max(1, Math.floor(charsPerPage / 10));
  return async (doc) => {
    const text = doc.text.text;
    const points: PagePoint[] = [];
    let at = 0;
    while (text.length - at > charsPerPage) {
      const target = at + charsPerPage;
      const back = text.lastIndexOf("\n", target - 1);
      const cut = back > target - window && back > at ? back + 1 : target;
      const run = runAt(doc.text.runs, cut);
      if (!run) break;
      points.push({ node: run.node, offset: run.offset });
      at = cut;
    }
    return points;
  };
}
