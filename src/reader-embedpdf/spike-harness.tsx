// Standalone runtime harness for the EmbedPDF spike. Not part of the app; it
// mounts EmbedPdfView against /demo.pdf and exposes hooks on window so Playwright
// (or a human) can drive the create/persist/reload flows and close the research
// doc's open items 3-8 with real measurements. Served by Vite in dev at
// /embedpdf-spike.html.

import { memo, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import EmbedPdfView, {
  type EmbedPdfHandle,
  type EmbedPdfViewProps,
  type EmbedViewState,
  type EmbedViewStats,
} from "./EmbedPdfView";
import { embedToZotero, type ZoteroAnnotation } from "./convert";

// Render counter to measure re-render isolation (perf item #3). A parent churn
// (window.__churn(n)) mimics the shell's AI-streaming state updates; with the
// memoized wrapper + stable props the engine subtree must not re-render.
let embedRenders = 0;
function CountingView(props: EmbedPdfViewProps) {
  embedRenders++;
  return <EmbedPdfView {...props} />;
}
const MemoView = memo(CountingView);

declare global {
  interface Window {
    __spike: {
      ready: boolean;
      error: string | null;
      handle: EmbedPdfHandle | null;
      saves: ZoteroAnnotation[];
      deletes: string[];
      lastState: EmbedViewState | null;
      lastStats: EmbedViewStats | null;
      // Convenience for the driver.
      dumpEmbed: () => unknown[];
      convertBack: () => unknown[];
    };
    __setInitialViewState: (s: EmbedViewState) => void;
  }
}

// A preloaded highlight on page 1 with a full custom payload — exercises import,
// the Y-flip (item 3) and custom round-trip (item 7) without needing a live drag.
const SEED_HIGHLIGHT: ZoteroAnnotation = {
  id: "seed-hl-0001",
  type: "highlight",
  color: "#ff6666",
  comment: "seed comment",
  text: "seed selected text",
  tags: [{ name: "spike" }],
  pageLabel: "1",
  position: { pageIndex: 0, rects: [[100, 650, 300, 662]] },
  dateCreated: "2026-07-16T00:00:00.000Z",
  dateModified: "2026-07-16T00:00:00.000Z",
  authorName: "Reading-Partner",
  aiThreadId: "thread-seed",
  starred: false,
};

window.__spike = {
  ready: false,
  error: null,
  handle: null,
  saves: [],
  deletes: [],
  lastState: null,
  lastStats: null,
  dumpEmbed: () => window.__spike.handle?._debug.dumpEmbed() ?? [],
  convertBack: () => {
    const h = window.__spike.handle;
    if (!h) return [];
    return h._debug.dumpEmbed().map((o) => embedToZotero(o as any, h._debug.pageHeight((o as any).pageIndex)));
  },
};

function Harness() {
  const [, setTick] = useState(0);
  const q = new URLSearchParams(location.search);
  const memoized = q.get("memo") !== "0"; // ?memo=0 to measure the un-isolated baseline
  // Props built once; identity stable across churn so the memo can bail.
  const props = useMemo<EmbedPdfViewProps>(() => {
    const initial: EmbedViewState | null = q.has("page")
      ? { pageIndex: Number(q.get("page")), zoom: Number(q.get("zoom") ?? "1") }
      : ((window as any).__initialViewState as EmbedViewState | null);
    (window as any).__churn = (n: number) => {
      for (let i = 0; i < n; i++) flushSync(() => setTick((t) => t + 1));
    };
    (window as any).__embedRenders = () => embedRenders;
    return {
      buffer: (window as any).__buf as ArrayBuffer,
      annotations: [SEED_HIGHLIGHT],
      authorName: "Reading-Partner",
      initialViewState: initial ?? null,
      style: { flex: 1 },
      onReady: (h: EmbedPdfHandle) => {
        window.__spike.handle = h;
        window.__spike.ready = true;
      },
      onError: (e: Error) => {
        window.__spike.error = String(e?.message ?? e);
      },
      onSaveAnnotations: (anns: ZoteroAnnotation[]) => {
        window.__spike.saves.push(...anns);
      },
      onDeleteAnnotations: (ids: string[]) => {
        window.__spike.deletes.push(...ids);
      },
      onViewState: (s: EmbedViewState) => {
        window.__spike.lastState = s;
      },
      onViewStats: (s: EmbedViewStats) => {
        window.__spike.lastStats = s;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const View = memoized ? MemoView : CountingView;
  return <View {...props} />;
}

async function boot() {
  try {
    const res = await fetch("/demo.pdf");
    const buf = await res.arrayBuffer();
    (window as any).__buf = buf;
    // Time from mount to first rendered page image ("open -> readable" proxy,
    // covers engine create + provider/plugin init + first raster).
    const t0 = performance.now();
    createRoot(document.getElementById("root")!).render(<Harness />);
    const tick = () => {
      if (document.querySelector("#root img")) {
        (window.__spike as any).firstImgMs = Math.round(performance.now() - t0);
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  } catch (e) {
    window.__spike.error = String(e);
  }
}

// Low-level engine probe: bypass the whole plugin system to tell an engine
// problem from a wiring problem.
(window as any).__directTest = async () => {
  const { createPdfiumDirectEngine, createPdfiumWorkerEngine } = await import("@embedpdf/engines");
  const out: any = { coi: (self as any).crossOriginIsolated };
  for (const [label, make] of [
    ["direct", createPdfiumDirectEngine],
    ["worker", createPdfiumWorkerEngine],
  ] as const) {
    try {
      const engine: any = await (make as any)("/pdfium/pdfium.wasm", { fontFallback: null });
      const buf = await (await fetch("/demo.pdf")).arrayBuffer();
      const task = engine.openDocumentBuffer({ id: "d", content: buf });
      const doc = await Promise.race([
        task.toPromise(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout-25s")), 25000)),
      ]);
      out[label] = { ok: true, pageCount: (doc as any)?.pageCount };
    } catch (e: any) {
      out[label] = { ok: false, err: e?.reason ?? e?.message ?? String(e) };
    }
  }
  return out;
};

// Cold-open load timeline: breaks the open into its cost centers so the
// dominant term is obvious. Engine creation is timed twice to show the
// per-book-open cost that a shared engine would remove.
(window as any).__loadTimeline = async () => {
  const { createPdfiumDirectEngine } = await import("@embedpdf/engines");
  const time = async <T,>(fn: () => Promise<T>) => {
    const t = performance.now();
    const v = await fn();
    return { ms: Math.round(performance.now() - t), v };
  };
  const fetchPdf = await time(async () => new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()));
  const e1 = await time(() => createPdfiumDirectEngine("/pdfium/pdfium.wasm", { fontFallback: null }) as any);
  const open1 = await time(() => (e1.v as any).openDocumentBuffer({ id: "t1", content: (fetchPdf.v as Uint8Array).slice().buffer }).toPromise());
  // Second engine: fresh createPdfiumEngine again (wasm HTTP-cached, recompiled),
  // representing the cost paid on every book open today.
  const e2 = await time(() => createPdfiumDirectEngine("/pdfium/pdfium.wasm", { fontFallback: null }) as any);
  const open2 = await time(() => (e2.v as any).openDocumentBuffer({ id: "t2", content: (fetchPdf.v as Uint8Array).slice().buffer }).toPromise());
  return {
    fetchPdfMs: fetchPdf.ms,
    engineCreate_1stMs: e1.ms,
    openParse_1stMs: open1.ms,
    pageCount: (open1.v as any)?.pageCount,
    engineCreate_2ndMs: e2.ms,
    openParse_2ndMs: open2.ms,
  };
};

void boot();
