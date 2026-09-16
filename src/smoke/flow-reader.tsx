// The phone's reflow reader with nothing above it (VITE_SMOKE=flow-reader): the
// pane on a synthetic book, or on a real one fetched from `?epub=<url>`, in a
// phone-wide column, with everything it reports kept on `window.__flow` for a
// driver to read. Marks are kept in localStorage per book so a reopen shows
// what the last run drew.
//
//   ?epub=<url>      the book (a CORS-enabled server outside the checkout)
//   ?book=<id>       the book id (default: from the url, or "flow-smoke")
//   ?cfi=<cfi>       open at this CFI; ?page=<n> at the start of this page
//   ?width=<px>      the column's width (default 393)

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { buildEpub, prose } from "../../tests/reading/epub/fixture";
import type { Annotation, ViewState } from "../platform/app/reader-contract";
import type { FlowReaderView, FlowTool } from "../reading/epub/flow-contract";
import FlowReaderPane from "../reading/epub/FlowReaderPane";
import { initPaperTint } from "../ui/components/base/paper-tint";

interface FlowLog {
  ready: boolean;
  error: string | null;
  view: FlowReaderView | null;
  states: ViewState[];
  stats: unknown[];
  saved: Annotation[][];
  selected: string[][];
  popups: unknown[];
  setTool: (tool: FlowTool) => void;
}

function syntheticBook(): ArrayBuffer {
  const bytes = buildEpub({
    title: "Flow Smoke",
    docs: [
      {
        name: "ch1.xhtml",
        body: `<h1>Chapter One</h1><p id="lead">The first chapter opens here, with a <a href="ch3.xhtml#p5">link into chapter three</a> and one to <a href="https://example.com/">the web</a>.</p>${prose(40)}`,
      },
      { name: "ch2.xhtml", body: `<h1>Chapter Two</h1>${prose(60)}` },
      { name: "ch3.xhtml", body: `<h1>Chapter Three</h1>${prose(50)}` },
      { name: "ch4.xhtml", body: `<h1>Chapter Four</h1>${prose(30)}` },
    ],
    toc: [
      { label: "Chapter One", href: "ch1.xhtml" },
      { label: "Chapter Two", href: "ch2.xhtml" },
      { label: "Chapter Three", href: "ch3.xhtml" },
      { label: "Chapter Four", href: "ch4.xhtml" },
    ],
  });
  return bytes.slice().buffer as ArrayBuffer;
}

function marksKey(bookId: string): string {
  return `flow-smoke-annotations-${bookId}`;
}

function loadMarks(bookId: string): Annotation[] {
  try {
    return JSON.parse(localStorage.getItem(marksKey(bookId)) ?? "[]") as Annotation[];
  } catch {
    return [];
  }
}

function Harness(props: { bookId: string; buffer: ArrayBuffer; viewState: ViewState | null; width: number; log: FlowLog }) {
  const [tool, setTool] = useState<FlowTool>({ type: "none", color: "#ffd400" });
  const { log } = props;
  useEffect(() => {
    log.setTool = setTool;
  }, [log]);
  return (
    <div style={{ width: props.width, height: "100vh", margin: "0 auto", border: "1px solid #ccc" }}>
      <FlowReaderPane
        bookId={props.bookId}
        buffer={props.buffer}
        annotations={loadMarks(props.bookId)}
        authorName="smoke"
        viewState={props.viewState}
        tool={tool}
        onView={(view) => {
          log.view = view;
        }}
        onInitialized={() => {
          log.ready = true;
        }}
        onError={(e) => {
          log.error = e.message;
        }}
        onChangeViewState={(s) => {
          log.states.push(s);
        }}
        onChangeViewStats={(s) => {
          log.stats.push(s);
        }}
        onSaveAnnotations={(anns) => {
          log.saved.push(anns);
          localStorage.setItem(marksKey(props.bookId), JSON.stringify(anns));
        }}
        onSelectAnnotations={(ids) => {
          log.selected.push(ids);
        }}
        onSetAnnotationPopup={(params) => {
          log.popups.push(params ?? null);
        }}
      />
    </div>
  );
}

export async function runFlowReaderSmoke(): Promise<void> {
  initPaperTint(window);
  const params = new URLSearchParams(location.search);
  const log: FlowLog = {
    ready: false,
    error: null,
    view: null,
    states: [],
    stats: [],
    saved: [],
    selected: [],
    popups: [],
    setTool: () => {},
  };
  (window as unknown as { __flow: FlowLog }).__flow = log;
  const src = params.get("epub");
  let buffer: ArrayBuffer;
  try {
    buffer = src ? await (await fetch(src)).arrayBuffer() : syntheticBook();
  } catch (e) {
    log.error = e instanceof Error ? e.message : String(e);
    return;
  }
  const bookId = params.get("book") ?? (src ? `flow-${src.replace(/[^a-z0-9]+/gi, "-").slice(-40)}` : "flow-smoke");
  const cfi = params.get("cfi");
  const page = params.get("page");
  const viewState: ViewState | null =
    cfi || page
      ? { pageIndex: Number(page ?? 0), scale: "auto", scrollMode: 0, layout: "vertical", ...(cfi ? { cfi } : {}) }
      : null;
  const width = Number(params.get("width") ?? 393);
  document.body.style.margin = "0";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Harness bookId={bookId} buffer={buffer} viewState={viewState} width={width} log={log} />
    </React.StrictMode>,
  );
}
