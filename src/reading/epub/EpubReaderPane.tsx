// The reading area for an EPUB: one element for the renderer, and the events
// that reach it.
//
// The events are the whole reason there is anything here at all. The book is in
// a sandboxed frame with no scripts, and WebKit dispatches no DOM event inside
// such a frame (docs/pitfall/244) — so a tap on the right edge, a swipe, an
// arrow key: none of them can be heard where they land. They are heard on the
// element wrapping the frame, turned into a page turn by reader-logic.ts, and
// handed to the renderer as a call.
//
// Continuous scrolling is the exception and needs nothing: the element that
// scrolls in that layout is foliate's own container, on this side of the frame,
// and a scroll is not a DOM event.

import { memo, useCallback, useEffect, useRef } from "react";
import type { ViewInstance, ViewState, ViewStats } from "../../platform/app/reader-contract";
import { SWIPE_MIN, keyTurn, swipeTurn, tapZone, type Turn } from "./reader-logic";
import { createEpubReader, type EpubReaderController } from "./reader-view";

export interface EpubReaderPaneProps {
  bookId: string;
  buffer: ArrayBuffer;
  viewState: ViewState | null;
  onView: (view: ViewInstance) => void;
  onInitialized: () => void;
  onError: (e: Error) => void;
  onChangeViewState: (s: ViewState) => void;
  onChangeViewStats: (s: ViewStats) => void;
  onQuoteHighlightChange?: (active: boolean) => void;
  className?: string;
}

function EpubReaderPaneImpl(props: EpubReaderPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<EpubReaderController | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // Where a finger or a mouse went down, so the pointer that comes up can be
  // read as a swipe or as a tap.
  const downRef = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    const p = propsRef.current;
    createEpubReader({
      host,
      bookId: p.bookId,
      buffer: p.buffer,
      viewState: p.viewState,
      themeRoot: document.documentElement,
      callbacks: {
        onChangeViewState: (s) => propsRef.current.onChangeViewState(s),
        onChangeViewStats: (s) => propsRef.current.onChangeViewStats(s),
        onQuoteHighlightChange: (a) => propsRef.current.onQuoteHighlightChange?.(a),
      },
    })
      .then((controller) => {
        if (!live) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;
        propsRef.current.onView(controller);
        propsRef.current.onInitialized();
      })
      .catch((e: unknown) => {
        if (!live) return;
        propsRef.current.onError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      live = false;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      host.replaceChildren();
    };
    // The book is the identity of this pane; App remounts it by key on a book
    // switch, and nothing else here may restart the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bookId]);

  // The app's palette can change under an open book (the paper tint, the system
  // switching to dark). The frame does not inherit custom properties, so it is
  // re-styled rather than re-cascaded (reader-styles.ts).
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const refresh = () => controllerRef.current?.refreshTheme();
    media?.addEventListener("change", refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-tint"],
    });
    return () => {
      media?.removeEventListener("change", refresh);
      observer.disconnect();
    };
  }, []);

  const apply = useCallback((turn: Turn) => {
    if (turn === "none") return;
    controllerRef.current?.turn(turn);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    downRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const down = downRef.current;
      downRef.current = null;
      const controller = controllerRef.current;
      const surface = surfaceRef.current;
      if (!down || down.id !== e.pointerId || !controller || !surface) return;
      const layout = controller.currentLayout();
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      const swipe = swipeTurn(layout, dx, dy);
      if (swipe !== "none") {
        apply(swipe);
        return;
      }
      // Not a swipe. A pointer that barely moved is a tap; one that moved and
      // was not a swipe was a drag over the text and turns nothing.
      if (Math.abs(dx) >= SWIPE_MIN || Math.abs(dy) >= SWIPE_MIN) return;
      // A tap on one of the book's own links follows it, wherever on the page
      // it landed — a footnote marker sitting in the right-hand tap zone is a
      // footnote, not a page turn.
      if (controller.followLinkAt(e.clientX, e.clientY)) return;
      const box = surface.getBoundingClientRect();
      apply(tapZone(layout, e.clientX - box.left, box.width));
    },
    [apply],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const turn = keyTurn(e.key);
      if (turn === "none") return;
      e.preventDefault();
      apply(turn);
    },
    [apply],
  );

  return (
    <div
      ref={surfaceRef}
      className={`relative h-full w-full overflow-hidden bg-desk outline-none ${props.className ?? ""}`}
      data-testid="epub-reader"
      // Focusable so the arrow keys reach it without a global listener that
      // would turn pages while the reader types in the chat.
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        downRef.current = null;
      }}
      onKeyDown={onKeyDown}
    >
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}

const EpubReaderPane = memo(EpubReaderPaneImpl);
export default EpubReaderPane;
