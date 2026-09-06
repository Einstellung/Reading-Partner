// The reader's left panel has two forms, and this is the rule that picks
// between them: below 1024px it is the drawer it has always been, at and above
// it a column standing in the flow beside the page.
//
// The breakpoint is a width and not a device. A drawer exists because there is
// no width to spare: it borrows the reader's, dims it, and gives it back on the
// next tap. Once 280px can come off the page without the page becoming a
// column of hyphens, borrowing is the wrong trade — the panel can simply be
// there, and the outline stops being a thing you open, read one line of, and
// lose.
//
// 1024 is Tailwind's `lg`, so the CSS half of this is variants on the panel
// itself and no JavaScript decides anything about layout. What JavaScript
// needs the breakpoint for is behaviour that CSS cannot express: whether a jump
// to a page should shut the panel, and whether the open state is worth
// remembering.

// Kept beside the class strings that encode the same number, because the two
// have to agree and only one of them is greppable from a stylesheet.
export const COLUMN_MIN_WIDTH_PX = 1024;
export const COLUMN_MEDIA_QUERY = `(min-width: ${COLUMN_MIN_WIDTH_PX}px)`;

// localStorage, like the paper tint and for the same reasons (paper-tint.ts):
// this is a per-device view preference — a desk with a wide screen wants the
// column, the same account on a phone never sees it — and it is read
// synchronously, so the first frame is already the layout the reader left.
export const SIDEBAR_OPEN_KEY = "reader-sidebar-open";

// The storage handle is base/pref-store.ts: the shell sidebar keeps its own
// collapsed state the same way (docs/51), and one helper is what keeps the two
// reading the same slot the same way. Re-exported so this module stays the one
// import a caller of the reader panel's preference needs.
import type { PrefStore } from "../base/pref-store";
export type { PrefStore } from "../base/pref-store";
export { browserPrefStore } from "../base/pref-store";

// The stored value only ever answers for the column. A drawer restored open
// would put a dimmed backdrop over the book at launch, which is a state the
// reader can only have arrived at by accident; so below the breakpoint the
// panel always starts shut, whatever the last wide screen decided.
export function readSidebarOpen(store: PrefStore | null, column: boolean): boolean {
  if (!column) return false;
  try {
    return store?.getItem(SIDEBAR_OPEN_KEY) === "1";
  } catch {
    // A storage that throws on read is a storage that is not there.
    return false;
  }
}

export function writeSidebarOpen(store: PrefStore | null, open: boolean): void {
  try {
    store?.setItem(SIDEBAR_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Full or disabled storage: the choice still holds for this session.
  }
}

// Whether following an outline entry should also shut the panel. The drawer has
// to: its backdrop covers the reader and answers nothing but a tap, so a jump
// that left it open would land on a page the finger cannot scroll. The column
// covers nothing, and shutting it would throw away the reader's place in a list
// they are working down.
export function closesOnNavigate(column: boolean): boolean {
  return !column;
}

// The layout as the window reports it right now, for the first render — before
// any subscription exists. Absent matchMedia (a test window, an old webview)
// reads as the drawer, which is the form that works at every width.
export function columnLayoutNow(win: Window | null): boolean {
  return win?.matchMedia?.(COLUMN_MEDIA_QUERY).matches ?? false;
}
