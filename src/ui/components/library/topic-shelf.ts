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

// The front cover plus this many page edges beside it.
export const MAX_COVERS = 3;

// The shape a cover box is given before the image has said what shape it is:
// between a trade paperback (0.66) and a US Letter page (0.77). It only decides
// how much room is held while a cover loads.
export const COVER_ASPECT = 0.72;

// How wide one page edge is, as a percentage of the card. Enough to see that
// the topic holds more than one book, not enough to take room from the cover.
export const SPINE_WIDTH_PERCENT = 7;

// What a card shows: one cover across the full width of the card, and the
// covers of the other books as edges to the right of it, the way books stand
// next to each other on a shelf. The card has no padding, so the front cover
// and the edges together are exactly the width of the card.
export interface CoverStack {
  front: FileRef;
  // Most recently read first, so the nearest edge is the next book.
  spines: FileRef[];
  spineWidthPercent: number;
}

export function coverStack(topic: Topic): CoverStack | null {
  // Most recently read first: the shelf shows what the topic is currently
  // about, not what was added to it first.
  return stack(sortedFiles(topic).slice(0, MAX_COVERS));
}

// A screen that shows one book per card: the same front cover, no edges.
export function singleCover(file: FileRef): CoverStack {
  return stack([file]) as CoverStack;
}

function stack(files: FileRef[]): CoverStack | null {
  if (files.length === 0) return null;
  return {
    front: files[0],
    spines: files.slice(1),
    spineWidthPercent: SPINE_WIDTH_PERCENT,
  };
}

// Every file a card needs a cover image for.
export function stackFiles(stack: CoverStack | null): FileRef[] {
  return stack ? [stack.front, ...stack.spines] : [];
}

// The shape the front cover's box is given: its own, once the image has
// reported it, and the standing guess until then. Guards the shapes an image
// can report when it fails to decode.
export function coverAspect(ratio: number | undefined): number {
  return ratio && ratio > 0 && Number.isFinite(ratio) ? ratio : COVER_ASPECT;
}

// How wide the front cover is, as a percentage of the card: whatever the page
// edges beside it do not take.
export function frontWidthPercent(stack: CoverStack): number {
  return 100 - stack.spines.length * stack.spineWidthPercent;
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
