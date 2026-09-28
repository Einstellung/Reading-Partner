// The phone reader's chrome (docs/82), the parts of it that are not React:
// where the selection's handles and the popups go, what the Marks list shows,
// and whether the first-open hint has been said.
//
// Every rect here is in viewport coordinates, the way the view reports a
// selection (flow-contract.ts: FlowSelection) and the way the shell positions
// what it draws over the page.

import { epubPositionOf, epubSortOffset, markKind } from "../../../../reading/epub/annotation";
import type { FlowRect } from "../../../../reading/epub/flow/flow-contract";
import type { Annotation } from "../../../../platform/app/reader-contract";
import type { OutlineItem } from "../../../../fulltext/types";
import type { PrefStore } from "../../base/pref-store";

// ------------------------------------------------------------- the handles ---

/** How far a handle's knob sits past the line it is on. */
export const HANDLE_KNOB_PX = 22;

export interface HandleSpot {
  /** The line's edge the handle stands on. */
  x: number;
  /** The top of the line. */
  top: number;
  height: number;
}

/**
 * The two handles of a selection: the start one on the left edge of its first
 * line, the end one on the right edge of its last. Null for an end whose line
 * is outside `frame` (scrolled away, or on another screen of the paged view).
 */
export function handleSpots(
  rects: readonly FlowRect[],
  frame: { top: number; bottom: number; left: number; right: number },
): { start: HandleSpot | null; end: HandleSpot | null } {
  const first = rects[0];
  const last = rects[rects.length - 1];
  const inside = (r: FlowRect) =>
    r.top + r.height > frame.top && r.top < frame.bottom && r.left + r.width > frame.left && r.left < frame.right;
  return {
    start: first && inside(first) ? { x: first.left, top: first.top, height: first.height } : null,
    end: last && inside(last) ? { x: last.left + last.width, top: last.top, height: last.height } : null,
  };
}

// --------------------------------------------------------------- the popup ---

/**
 * Where a popup of this size goes over some text: above it when it fits under
 * the frame's top, else below, else pinned to the top. Centred on the text and
 * kept `margin` inside the frame's sides. Answers the popup's top-left corner.
 */
export function popupSpot(
  rects: readonly FlowRect[],
  frame: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  gap: number,
  margin = 8,
): { left: number; top: number } | null {
  const shown = rects.filter((r) => r.top + r.height > frame.top && r.top < frame.bottom);
  if (shown.length === 0) return null;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const r of shown) {
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.top + r.height);
    left = Math.min(left, r.left);
    right = Math.max(right, r.left + r.width);
  }
  const minY = frame.top + margin;
  const maxY = frame.bottom - margin;
  let y = top - gap - size.height;
  if (y < minY) y = bottom + gap;
  if (y + size.height > maxY) y = minY;
  const x = Math.min(Math.max((left + right) / 2 - size.width / 2, frame.left + margin), frame.right - margin - size.width);
  return { left: x, top: y };
}

// ------------------------------------------------------------- the marks ---

export interface MarkRow {
  id: string;
  kind: "highlight" | "underline";
  text: string;
  /** The outline entry the mark falls under, or "" before the first one. */
  chapter: string;
  pageLabel: string;
  /** The conversation an underline opens, if it carries one. */
  threadId: string | null;
}

/**
 * The Marks tab's rows: every highlight and underline on the book's pages, in
 * the order the text runs. Ink and marks on replies are not on the page and
 * are left out.
 */
export function markRows(marks: readonly Annotation[], outline: readonly OutlineItem[]): MarkRow[] {
  const rows: { row: MarkRow; spine: string; offset: number }[] = [];
  for (const a of marks) {
    const kind = markKind(a);
    const position = epubPositionOf(a);
    if (!position || (kind !== "highlight" && kind !== "underline")) continue;
    const page = position.pageIndex + 1;
    let chapter = "";
    for (const item of outline) {
      if (item.page <= page) chapter = item.title;
      else break;
    }
    const thread = a.aiThreadId;
    rows.push({
      row: {
        id: a.id,
        kind,
        text: (typeof a.text === "string" ? a.text : "").replace(/\s+/g, " ").trim(),
        chapter,
        pageLabel: typeof a.pageLabel === "string" && a.pageLabel ? a.pageLabel : String(page),
        threadId: typeof thread === "string" && thread ? thread : null,
      },
      spine: typeof a.sortIndex === "string" ? a.sortIndex.split("|")[0] : "",
      offset: epubSortOffset(a.sortIndex) ?? 0,
    });
  }
  rows.sort((x, y) => (x.spine === y.spine ? x.offset - y.offset : x.spine < y.spine ? -1 : 1));
  return rows.map((r) => r.row);
}

// ---------------------------------------------------------------- the hint ---

export const READER_HINT_KEY = "phone-reader-hint";

/**
 * Whether the first-open hint is still owed on this device, and it is marked
 * said on the way. A storage that refuses says it every time rather than never.
 */
export function takeReaderHint(store: PrefStore | null): boolean {
  try {
    if (store?.getItem(READER_HINT_KEY) === "1") return false;
    store?.setItem(READER_HINT_KEY, "1");
  } catch {
    // Said this once; it may be said again.
  }
  return true;
}

// --------------------------------------------------------------- the tabs ---

export type ContentsTab = "outline" | "marks" | "prep";
export const CONTENTS_TABS: readonly ContentsTab[] = ["outline", "marks", "prep"];
