// The Topics shelf, minus React: how wide the grid is at a given viewport, the
// order the cards come in, which files a card's cover stack shows and where
// each one sits, and the two labels a card carries. None of it depends on the
// DOM, so the phone form factor can render the same shelf differently without
// re-deriving any of it (CLAUDE.md).

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

// Two columns is the floor: a one-column shelf is the list this replaced. Three
// at iPad portrait (820), four at iPad landscape (1180), five before a desktop
// window makes the cards absurdly large.
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

export const MAX_COVERS = 3;

// One cover in the stack. The percentages are of the shelf area's inner box,
// not of the card: the card grows with the column count and the stack has to
// grow with it. `leftPercent` is the cover's centre, so the caller pairs it
// with a -50% translate and the whole stack stays centred at any count.
export interface CoverSlot {
  file: FileRef;
  leftPercent: number;
  widthPercent: number;
  // Each cover is in front of the one to its left, so the stack fans the way a
  // row of leaning books does and the last one — the most recently read — is
  // the whole cover rather than a strip.
  z: number;
}

// Wide enough that a single cover is the subject of the card rather than a
// stamp on it, narrow enough that three of them at the step below still fit
// inside the box.
const COVER_WIDTH_PERCENT = 50;

// Distance between two covers' centres. Chosen per count so the outermost
// edges land just inside the box: 50 - (n-1)/2 * step - width/2 >= 0.
const STEP_PERCENT: Record<number, number> = { 1: 0, 2: 28, 3: 24 };

export function coverSlots(topic: Topic): CoverSlot[] {
  // The three most recently read books — the shelf shows what the topic is
  // currently about, not what was added to it first — laid out oldest first, so
  // that the most recent one ends up on the right, in front and whole.
  const files = sortedFiles(topic).slice(0, MAX_COVERS).reverse();
  const step = STEP_PERCENT[files.length] ?? 0;
  return files.map((file, i) => ({
    file,
    leftPercent: 50 + (i - (files.length - 1) / 2) * step,
    widthPercent: COVER_WIDTH_PERCENT,
    z: i + 1,
  }));
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
