// The reading area for an EPUB: one element for the desk, and the events that
// reach it. The sheets are in the app's own DOM (docs/63), so a tap, a swipe
// and an arrow key all land where they happen; what is here is only the
// reading of them — reader-logic.ts says what each means, the controller
// (reader-view.ts) does it.

import { memo, useCallback, useEffect, useRef } from "react";
import type {
  Annotation,
  AnnotationPopupParams,
  ViewInstance,
  ViewState,
  ViewStats,
} from "../../platform/app/reader-contract";
import { SWIPE_MIN, claimsTouch, keyTurn, swipeTurn, tapZone, type Turn } from "./reader-logic";
import { createEpubReader, type EpubReaderController } from "./reader-view";

export interface EpubReaderPaneProps {
  bookId: string;
  buffer: ArrayBuffer;
  annotations: Annotation[];
  authorName: string;
  viewState: ViewState | null;
  onView: (view: ViewInstance) => void;
  onInitialized: () => void;
  onError: (e: Error) => void;
  onChangeViewState: (s: ViewState) => void;
  onChangeViewStats: (s: ViewStats) => void;
  onSaveAnnotations: (anns: Annotation[]) => void;
  onSelectAnnotations: (ids: string[]) => void;
  onSetAnnotationPopup: (params?: AnnotationPopupParams) => void;
  onQuoteHighlightChange?: (active: boolean) => void;
  className?: string;
}

function EpubReaderPaneImpl(props: EpubReaderPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
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
      annotations: p.annotations,
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
    // switch, and nothing else here may restart the desk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bookId]);

  // Taking the touch off the browser in the paged flip, on the moves the
  // pointer events cannot speak for (docs/pitfall/117). React's own touch
  // handlers are passive, so this listener is attached by hand.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onTouchMove = (e: TouchEvent) => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (claimsTouch(controller.currentLayout(), false)) e.preventDefault();
    };
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => host.removeEventListener("touchmove", onTouchMove);
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
      const controller = controllerRef.current;
      const down = downRef.current;
      downRef.current = null;
      const host = hostRef.current;
      if (!down || down.id !== e.pointerId || !controller || !host) return;
      const layout = controller.currentLayout();
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      const swipe = swipeTurn(layout, dx, dy);
      if (swipe !== "none") {
        apply(swipe);
        return;
      }
      if (Math.abs(dx) >= SWIPE_MIN || Math.abs(dy) >= SWIPE_MIN) return;
      // A tap on one of the book's own links follows it, wherever on the page
      // it landed — a footnote marker in the right-hand tap zone is a footnote.
      if (controller.followLinkAt(e.clientX, e.clientY)) return;
      const box = host.getBoundingClientRect();
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
      ref={hostRef}
      className={`relative h-full w-full overflow-hidden bg-desk outline-none ${props.className ?? ""}`}
      data-testid="epub-reader"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        downRef.current = null;
      }}
      onKeyDown={onKeyDown}
    />
  );
}

const EpubReaderPane = memo(EpubReaderPaneImpl);
export default EpubReaderPane;
