// Unattended engine smoke check. Activated only in a dedicated smoke build
// (VITE_SMOKE=1, set exclusively by .github/workflows/ios-simulator-smoke.yml);
// main.tsx runs it instead of mounting the app. Nothing here is bundled into a
// normal build — the dynamic import in main.tsx is guarded by the env flag, so
// this whole module is a separate chunk that a non-smoke build never loads.
//
// It answers one question: can EmbedPDF's pthread PDFium WASM (SharedArrayBuffer
// + cross-origin isolation, served over WKWebView's custom scheme on iOS) load
// and rasterize a page? It runs the exact production engine path
// (getPdfiumEngine, the shared direct engine), opens a tiny embedded PDF, renders
// page 1, and counts non-white pixels. The machine-readable verdict is written to
// a JSON file under the app data dir (the CI reads it back with simctl
// get_app_container); the on-screen status is only a human witness for the
// screenshot artifact.

import { mkdir, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { PdfEngine } from "@embedpdf/models";
import { getPdfiumEngine } from "../reader-embedpdf/engine-singleton";
import { SMOKE_PDF_BASE64, decodeBase64 } from "./smoke-pdf";

// Where the verdict is written, relative to the app data dir. The CI does not
// assume where BaseDirectory.AppData maps on iOS — it locates the file by its
// distinctive name under the app's data container, so the name must be unique.
export const SMOKE_RESULT_DIR = "smoke";
export const SMOKE_RESULT_FILE = "smoke/smoke-result.json";

// Which layer failed, so a red gate says exactly what broke (each maps to a
// different fix — see docs/pitfall). Ordered from outermost precondition inward.
export type SmokeFailLayer =
  | "no-cross-origin-isolation" // crossOriginIsolated / SharedArrayBuffer absent
  | "wasm-init" // engine (wasm fetch + compile + pthread init) threw
  | "document-open" // openDocumentBuffer threw or timed out
  | "render" // renderPage threw or timed out
  | "blank-raster" // rendered but produced an all-white bitmap
  | null;

export interface SmokeResult {
  ok: boolean;
  stage: string;
  failLayer: SmokeFailLayer;
  crossOriginIsolated: boolean;
  hasSharedArrayBuffer: boolean;
  userAgent: string;
  // Timings (ms), filled as each stage completes.
  engineReadyMs: number | null;
  openMs: number | null;
  renderMs: number | null;
  // Render evidence.
  pageCount: number | null;
  blobBytes: number | null;
  renderWidth: number | null;
  renderHeight: number | null;
  nonWhitePixels: number | null;
  error: string | null;
  timestamp: string;
}

const OPEN_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 30_000;

function timeout(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
}

// Decode the rendered blob and count pixels that are not (near-)white. A correct
// raster of the fixture (a black square) yields thousands; an all-white bitmap
// yields ~0, which distinguishes "rendered blank" from "rendered content".
async function analyzeBlob(
  blob: Blob,
): Promise<{ width: number; height: number; nonWhite: number; canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let nonWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Count a pixel as content if any channel is meaningfully below white.
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) nonWhite++;
  }
  return { width: bitmap.width, height: bitmap.height, nonWhite, canvas };
}

async function writeResult(result: SmokeResult): Promise<void> {
  try {
    await mkdir(SMOKE_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextFile(SMOKE_RESULT_FILE, JSON.stringify(result, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (e) {
    // The file is the machine verdict; if even this fails, surface it on screen
    // so the screenshot still carries the reason.
    renderStatus({ ...result, error: `${result.error ?? ""}\n[writeResult failed] ${String(e)}` });
  }
}

function renderStatus(result: SmokeResult, pageCanvas?: HTMLCanvasElement): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "font:14px/1.5 -apple-system,system-ui,sans-serif;padding:16px;color:#111;background:#fff;min-height:100vh";
  const verdict = document.createElement("div");
  verdict.style.cssText = `font-size:22px;font-weight:700;margin-bottom:12px;color:${
    result.ok ? "#0a7d28" : "#c00"
  }`;
  verdict.textContent = result.ok
    ? "SMOKE PASS — PDFium rendered a page"
    : `SMOKE FAIL — ${result.failLayer ?? result.stage}`;
  box.appendChild(verdict);
  const pre = document.createElement("pre");
  pre.style.cssText = "white-space:pre-wrap;font-size:12px;margin:0 0 12px";
  pre.textContent = JSON.stringify(result, null, 2);
  box.appendChild(pre);
  if (pageCanvas) {
    pageCanvas.style.cssText = "border:1px solid #ccc;max-width:100%";
    box.appendChild(pageCanvas);
  }
  root.appendChild(box);
}

export async function runSmoke(): Promise<void> {
  const result: SmokeResult = {
    ok: false,
    stage: "start",
    failLayer: null,
    crossOriginIsolated: self.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    userAgent: navigator.userAgent,
    engineReadyMs: null,
    openMs: null,
    renderMs: null,
    pageCount: null,
    blobBytes: null,
    renderWidth: null,
    renderHeight: null,
    nonWhitePixels: null,
    error: null,
    timestamp: new Date().toISOString(),
  };

  let pageCanvas: HTMLCanvasElement | undefined;
  try {
    if (!result.crossOriginIsolated || !result.hasSharedArrayBuffer) {
      // The pthread wasm cannot start without SharedArrayBuffer; record the
      // precondition failure but still attempt the engine so the error text
      // captures how it fails (some builds throw a specific message).
      result.failLayer = "no-cross-origin-isolation";
    }

    result.stage = "engine";
    const t0 = performance.now();
    let engine: PdfEngine;
    try {
      engine = await getPdfiumEngine();
    } catch (e) {
      result.failLayer = result.failLayer ?? "wasm-init";
      throw e;
    }
    result.engineReadyMs = Math.round(performance.now() - t0);
    result.stage = "engine-ready";

    result.stage = "open";
    const bytes = decodeBase64(SMOKE_PDF_BASE64);
    const t1 = performance.now();
    let doc;
    try {
      doc = await Promise.race([
        engine.openDocumentBuffer({ id: "smoke", content: bytes.buffer as ArrayBuffer }).toPromise(),
        timeout(OPEN_TIMEOUT_MS, "openDocumentBuffer"),
      ]);
    } catch (e) {
      result.failLayer = result.failLayer ?? "document-open";
      throw e;
    }
    result.openMs = Math.round(performance.now() - t1);
    result.pageCount = doc.pages.length;
    result.stage = "opened";

    result.stage = "render";
    const t2 = performance.now();
    let blob: Blob;
    try {
      blob = await Promise.race([
        engine.renderPage(doc, doc.pages[0], { scaleFactor: 1, dpr: 1 }).toPromise(),
        timeout(RENDER_TIMEOUT_MS, "renderPage"),
      ]);
    } catch (e) {
      result.failLayer = result.failLayer ?? "render";
      throw e;
    }
    result.renderMs = Math.round(performance.now() - t2);
    result.blobBytes = blob.size;

    const analysis = await analyzeBlob(blob);
    pageCanvas = analysis.canvas;
    result.renderWidth = analysis.width;
    result.renderHeight = analysis.height;
    result.nonWhitePixels = analysis.nonWhite;
    result.stage = "rendered";

    if (analysis.nonWhite > 0) {
      result.ok = true;
      result.failLayer = null;
    } else {
      result.failLayer = "blank-raster";
    }

    engine
      .closeDocument(doc)
      .toPromise()
      .catch(() => {});
  } catch (e) {
    result.ok = false;
    result.error =
      e instanceof Error ? `${e.message}\n${e.stack ?? ""}`.trim() : String(e);
  }

  await writeResult(result);
  renderStatus(result, pageCanvas);
  // A one-line marker the CI can also grep from the webview console log.
  console.log(`[smoke] ${result.ok ? "PASS" : "FAIL"} ${JSON.stringify(result)}`);
}
