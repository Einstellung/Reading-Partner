// The shelf, minus React: how wide the grid is at a given viewport, the order
// the cards come in, which covers a card shows, and the labels under them. None
// of it depends on the DOM, so the phone form factor can render the same shelf
// differently without re-deriving any of it (CLAUDE.md).
//
// Both library screens use this: a topic card shows the book it was last read
// against with the others as page edges beside it, a file card shows its own
// book, and the numbers come from here either way.

import { sortedFiles, type FileRef, type Topic } from "../../../platform/app/topics";

// The grid's one source of truth. The class names are literal because Tailwind
// finds classes by scanning source text: a name built at runtime is a name that
// never gets generated. `columns` is the same decision written as a number, so
// the breakpoints can be asserted rather than eyeballed.
export interface GridStep {
  // Viewport width, in CSS pixels, from which this step applies.
  minWidth: number;
  columns: number;
  className: string;
}

// A cover is the whole card, so a column is only as wide as it needs to be for
// a cover to be legible — around 240px, which is three across an iPad in
// portrait and four in landscape. The screen is a shelf: several rows of books
// at once, not a row and a half of framed pictures.
export const TOPIC_GRID_STEPS: readonly GridStep[] = [
  { minWidth: 0, columns: 2, className: "grid-cols-2" },
  { minWidth: 768, columns: 3, className: "md:grid-cols-3" },
  { minWidth: 1024, columns: 4, className: "lg:grid-cols-4" },
  { minWidth: 1280, columns: 5, className: "xl:grid-cols-5" },
];

export const TOPIC_GRID_COLUMNS_CLASS = TOPIC_GRID_STEPS.map((s) => s.className).join(" ");

// Newest topic first, the order listTopics already returns them in, restated
// here so the screen does not depend on who loaded the list. Name breaks a tie
// (two topics created in the same millisecond by an import).
export function shelfOrder(topics: Topic[]): Topic[] {
  return [...topics].sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
}

// How many books a topic card shows at once. Four is what a 2x2 of legible
// covers holds; the label says how many the topic actually has.
export const MAX_COVERS = 4;

// The shape of every cover box on both screens, width over height. One number
// for the whole page, not each book's own shape: cards of different heights in
// one row are a saw edge, and a shelf of books that do not line up is worse than
// a book cropped by a few percent. 3:4 sits just below a US Letter page (0.77)
// and just above a trade paperback (0.66), so most covers lose very little.
//
// What is cropped is the bottom (`object-top` at the call site): a title and an
// author are in the upper half of a cover, and a landscape first page — a slide
// deck — loses a lot, which is the price of the row lining up.
export const COVER_ASPECT = 3 / 4;

// The cover box is split into cells and every cell holds a whole cover. A
// spine showing a few percent of its edge said only "there are more"; four
// covers you can recognise say which books they are, and that is the same
// glance. The layouts leave no empty cell — a 2x2 with a hole in it reads as
// unfinished — so three books are a tall cover beside two half ones.
//
// Cells are grid placements rather than percentages: the browser divides the
// box, and the 1px seams between cells come from the grid's own gap.
export interface CoverTile {
  file: FileRef;
  // 1-based, in the CSS grid sense.
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

// The grid a given number of covers is laid into, as CSS track lists.
export function coverGridTemplate(count: number): { columns: string; rows: string } {
  if (count <= 1) return { columns: "1fr", rows: "1fr" };
  if (count === 2) return { columns: "1fr 1fr", rows: "1fr" };
  return { columns: "1fr 1fr", rows: "1fr 1fr" };
}

// Where each cover goes, most recently read first: the biggest cell, then left
// to right and top to bottom.
const LAYOUTS: Record<number, Array<Omit<CoverTile, "file">>> = {
  1: [{ column: 1, row: 1, columnSpan: 1, rowSpan: 1 }],
  2: [
    { column: 1, row: 1, columnSpan: 1, rowSpan: 1 },
    { column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
  ],
  3: [
    { column: 1, row: 1, columnSpan: 1, rowSpan: 2 },
    { column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
    { column: 2, row: 2, columnSpan: 1, rowSpan: 1 },
  ],
  4: [
    { column: 1, row: 1, columnSpan: 1, rowSpan: 1 },
    { column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
    { column: 1, row: 2, columnSpan: 1, rowSpan: 1 },
    { column: 2, row: 2, columnSpan: 1, rowSpan: 1 },
  ],
};

export function coverTiles(topic: Topic): CoverTile[] {
  // Most recently read first: the card shows what the topic is currently
  // about, not what was added to it first.
  return tile(sortedFiles(topic).slice(0, MAX_COVERS));
}

// A screen that shows one book per card: the same cover, filling the box.
export function singleCoverTile(file: FileRef): CoverTile[] {
  return tile([file]);
}

function tile(files: FileRef[]): CoverTile[] {
  const layout = LAYOUTS[files.length];
  if (!layout) return [];
  return files.map((file, i) => ({ file, ...layout[i] }));
}

// One tile's placement, as inline style.
export function tileStyle(tile: CoverTile): { gridColumn: string; gridRow: string } {
  return {
    gridColumn: `${tile.column} / span ${tile.columnSpan}`,
    gridRow: `${tile.row} / span ${tile.rowSpan}`,
  };
}

export function fileCountLabel(count: number): string {
  if (count === 0) return "No files";
  return `${count} file${count === 1 ? "" : "s"}`;
}

// What a cover with no image shows. The extension is dropped because every file
// here is a PDF and "P" on every spine says nothing; the first character is
// taken by code point so a CJK title or an emoji survives, and uppercased only
// where a case exists.
export function coverInitial(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]+$/, "").trim();
  const first = [...stem][0];
  return first ? first.toUpperCase() : "?";
}
