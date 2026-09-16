// The phone's reading area for an EPUB (docs/70): one element for the column,
// and the pen in hand. The events are read by the column itself (flow-view.ts);
// what is here is only its lifetime.

import { memo, useEffect, useRef } from "react";
import type { FlowReaderPaneProps, FlowReaderView } from "./flow-contract";
import { createFlowReader } from "./flow-view";

function FlowReaderPaneImpl(props: FlowReaderPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FlowReaderView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    const p = propsRef.current;
    createFlowReader({
      host,
      bookId: p.bookId,
      buffer: p.buffer,
      viewState: p.viewState,
      annotations: p.annotations,
      authorName: p.authorName,
      tool: p.tool,
      callbacks: {
        onChangeViewState: (s) => propsRef.current.onChangeViewState(s),
        onChangeViewStats: (s) => propsRef.current.onChangeViewStats(s),
        onSaveAnnotations: (anns) => propsRef.current.onSaveAnnotations(anns),
        onSelectAnnotations: (ids) => propsRef.current.onSelectAnnotations(ids),
        onAnnotationPopup: (params) => propsRef.current.onSetAnnotationPopup(params),
      },
    })
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
    // book switch, and nothing else here may restart the column.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bookId]);

  useEffect(() => {
    viewRef.current?.setTool(props.tool);
  }, [props.tool]);

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
