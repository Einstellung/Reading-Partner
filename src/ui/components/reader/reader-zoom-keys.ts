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

// Reset is the fit the current layout is built around: fit-width for the
// vertical scroll, fit-page for the paged flip, where re-asserting the layout is
// how the engine restores its own fit (setLayout applies every setting on every
// call, including the zoom mode).
export function applyReaderZoom(
  view: ViewInstance | null | undefined,
  layout: "vertical" | "paged" | undefined,
  action: ZoomAction,
): void {
  if (!view) return;
  if (action === "in") view.zoomIn();
  else if (action === "out") view.zoomOut();
  else if (layout === "paged") view.setLayout("paged");
  else view.zoomReset();
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
