// The live state the touch router reads on every event, and the tool union it
// reads it through.
//
// It sits under gesture/ rather than in the adapter's types.ts because the
// router is the only reader: every field exists to serve it, and the engine
// half fills them in. Declaring it one level up and importing it back down
// would make engine and engine/gesture import each other.

import type { ToolType } from "../../../platform/app/reader-contract";

// "pointer" is the tool group's all-unselected state (no annotation tool);
// "navlock" is the palm toggle, which activates no annotation tool either but
// puts the touch router in charge of every pointer.
export type EmbedTool = "pointer" | "navlock" | "highlight" | "underline" | "ink";

// The three engine handles the router reaches for, declared here by the five
// methods it calls rather than by the plugin types they arrive as. EmbedPDF's
// capability objects satisfy them structurally, and so does a reader with no
// plugins under it at all — which is what lets the EPUB desk (reading/epub)
// run this same router without engine/gesture knowing @embedpdf exists.

/** Where the reader is in the document, in 1-based pages. */
export interface GestureScroll {
  getCurrentPage(): number;
  getTotalPages(): number;
}

/** The engine's own pointer pipeline, shut off under a gesture that owns the touch. */
export interface GestureInteraction {
  pause(): void;
  resume(): void;
}

/** The text selection a gesture may have to drop on its way in. */
export interface GestureSelection {
  getBoundingRects(documentId: string): readonly unknown[];
  clear(documentId: string): void;
}

// Live gesture context, shared by a ref between the imperative engine wiring
// (which fills in the engine handles) and the TouchInputRouter touch component
// (which reads the current mode each event). A ref so mode changes never
// re-render the memoized engine subtree.
export interface PagedGestureCtx {
  paged: boolean;
  tool: ToolType;
  zoomedIn: boolean;
  // The "draw with your finger" setting, mirrored here so the touch router can
  // read it synchronously on every event. Off by default: the finger only moves
  // the page and the stylus marks it.
  fingerDraw: boolean;
  scroll: GestureScroll | null;
  interaction: GestureInteraction | null;
  // Used by the touch router to drop a text selection its own gesture caused.
  selection: GestureSelection | null;
  // Set by the touch router so setLayout can toggle the viewport's touch-action
  // (paged locks native pan/zoom; vertical restores it).
  setTouchLock: ((locked: boolean) => void) | null;
  // The scroll container itself, shared out by the touch router that grabbed
  // it. A layout switch has to read the element's own scrollWidth/scrollHeight:
  // the viewport plugin's cached metrics come from a ResizeObserver on the
  // container, which never fires when only the content inside it changes size,
  // so they say nothing about whether the re-layout has reached the DOM.
  viewport: HTMLElement | null;
  // The scroll indicator's thumb, which lives outside the scroll container so
  // the rubber band does not carry it off the edge. Painted by the router on
  // every scroll — including the engine's own programmatic ones.
  indicator: HTMLElement | null;
  // Set by the touch router so setLayout can drop everything the old layout had
  // in flight (drag, rubber band, inertia, captured pointer, paused engine)
  // before the new layout's geometry lands.
  resetGestures: (() => void) | null;
  // Paged mode's only way to change page: centres the target page and re-locks
  // fit-page, so a turn always lands on one whole page (the geometry needs the
  // zoom scope, which lives in the imperative wiring).
  turnToPage: ((pageNumber: number) => void) | null;
}
