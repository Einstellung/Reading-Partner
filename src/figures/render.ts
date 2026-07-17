// Figure rasterization (M9), browser only. Crops a figure from its page with
// the already-loaded pdf.js (the same library that produced the bbox, so the
// coordinate spaces match exactly) rather than opening a second document on the
// PDFium engine. Renders the whole page into a canvas sized to the crop and
// offset so only the figure region is painted; a null bbox renders the whole
// page (scanned pages / failed pairing). Results are memo-cached per book so a
// figure card and the view_figure tool never re-raster the same crop.

import { loadPdfjs } from "../fulltext/extract";
import type { Figure } from "./types";

export interface RenderedFigure {
  dataUrl: string; // "data:image/jpeg;base64,…" for an <img src>
  base64: string; // bare base64 (no prefix) for a pi-ai image block
  mimeType: "image/jpeg";
}

export type FigureTier = "card" | "view";

// Target crop width in CSS pixels. The card is a chat thumbnail; the view tier
// feeds the vision model and stays under ~1024px / ~1 MB.
const TARGET_WIDTH: Record<FigureTier, number> = { card: 520, view: 1024 };
const MARGIN_PT = 6;
const MAX_SCALE = 4;
const JPEG_QUALITY = 0.82;

const cache = new Map<string, RenderedFigure>();

function key(hash: string, figureId: string, tier: FigureTier): string {
  return `${hash}:${figureId}:${tier}`;
}

// Drop cached crops. Called on book close/switch so only the open book's figures
// stay resident.
export function clearFigureCache(): void {
  cache.clear();
}

// One open pdf.js document per book, reused across a burst of figure renders and
// replaced when the book changes.
let docCache: { hash: string; doc: Promise<any> } | null = null;

async function getDoc(hash: string, buffer: ArrayBuffer): Promise<any> {
  if (docCache && docCache.hash === hash) return docCache.doc;
  const prev = docCache;
  const doc = (async () => {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(buffer.slice(0));
    return pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  })();
  docCache = { hash, doc };
  if (prev) prev.doc.then((d) => d.destroy()).catch(() => {});
  return doc;
}

// Render (or return the cached) figure crop. Resolves null when the crop can't
// be produced (no canvas, render failure) so callers fall back to a text chip.
export async function renderFigure(
  hash: string,
  buffer: ArrayBuffer,
  figure: Figure,
  tier: FigureTier,
): Promise<RenderedFigure | null> {
  const k = key(hash, figure.id, tier);
  const hit = cache.get(k);
  if (hit) return hit;
  try {
    const doc = await getDoc(hash, buffer);
    const page = await doc.getPage(figure.page);
    const base = page.getViewport({ scale: 1 });
    const pageW = base.width;
    const pageH = base.height;

    // Crop region in top-left page space (points), clamped to the page.
    let rx = 0;
    let ry = 0;
    let rw = pageW;
    let rh = pageH;
    if (figure.bbox && figure.bbox.width > 0 && figure.bbox.height > 0) {
      rx = Math.max(0, figure.bbox.x - MARGIN_PT);
      ry = Math.max(0, figure.bbox.y - MARGIN_PT);
      rw = Math.min(pageW - rx, figure.bbox.width + 2 * MARGIN_PT);
      rh = Math.min(pageH - ry, figure.bbox.height + 2 * MARGIN_PT);
    }

    const scale = Math.min(MAX_SCALE, Math.max(0.2, TARGET_WIDTH[tier] / rw));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rw * scale));
    canvas.height = Math.max(1, Math.round(rh * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // White backing so JPEG doesn't fill transparency with black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Shift the full-page render so the crop's top-left lands at the canvas
    // origin; pdf.js clips to the canvas, so only the region is painted.
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, -rx * scale, -ry * scale],
    }).promise;

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const out: RenderedFigure = { dataUrl, base64, mimeType: "image/jpeg" };
    cache.set(k, out);
    return out;
  } catch (e) {
    console.warn("failed to render figure", figure.id, e);
    return null;
  }
}
