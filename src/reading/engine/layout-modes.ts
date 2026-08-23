// The two reading layouts as data, plus the rule for where each one thinks the
// reader is. Pure and engine-free so the properties that matter can be unit
// tested: a position saved in either layout names the page the reader is
// looking at.
//
// EmbedPdfView.setLayout applies these fields on every switch, in this order,
// and EmbedPdfView.currentState reads the anchor back. Anything a layout owns
// belongs in LayoutSettings — a setting applied on the way in but not listed
// here is a setting nothing will restore on the way out, which is how a reader
// gets stuck in a strip of pages it can no longer scroll.

export type ReadingLayout = "vertical" | "paged";

// How the pages are laid out: a vertical column, or the horizontal strip paged
// mode flips through.
export type ScrollAxis = "vertical" | "horizontal";

// The zoom each layout locks to. Paged is one whole page per screen; vertical
// reads at page width.
export type ZoomLock = "fit-width" | "fit-page";

// Where a saved reading position points — not the same question in the two
// layouts, which is why it is a per-layout setting and not one shared rule.
//
// "viewport-top": the reader is at the top edge of the viewport. It falls inside
// the topmost visible page, and how far into that page is the other half of the
// answer, so the position carries an in-page offset. This is the continuous
// column: it stops anywhere, including between two pages.
//
// "centered-page": the reader is on the page in the middle of the screen, whole.
// There is no in-page offset to carry, and naming the topmost visible page would
// name the wrong one — the strip packs pages side by side with a gap, so at any
// viewport where fit-page is smaller than fit-width both neighbours peek in at
// the edges and the leftmost visible page is the one before.
export type ReadingAnchor = "viewport-top" | "centered-page";

export interface LayoutSettings {
  axis: ScrollAxis;
  zoom: ZoomLock;
  // Whether the viewport container swallows native pan/zoom (touch-action:none).
  touchLock: boolean;
  // Where a page the layout is asked to show has to end up. Paged centres one
  // whole page (the horizontal strip left-aligns, so a page narrower than the
  // viewport needs an explicit alignX — pitfall 40); vertical puts the page's
  // top at the top of the viewport and lets the column continue below it.
  //
  // The two also differ in whether placing again is free. Centring is
  // idempotent — paged is already resting on the page it centres — so a repeat
  // setLayout re-asserts it. Putting a page top at the viewport top is not: it
  // throws away where inside the page the reader was, so vertical only places a
  // page when the switch actually changed the axis.
  placePage: "center" | "top";
  // Which page the layout reads back as the reading position, the inverse of
  // placePage: a layout that centres a page anchors on the centred one, a layout
  // that puts a page top at the viewport top anchors on whatever page the
  // viewport top is in (ReadingAnchor says what each answer means).
  anchor: ReadingAnchor;
  // Whether the layout keeps a fit-page baseline scale, the reference its pinch
  // rules compare against. Only paged has one; carrying a stale baseline into a
  // later paged session would misjudge "zoomed in" after a viewport resize.
  tracksFitPage: boolean;
}

export const LAYOUT_SETTINGS: Record<ReadingLayout, LayoutSettings> = {
  vertical: {
    axis: "vertical",
    zoom: "fit-width",
    touchLock: false,
    placePage: "top",
    anchor: "viewport-top",
    tracksFitPage: false,
  },
  paged: {
    axis: "horizontal",
    zoom: "fit-page",
    touchLock: true,
    placePage: "center",
    anchor: "centered-page",
    tracksFitPage: true,
  },
};

// One page's slice of the scroll plugin's visibility metrics: the page's number
// and the viewport's top-left corner inside it, in unscaled page coordinates.
export interface VisiblePage {
  pageNumber: number;
  pageX: number;
  pageY: number;
}

// A reading position as it is persisted: zero-based page, plus the in-page
// offset for the layouts whose anchor carries one.
export interface ReadingPosition {
  pageIndex: number;
  pageX?: number;
  pageY?: number;
}

// Where the reader is, in the terms the layout in front of them uses.
//
// `currentPage` is the scroll plugin's own answer — 1-based, the most visible
// page, which under a fit-page lock is the centred one — and `visible` its
// visibility metrics, both out of the one state the plugin publishes. Paged
// takes the first, so the page it saves is the same `currentPage` the stats
// readout shows and a layout switch carries across, rather than a centred page
// the host works out for itself and can disagree about. Vertical takes the
// second, which is the one place the two deliberately differ: the reader can be
// at the bottom of a page the plugin has stopped calling current.
//
// With no metrics — the layout is not ready yet — the plugin's page is all
// there is, and the position restores to that page's top.
export function readingPosition(
  layout: ReadingLayout,
  currentPage: number,
  visible: readonly VisiblePage[],
): ReadingPosition {
  const current = { pageIndex: Math.max(0, currentPage - 1) };
  if (LAYOUT_SETTINGS[layout].anchor === "centered-page" || visible.length === 0) return current;
  const top = visible.reduce((a, b) => (b.pageNumber < a.pageNumber ? b : a));
  return { pageIndex: Math.max(0, top.pageNumber - 1), pageX: top.pageX, pageY: top.pageY };
}

// The scale a book opens at, given what was saved for it — the counterpart of
// readingPosition above, which reads a position back out.
//
// null means "nothing to restore": the zoom plugin is registered with this
// layout's `zoom` lock as its default, and leaving it alone is what opens the
// book at that fit. A number is the reader's own scale, and vertical restores
// it, because remembering how a book was zoomed is the point.
//
// Paged restores nothing, for the reason its saved position carries no in-page
// offset either: its contract is one whole page, which is the fit for the screen
// in front of the reader and not the one that last saved.
//
// A saved state with no scale in it is not the same as a scale of 1. A book that
// has never been opened still arrives here with a state — the shell builds one
// so the layout is decided before the first paint — and that state's scale is
// the "nothing was saved" sentinel, not a measurement. Requesting a number for
// it overrides the fit the plugin was registered with, which is how a fresh book
// opened at 100% on a screen wide enough for 233%.
export function openingZoom(layout: ReadingLayout, saved: number | undefined): number | null {
  if (LAYOUT_SETTINGS[layout].zoom === "fit-page") return null;
  return typeof saved === "number" && saved > 0 ? saved : null;
}
