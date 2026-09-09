// Figure rasterization (M9), browser only. Crops a figure from its page with
// the already-loaded pdf.js (the same library that produced the bbox, so the
// coordinate spaces match exactly) rather than opening a second document on the
// PDFium engine. Renders the whole page into a canvas sized to the crop and
// offset so only the figure region is painted; a null bbox renders the whole
// page (scanned pages / failed pairing). Results are memo-cached per book so a
// figure card and the view_figure tool never re-raster the same crop.

import { loadPdfjs } from "../../fulltext/extract";
import { openZip } from "../epub/zip";
import { pdfBBox, type Figure } from "./types";

export interface RenderedFigure {
  dataUrl: string; // "data:image/jpeg;base64,…" for an <img src>
  base64: string; // bare base64 (no prefix) for a pi-ai image block
  mimeType: string; // "image/jpeg" for a crop; an EPUB's own type for an entry
  width: number; // natural pixel width of the crop, 0 when it was not measured
  height: number; // natural pixel height of the crop
}

export type FigureTier = "card" | "view";

// The card renders at a fixed 2x page scale for crispness; the display width is
// then capped to the crop's natural size (see cardDisplayWidth) so a small figure
// is shown at its true size, never upscaled. The view tier feeds the vision model
// and scales small crops up toward ~1024px, capped so it stays legible / <~1 MB.
const CARD_PAGE_SCALE = 2;
const VIEW_TARGET_WIDTH = 1024;
const VIEW_MAX_SCALE = 3;
const MARGIN_PT = 6;
const JPEG_QUALITY = 0.82;

// Render scale for a crop `rw` points wide. Card: fixed 2x. View: fill the target
// width but never below 2x (small figures still get pixels) nor above VIEW_MAX_SCALE.
function cropScale(tier: FigureTier, rw: number): number {
  if (tier === "card") return CARD_PAGE_SCALE;
  return Math.min(VIEW_MAX_SCALE, Math.max(CARD_PAGE_SCALE, VIEW_TARGET_WIDTH / Math.max(1, rw)));
}

// CSS width to display a crop at: its natural pixel width divided by the device
// pixel ratio, so a 2x-rendered crop shows at 1x logical size and is never
// upscaled past its own resolution. The container still caps it via max-width.
export function cardDisplayWidth(naturalWidthPx: number, devicePixelRatio: number): number {
  return naturalWidthPx / Math.max(1, devicePixelRatio || 1);
}

// A whole page is rendered at a lower JPEG quality than a figure crop: the
// visual window sends up to three of them every turn and the artefacts that
// would matter on a 200px-wide plot are invisible across a full page.
const PAGE_JPEG_QUALITY = 0.72;

const cache = new Map<string, RenderedFigure>();

// An EPUB's figure is a file in the archive, so there is nothing to raster: the
// publisher's own picture at the publisher's own resolution is better than
// anything a re-render could produce, and it costs one inflate.
//
// TODO (docs/39 §3, stage 5): an SVG has to be drawn to a canvas before a vision
// model can be handed it, and a picture over the ~1 MB the view tier allows has
// to be scaled down. Neither is done here — an SVG and an oversized JPEG are
// both returned as they are — because both need a canvas and this stage runs
// headless.
const EPUB_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function epubImageType(href: string): string | null {
  const dot = href.lastIndexOf(".");
  if (dot < 0) return null;
  return EPUB_IMAGE_TYPES[href.slice(dot + 1).toLowerCase()] ?? null;
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: String.fromCharCode spread over a multi-megabyte array overflows
  // the argument list.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function renderEpubFigure(buffer: ArrayBuffer, href: string): RenderedFigure | null {
  const mimeType = epubImageType(href);
  if (!mimeType) return null;
  let bytes: Uint8Array | null = null;
  try {
    bytes = openZip(new Uint8Array(buffer)).bytes(href);
  } catch (e) {
    console.warn("failed to read a figure out of the book", href, e);
    return null;
  }
  if (!bytes) return null;
  const base64 = base64Of(bytes);
  return { dataUrl: `data:${mimeType};base64,${base64}`, base64, mimeType, width: 0, height: 0 };
}

function key(hash: string, figureId: string, tier: FigureTier): string {
  return `${hash}:${figureId}:${tier}`;
}

// Cache key for a whole-page render. "@" cannot appear in a figure id, so page
// renders and figure crops share the map without colliding.
function pageKey(hash: string, page: number, widthPx: number): string {
  return `${hash}:page-${page}@${widthPx}`;
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
  if (figure.source.kind === "epub") {
    const out = renderEpubFigure(buffer, figure.source.href);
    if (out) cache.set(k, out);
    return out;
  }
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
    const bbox = pdfBBox(figure);
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      rx = Math.max(0, bbox.x - MARGIN_PT);
      ry = Math.max(0, bbox.y - MARGIN_PT);
      rw = Math.min(pageW - rx, bbox.width + 2 * MARGIN_PT);
      rh = Math.min(pageH - ry, bbox.height + 2 * MARGIN_PT);
    }

    const scale = cropScale(tier, rw);
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
    const out: RenderedFigure = {
      dataUrl,
      base64,
      mimeType: "image/jpeg",
      width: canvas.width,
      height: canvas.height,
    };
    cache.set(k, out);
    return out;
  } catch (e) {
    console.warn("failed to render figure", figure.id, e);
    return null;
  }
}

// Render one whole page to a target pixel width, for the visual window around a
// highlight (page-window.ts). Same document cache and same memo as the figure
// crops, so a follow-up question on the same mark re-uses the pixels rather than
// re-rasterizing three pages. Resolves null when the page cannot be produced —
// off the end of the document, no canvas, a render failure — and the caller
// simply sends one image fewer.
export async function renderPageImage(
  hash: string,
  buffer: ArrayBuffer,
  page: number,
  widthPx: number,
): Promise<RenderedFigure | null> {
  const k = pageKey(hash, page, widthPx);
  const hit = cache.get(k);
  if (hit) return hit;
  try {
    const doc = await getDoc(hash, buffer);
    if (page < 1 || page > doc.numPages) return null;
    const pdfPage = await doc.getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = widthPx / Math.max(1, base.width);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", PAGE_JPEG_QUALITY);
    const out: RenderedFigure = {
      dataUrl,
      base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      mimeType: "image/jpeg",
      width: canvas.width,
      height: canvas.height,
    };
    cache.set(k, out);
    return out;
  } catch (e) {
    console.warn("failed to render page", page, e);
    return null;
  }
}
