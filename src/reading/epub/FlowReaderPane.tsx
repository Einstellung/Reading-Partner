// The phone's reading area for an EPUB (docs/70): one element for the column,
// and the pen in hand. The events are read by the view itself — the scrolled
// column (flow-view.ts) or the turned pages (paged-view.ts, docs/79), whichever
// the reader's display asks for; what is here is only its lifetime.

import { memo, useEffect, useRef } from "react";
import type { ViewState } from "../../platform/app/reader-contract";
import type { FlowReaderPaneProps, FlowReaderView } from "./flow-contract";
import { createFlowReader } from "./flow-view";
import { createPagedReader } from "./paged-view";

function FlowReaderPaneImpl(props: FlowReaderPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FlowReaderView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // Where the view last said the reader was: a switch between scrolling and
  // turning opens the other view there, on the same character.
  const lastStateRef = useRef<ViewState | null>(props.viewState);
  const mode = props.display.mode;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    const p = propsRef.current;
    const opts = {
      host,
      bookId: p.bookId,
      buffer: p.buffer,
      viewState: lastStateRef.current,
      annotations: p.annotations,
      authorName: p.authorName,
      tool: p.tool,
      display: p.display,
      callbacks: {
        onChangeViewState: (s: ViewState) => {
          lastStateRef.current = s;
          propsRef.current.onChangeViewState(s);
        },
        onChangeViewStats: (s) => propsRef.current.onChangeViewStats(s),
        onSaveAnnotations: (anns) => propsRef.current.onSaveAnnotations(anns),
        onSelectAnnotations: (ids) => propsRef.current.onSelectAnnotations(ids),
        onAnnotationPopup: (params) => propsRef.current.onSetAnnotationPopup(params),
      },
    } satisfies Parameters<typeof createFlowReader>[0];
    const opening =
      mode === "paged"
        ? createPagedReader({ ...opts, backEdgePx: p.backEdgePx ?? 0 })
        : createFlowReader(opts);
    opening
      .then((view) => {
        if (!live) {
          view.destroy();
          return;
        }
        viewRef.current = view;
        view.setTool(propsRef.current.tool);
        propsRef.current.onView(view);
        propsRef.current.onInitialized();
      })
      .catch((e: unknown) => {
        if (!live) return;
        propsRef.current.onError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      live = false;
      viewRef.current?.destroy();
      viewRef.current = null;
      host.replaceChildren();
    };
    // The book is the identity of this pane; the shell remounts it by key on a
    // book switch. The only other restart is a switch of mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bookId, mode]);

  useEffect(() => {
    viewRef.current?.setTool(props.tool);
  }, [props.tool]);

  // The column mounts at the display it was handed, so the first value is
  // already applied; only a change after that is a relayout.
  const displayRef = useRef(props.display);
  useEffect(() => {
    if (props.display === displayRef.current) return;
    const modeChanged = props.display.mode !== displayRef.current.mode;
    displayRef.current = props.display;
    // A new view mounts at the new display on its own.
    if (!modeChanged) viewRef.current?.setDisplay(props.display);
  }, [props.display]);

  return (
    <div
      ref={hostRef}
      className={`relative h-full w-full overflow-hidden ${props.className ?? ""}`}
      data-testid="flow-reader"
    />
  );
}

const FlowReaderPane = memo(FlowReaderPaneImpl);
export default FlowReaderPane;
