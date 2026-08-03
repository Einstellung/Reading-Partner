// The shelf, minus React: how wide the grid is at a given viewport, the order
// the cards come in, how big a cover is and where it sits, and the labels a
// card carries. None of it depends on the DOM, so the phone form factor can
// render the same shelf differently without re-deriving any of it (CLAUDE.md).
//
// Both library screens use this: the topics grid stacks up to three covers per
// card, the files inside a topic show one each, and the numbers come from here
// either way.

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

// Column counts are set by how big a cover has to be to be read as a cover, not
// by how much width there is to fill: two on iPad portrait (820, a ~300px
// cover), three on landscape (1180), four before a desktop window makes the
// cards absurd. Two is also the floor — one column is the list this replaced.
export const TOPIC_GRID_STEPS: readonly GridStep[] = [
  { minWidth: 0, columns: 2, className: "grid-cols-2" },
  { minWidth: 1024, columns: 3, className: "lg:grid-cols-3" },
  { minWidth: 1280, columns: 4, className: "xl:grid-cols-4" },
];

export const TOPIC_GRID_COLUMNS_CLASS = TOPIC_GRID_STEPS.map((s) => s.className).join(" ");

export function topicGridColumns(width: number): number {
  let columns = TOPIC_GRID_STEPS[0].columns;
  for (const step of TOPIC_GRID_STEPS) {
    if (width >= step.minWidth) columns = step.columns;
  }
  return columns;
}

// Newest topic first, the order listTopics already returns them in, restated
// here so the screen does not depend on who loaded the list. Name breaks a tie
// (two topics created in the same millisecond by an import).
export function shelfOrder(topics: Topic[]): Topic[] {
  return [...topics].sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
}

export const MAX_COVERS = 3;

// The shape of a cover's box, width over height. A trade paperback is about
// 0.66 and a US Letter page 0.77, so this sits between them; the image inside
// is contained rather than cropped, which is what keeps a book whose first page
// is a different shape from losing its bottom line of type. What varies per
// book is how much of the box it fills, never how much of it survives.
export const COVER_ASPECT = 0.72;

// One cover in a stack. Everything is a percentage of the band's inner box, not
// of the card: the card grows with the column count and the covers grow with it.
//
// Size is given as a height, because that is what a shelf holds constant — books
// standing next to each other are as tall as each other whatever shape they are,
// and the width follows from the book. Position is given per anchor: a lone
// cover is centred, so it sits in the middle of the card whatever its shape; a
// stack is anchored by left edges, which is the only arrangement where a cover
// behind is guaranteed to show a strip of itself no matter how much narrower
// than the one in front it turns out to be.
export interface CoverSlot {
  file: FileRef;
  anchor: "centre" | "left";
  // The centre, or the left edge, depending on the anchor.
  leftPercent: number;
  heightPercent: number;
  // What a landscape first page — a slide deck — is allowed to grow to before
  // it is capped and shortened instead of running out of the card.
  maxWidthPercent: number;
  // Each cover is in front of the one to its left, so the stack fans the way a
  // row of leaning books does and the last one — the most recently read — is a
  // whole cover rather than a strip.
  z: number;
}

// The band's inner box is this many times taller than it is wide: it is 4:5 with
// a 4-unit inset at the top and none at the bottom, which lands between 1.32 and
// 1.35 across the card widths this grid produces. It is what converts a height
// into a width, and being 2% out only moves an edge by a pixel or two.
const INNER_RATIO = 1.33;

// Cover height, per stack size, as a percentage of the band's inner height. A
// stack is a little shorter than a lone book so that the strips behind it have
// somewhere to be; the three numbers are close together on purpose, so that a
// card with one book and a card with three do not look like different screens.
const HEIGHT_PERCENT: Record<number, number> = { 1: 90, 2: 86, 3: 80 };

// How far apart two neighbouring left edges are, which is exactly how much of
// the cover behind stays visible.
const STEP_PERCENT: Record<number, number> = { 1: 0, 2: 14, 3: 10 };

// The most of the band's width a whole stack may take, which is what the two
// tables above are chosen against: a stack always has a margin either side.
export const MAX_SPAN_PERCENT = 98;

// The outline a topic with no files shows. Smaller than a real cover: it is a
// space for a book, not a book.
export const EMPTY_SLOT_WIDTH_PERCENT = 60;

export function coverSlots(topic: Topic): CoverSlot[] {
  // The three most recently read books — the shelf shows what the topic is
  // currently about, not what was added to it first — laid out oldest first, so
  // that the most recent one ends up on the right, in front and whole.
  return layout(sortedFiles(topic).slice(0, MAX_COVERS).reverse());
}

// The same box for a screen that shows one book per card. It goes through the
// same layout so a single cover is the same size on both screens.
export function singleCoverSlot(file: FileRef): CoverSlot[] {
  return layout([file]);
}

function layout(files: FileRef[]): CoverSlot[] {
  const count = files.length;
  const height = HEIGHT_PERCENT[count] ?? 0;
  const step = STEP_PERCENT[count] ?? 0;
  // What a book-shaped cover of this height would be wide. It is also the cap:
  // no cover is ever wider than a book, so a landscape deck behind a book stays
  // behind it instead of sticking out past its edge.
  const nominalWidth = height * INNER_RATIO * COVER_ASPECT;
  if (count === 1) {
    return [
      {
        file: files[0],
        anchor: "centre",
        leftPercent: 50,
        heightPercent: height,
        maxWidthPercent: nominalWidth,
        z: 1,
      },
    ];
  }
  // The stack is centred as a group, at that nominal width: the first left edge
  // is wherever that leaves it.
  const base = Math.max(0, (100 - (nominalWidth + (count - 1) * step)) / 2);
  return files.map((file, i) => ({
    file,
    anchor: "left",
    leftPercent: base + i * step,
    heightPercent: height,
    maxWidthPercent: nominalWidth,
    z: i + 1,
  }));
}

// Where one cover's box goes, as inline style. Both edges are worked out here
// rather than left to `aspect-ratio`, because the box has to be exactly the
// artwork: the hairline edge and the shadow are what make a white first page
// visible on a white card, and a frame with air in it would show that air.
//
// `ratio` is the image's own width over height, known once it has loaded; until
// then a book-shaped guess stands in. A cover wider than its slot allows — a
// landscape slide deck — is capped by width and gets shorter, which is what a
// wide flat thing on a shelf looks like anyway.
export function coverBox(
  slot: CoverSlot,
  ratio: number | undefined,
): { left: string; width: string; height: string; zIndex: number } {
  const shape = ratio && ratio > 0 ? ratio : COVER_ASPECT;
  let height = slot.heightPercent;
  let width = height * INNER_RATIO * shape;
  if (width > slot.maxWidthPercent) {
    width = slot.maxWidthPercent;
    height = width / (INNER_RATIO * shape);
  }
  return {
    left: `${slot.leftPercent}%`,
    width: `${width}%`,
    height: `${height}%`,
    zIndex: slot.z,
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
