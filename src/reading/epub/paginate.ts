// Cutting a book into position blocks — what Fulltext.pages[] holds and what
// [p.N] counts (docs/39 §1). Two ways, in this order:
//
//   page-list   the printed edition's own page numbers, taken from the
//               navigation document's page-list and the epub:type="pagebreak"
//               anchors it points at. A book made from paper has them, and then
//               a page number in a note means the page in the paper book.
//   synthetic   a fixed number of characters per block, for a book that was
//               never paper.
//
// BLOCK_CHARS is 1800 and it may not be changed. It is not a tuning knob: the
// page numbers it produces are written into notes, chapter files and prep
// documents as [p.N] strings, and nothing ever rewrites those (docs/39 §1). A
// different number silently moves every one of them to a different place in the
// book. The same reason is why the pagination is stored once per book and never
// recomputed, and why it lives in its own file rather than inside the derived
// fulltext cache.
//
// 1800 is Zotero's number. epub.js uses 1600. Either would have done; what
// mattered was picking one and writing down that it is now fixed.
export const BLOCK_CHARS = 1800;

// How far back from a cut the search for a line break may go before giving up
// and cutting mid-word. A tenth of a block: far enough to land on a paragraph
// boundary in ordinary prose, short enough that a block is never much smaller
// than the others.
const SNAP_WINDOW = 180;

import { elementSteps, epubCfi, textSteps } from "./cfi";
import type { NavEntry } from "./nav";
import type { EpubBook, SpineDocument } from "./parse";
import { runAt } from "./text";

export const PAGINATION_VERSION = 1 as const;

export type PaginationSource = "page-list" | "synthetic";

/** One position block's start. The block runs to the next one's start. */
export interface PositionBlock {
  /** Spine index of the document the block starts in. */
  spine: number;
  /** Offset into that document's extracted text (text.ts). */
  charOffset: number;
  /** The start as a CFI, for the reading line to navigate to. */
  cfi: string;
  /** The page number the paper edition printed here, when the book says. */
  label: string | null;
}

export interface Pagination {
  version: typeof PAGINATION_VERSION;
  kind: "epub";
  source: PaginationSource;
  /** The constant in force when this table was written. */
  blockChars: number;
  /** Spine length the offsets were computed against. */
  spineCount: number;
  blocks: PositionBlock[];
}

function locate(doc: SpineDocument, idref: string, offset: number): string {
  const run = runAt(doc.text.runs, offset);
  const local = run ? textSteps(run.node, run.offset) : null;
  if (local) return epubCfi(doc.index, idref, local);
  // A document with no text at all: address its root element instead, which is
  // still a place the renderer can scroll to.
  const body = doc.doc.getElementsByTagName("body")[0];
  const steps = body ? elementSteps(body) : null;
  return epubCfi(doc.index, idref, steps ?? "/4");
}

/** Cut one document's text into fixed-size blocks, snapping to a line break. */
export function syntheticCuts(text: string): number[] {
  if (text.trim() === "") return [];
  const cuts = [0];
  let at = 0;
  while (text.length - at > BLOCK_CHARS) {
    const target = at + BLOCK_CHARS;
    const back = text.lastIndexOf("\n", target);
    const cut = back > target - SNAP_WINDOW && back > at ? back + 1 : target;
    cuts.push(cut);
    at = cut;
  }
  return cuts;
}

function syntheticPagination(book: EpubBook): Pagination {
  const blocks: PositionBlock[] = [];
  for (const doc of book.docs) {
    for (const offset of syntheticCuts(doc.text.text)) {
      blocks.push({
        spine: doc.index,
        charOffset: offset,
        cfi: locate(doc, doc.idref, offset),
        label: null,
      });
    }
  }
  // A book whose every spine document is empty still gets one block, so
  // pages[] is never zero-length and every page number in the app is in range.
  if (blocks.length === 0) {
    const first = book.docs[0];
    blocks.push({ spine: 0, charOffset: 0, cfi: locate(first, first.idref, 0), label: null });
  }
  return {
    version: PAGINATION_VERSION,
    kind: "epub",
    source: "synthetic",
    blockChars: BLOCK_CHARS,
    spineCount: book.docs.length,
    blocks,
  };
}

// A page-list entry becomes a cut only when its fragment names an element the
// sanitized tree still has. An entry that resolves to nothing is dropped rather
// than guessed at: a page boundary in the wrong place is worse than one page
// fewer, because it moves every [p.N] after it.
function pageListCuts(book: EpubBook, pageList: NavEntry[]): PositionBlock[] {
  const byEntry = new Map(book.docs.map((d) => [d.entry, d]));
  const blocks: PositionBlock[] = [];
  for (const item of pageList) {
    const doc = byEntry.get(item.entry);
    if (!doc) continue;
    let offset = 0;
    if (item.fragment !== null) {
      const el = doc.text.ids.get(item.fragment);
      if (el === undefined) continue;
      offset = doc.text.offsets.get(el) ?? 0;
    }
    blocks.push({
      spine: doc.index,
      charOffset: offset,
      cfi: locate(doc, doc.idref, offset),
      label: item.title || null,
    });
  }
  blocks.sort((a, b) => a.spine - b.spine || a.charOffset - b.charOffset);
  // The front matter before the first numbered page is a block of its own, with
  // no printed number to give it.
  const first = blocks[0];
  if (first && (first.spine > 0 || first.charOffset > 0)) {
    const doc = book.docs[0];
    blocks.unshift({ spine: 0, charOffset: 0, cfi: locate(doc, doc.idref, 0), label: null });
  }
  return blocks;
}

/**
 * The book's position blocks. Written once per book and then read forever: the
 * caller persists this and never asks for it again (pagination-store.ts).
 */
export function paginate(book: EpubBook): Pagination {
  const cuts = pageListCuts(book, book.nav.pageList);
  // Two anchors is the least that says the book really carries printed page
  // numbers; one is a stray link.
  if (cuts.length < 2) return syntheticPagination(book);
  return {
    version: PAGINATION_VERSION,
    kind: "epub",
    source: "page-list",
    blockChars: BLOCK_CHARS,
    spineCount: book.docs.length,
    blocks: cuts,
  };
}

/**
 * The text of each position block, sliced out of the spine documents the same
 * table was cut from. Derived — this is what makes the table the only thing
 * that has to be kept.
 */
export function blockTexts(book: EpubBook, pagination: Pagination): string[] {
  const out: string[] = [];
  const { blocks } = pagination;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];
    let text = "";
    for (let s = block.spine; s <= (next ? next.spine : book.docs.length - 1); s++) {
      const doc = book.docs[s];
      if (!doc) break;
      const from = s === block.spine ? block.charOffset : 0;
      const to = next && s === next.spine ? next.charOffset : doc.text.text.length;
      if (to <= from) continue;
      text += (text === "" ? "" : "\n") + doc.text.text.slice(from, to);
    }
    out.push(text);
  }
  return out;
}

/**
 * The position block a point in the book falls in, 1-based — the page number
 * every existing reading path already speaks (fulltext, [p.N], chapter ranges).
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
