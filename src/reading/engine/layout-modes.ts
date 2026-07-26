// The two reading layouts as data, plus the reducer that switches between them.
// Pure and engine-free so the one property that matters can be unit tested:
// entering a layout and leaving it again restores every setting the entry
// touched, and doing it repeatedly changes nothing further.
//
// The host (EmbedPdfView.setLayout) applies exactly these fields, in this
// order. Anything a layout owns belongs in LayoutSettings — a setting applied
// on the way in but not listed here is a setting nothing will restore on the
// way out, which is how a reader gets stuck in a strip of pages it can no
// longer scroll.

export type ReadingLayout = "vertical" | "paged";

// How the pages are laid out: a vertical column, or the horizontal strip paged
// mode flips through.
export type ScrollAxis = "vertical" | "horizontal";

// The zoom each layout locks to. Paged is one whole page per screen; vertical
// reads at page width.
export type ZoomLock = "fit-width" | "fit-page";

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
    tracksFitPage: false,
  },
  paged: {
    axis: "horizontal",
    zoom: "fit-page",
    touchLock: true,
    placePage: "center",
    tracksFitPage: true,
  },
};

// Everything a layout switch owns, in the abstract: the engine settings above
// plus the touch router's live state. The router state is in here because a
// switch must never inherit a gesture from the layout it just left — a drag, a
// rubber band, an inertia fling, a captured pointer and a paused engine all
// belong to the layout that started them.
export interface LayoutEngineState {
  axis: ScrollAxis;
  zoom: ZoomLock;
  touchLock: boolean;
  // Numeric fit-page scale, or 0 when none is held.
  fitPageBaseline: number;
  gesturesIdle: boolean;
  enginePaused: boolean;
  pointerCaptured: boolean;
  inertia: boolean;
}

// The state a freshly switched layout is in. Total, not a patch: every field is
// written from the target layout or reset, so the result never depends on how
// dirty the previous one was.
export function applyLayout(prev: LayoutEngineState, layout: ReadingLayout): LayoutEngineState {
  const s = LAYOUT_SETTINGS[layout];
  return {
    axis: s.axis,
    zoom: s.zoom,
    touchLock: s.touchLock,
    fitPageBaseline: s.tracksFitPage ? prev.fitPageBaseline : 0,
    gesturesIdle: true,
    enginePaused: false,
    pointerCaptured: false,
    inertia: false,
  };
}

// The state a reader sits in while resting in a layout, i.e. what a round trip
// has to come back to.
export function restingState(layout: ReadingLayout, fitPageBaseline = 0): LayoutEngineState {
  const s = LAYOUT_SETTINGS[layout];
  return {
    axis: s.axis,
    zoom: s.zoom,
    touchLock: s.touchLock,
    fitPageBaseline: s.tracksFitPage ? fitPageBaseline : 0,
    gesturesIdle: true,
    enginePaused: false,
    pointerCaptured: false,
    inertia: false,
  };
}

// A host-driven jump — the outline, the trace list, an AI citation — is the
// other event a gesture must not survive. The touch router owns the scroll
// position (the page divs are touch-action:none, so nothing scrolls unless the
// router writes it — pitfall 37), and anything it still has in flight keeps
// writing after the jump: an inertia fling coasts for up to a second and drags
// the reader straight back off the page it was sent to. So a jump drops the
// router's state exactly as a layout switch does.
//
// What it must NOT touch is the layout itself. A jump is not a switch: the
// axis, the zoom lock and the fit-page baseline are whatever the current layout
// says they are, and re-deriving them here would silently re-assert a layout
// the reader may have changed.
export function applyJump(prev: LayoutEngineState): LayoutEngineState {
  return {
    ...prev,
    gesturesIdle: true,
    enginePaused: false,
    pointerCaptured: false,
    inertia: false,
  };
}

export function otherLayout(layout: ReadingLayout): ReadingLayout {
  return layout === "paged" ? "vertical" : "paged";
}
