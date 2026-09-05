// Ctrl/Cmd + = / - / 0 over the page. Desktop only in practice — a touch device
// pinches — and deliberately without a control of its own: the More menu keeps
// the three visible zoom items and this adds no chrome.
//
// Its own listener, not chat-scale-keys' bindZoomKeys: that binder keeps a
// single module-level applier, so a second caller would silently replace the
// chat column's.

import { useEffect, useRef } from "react";
import { zoomKeyAction, type ZoomAction } from "../base/zoom-keys";
import type { ViewInstance } from "../../../platform/app/reader-contract";

export interface ReaderZoomContext {
  // A book is open (the reader owns the window).
  inReader: boolean;
  // The full-window chat is up (call view "chat-main"): its ChatScaleScope has
  // the same keys bound on window, and the reader is a corner card behind it.
  // One press must move one thing, so the reader stands down.
  chatFullWindow: boolean;
}

export function readerZoomKeyAction(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  ctx: ReaderZoomContext,
): ZoomAction | null {
  if (!ctx.inReader || ctx.chatFullWindow) return null;
  return zoomKeyAction(e);
}

// Reset is the fit the current layout is built around, and zoomReset itself
// knows which one that is (layout-modes.resetZoom) — the key press does not
// have to name a fit.
export function applyReaderZoom(
  view: ViewInstance | null | undefined,
  _layout: "vertical" | "paged" | undefined,
  action: ZoomAction,
): void {
  if (!view) return;
  if (action === "in") view.zoomIn();
  else if (action === "out") view.zoomOut();
  else view.zoomReset();
}

// What the More menu's reset item is called. It names the fit it lands on, so
// it follows the layout: the paged strip resets to one whole page, and calling
// that "Fit page width" is what made the item read as a zoom control the reader
// would not expect to change how swiping behaves.
export function zoomResetLabel(layout: "vertical" | "paged" | undefined): string {
  return layout === "paged" ? "Fit page" : "Fit page width";
}

export function useReaderZoomKeys(args: {
  view: { current: ViewInstance | null };
  layout: "vertical" | "paged" | undefined;
  ctx: ReaderZoomContext;
}): void {
  // Read through a ref so the listener is bound once and never re-bound by the
  // shell's re-renders (the AI stream re-renders App many times a second).
  const latest = useRef(args);
  latest.current = args;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { view, layout, ctx } = latest.current;
      const action = readerZoomKeyAction(e, ctx);
      if (!action) return;
      // Without this the browser zooms the whole app instead of the page.
      e.preventDefault();
      applyReaderZoom(view.current, layout, action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
