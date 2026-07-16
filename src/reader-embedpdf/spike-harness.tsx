// Standalone runtime harness for the EmbedPDF spike. Not part of the app; it
// mounts EmbedPdfView against /demo.pdf and exposes hooks on window so Playwright
// (or a human) can drive the create/persist/reload flows and close the research
// doc's open items 3-8 with real measurements. Served by Vite in dev at
// /embedpdf-spike.html.

import { createRoot } from "react-dom/client";
import EmbedPdfView, {
  type EmbedPdfHandle,
  type EmbedViewState,
  type EmbedViewStats,
} from "./EmbedPdfView";
import { embedToZotero, type ZoteroAnnotation } from "./convert";

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
  const buf = (window as any).__buf as ArrayBuffer;
  const q = new URLSearchParams(location.search);
  const initial: EmbedViewState | null = q.has("page")
    ? { pageIndex: Number(q.get("page")), zoom: Number(q.get("zoom") ?? "1") }
    : ((window as any).__initialViewState as EmbedViewState | null);
  return (
    <EmbedPdfView
      buffer={buf}
      annotations={[SEED_HIGHLIGHT]}
      authorName="Reading-Partner"
      initialViewState={initial ?? null}
      style={{ flex: 1 }}
      onReady={(h) => {
        window.__spike.handle = h;
        window.__spike.ready = true;
      }}
      onError={(e) => {
        window.__spike.error = String(e?.message ?? e);
      }}
      onSaveAnnotations={(anns) => {
        window.__spike.saves.push(...anns);
      }}
      onDeleteAnnotations={(ids) => {
        window.__spike.deletes.push(...ids);
      }}
      onViewState={(s) => {
        window.__spike.lastState = s;
      }}
      onViewStats={(s) => {
        window.__spike.lastStats = s;
      }}
    />
  );
}

async function boot() {
  try {
    const res = await fetch("/demo.pdf");
    const buf = await res.arrayBuffer();
    (window as any).__buf = buf;
    createRoot(document.getElementById("root")!).render(<Harness />);
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
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout-8s")), 8000)),
      ]);
      out[label] = { ok: true, pageCount: (doc as any)?.pageCount };
    } catch (e: any) {
      out[label] = { ok: false, err: e?.reason ?? e?.message ?? String(e) };
    }
  }
  return out;
};

void boot();
