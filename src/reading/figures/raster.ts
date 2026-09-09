// The view tier's re-encode of an EPUB figure (docs/39 §3). A PDF figure is cut
// out of a rendered page; an EPUB's is a file the publisher shipped, and that
// file is what the model gets — except for the two kinds it cannot be handed:
// an SVG, which no vision model accepts, and a picture over the tier's byte cap.
// Both are drawn onto a canvas and re-encoded as JPEG.
//
// The canvas belongs to the webview and lives in render.ts. Everything that
// decides — raster or send as-is, at what pixel size, and whether what came back
// is small enough — is here behind an injected Rasterizer, so it is unit-tested
// with no DOM.

import { base64Bytes, scaledSize } from "../../ai/image-utils";

// What the view tier will send. Past this a picture is redrawn smaller; the
// provider's own hard limit is five times this (docs/05), so the cap is about
// tokens and latency, not about being refused.
export const VIEW_MAX_BYTES = 1024 * 1024;

// Long edge of a redrawn figure. Anthropic downsamples anything past this, so
// pixels beyond it are paid for and thrown away (ai/image-utils, docs/05).
export const RASTER_MAX_EDGE = 1568;

// A vector picture that states no size of its own is drawn at this square.
export const SVG_DEFAULT_EDGE = 1024;

// Shrinking stops here. Below it the picture has stopped being worth looking at,
// and something other than pixel count is what is large about it.
export const MIN_RASTER_EDGE = 320;

// How far under the cap a shrink pass aims. JPEG bytes do not fall exactly with
// pixel count, and undershooting once beats converging from above over three
// passes.
const SHRINK_MARGIN = 0.95;

// Passes after the first. Each one lands closer than the last; a picture still
// over the cap after this many is sent as it is rather than reduced to nothing.
const MAX_SHRINK_PASSES = 3;

export const SVG_MIME = "image/svg+xml";

export interface RasterSize {
  width: number;
  height: number;
}

// Send the publisher's own file, or redraw it — and if redrawn, which of the two
// reasons, because a vector is redrawn at any size and a bitmap only because of
// its bytes.
export type EpubViewPlan = { action: "send" } | { action: "raster"; reason: "vector" | "oversize" };

export function planEpubView(
  mimeType: string,
  byteLength: number,
  maxBytes: number = VIEW_MAX_BYTES,
): EpubViewPlan {
  if (mimeType === SVG_MIME) return { action: "raster", reason: "vector" };
  if (byteLength > maxBytes) return { action: "raster", reason: "oversize" };
  return { action: "send" };
}

/**
 * Pixel size to draw at. A bitmap keeps the publisher's own pixels, capped at
 * the long edge; a vector has no pixels of its own, so it is drawn to the cap
 * whether that is up or down from the size it declares.
 */
export function rasterSize(width: number, height: number, vector: boolean): RasterSize {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (!vector) return scaledSize(w, h, RASTER_MAX_EDGE);
  const scale = RASTER_MAX_EDGE / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * The size to try next after a pass came back over the cap, or null when it fits
 * or cannot usefully shrink further. JPEG bytes fall roughly with pixel count,
 * so the scale is the square root of how far over it was; the result is always
 * strictly smaller than what went in, so the loop cannot spin.
 */
export function shrinkToFit(
  size: RasterSize,
  bytes: number,
  maxBytes: number = VIEW_MAX_BYTES,
  minEdge: number = MIN_RASTER_EDGE,
): RasterSize | null {
  if (bytes <= maxBytes) return null;
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= minEdge) return null;
  const ratio = Math.sqrt(maxBytes / bytes) * SHRINK_MARGIN;
  const nextEdge = Math.max(minEdge, Math.floor(longEdge * ratio));
  if (nextEdge >= longEdge) return null;
  return scaledSize(size.width, size.height, nextEdge);
}

const LENGTH = /^\s*([0-9.]+)\s*(px)?\s*$/i;

function length(raw: string | null): number | null {
  if (!raw) return null;
  const m = LENGTH.exec(raw);
  if (!m) return null; // a percentage, an em, anything relative: the viewBox answers instead
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`[\\s]${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function rootTag(svg: string): string {
  const open = svg.search(/<svg[\s>]/i);
  if (open < 0) return "";
  const close = svg.indexOf(">", open);
  return close < 0 ? svg.slice(open) : svg.slice(open, close + 1);
}

/**
 * The size an SVG says it is: its width and height when they are absolute, else
 * the viewBox, else a default square. Read out of the text rather than off the
 * decoded image because a drawing that states none of the three is laid out at
 * the CSS default of 300x150, which is a shape, not the drawing's own
 * (docs/pitfall/263).
 */
export function svgIntrinsicSize(svg: string, defaultEdge: number = SVG_DEFAULT_EDGE): RasterSize {
  const tag = rootTag(svg);
  const w = length(attr(tag, "width"));
  const h = length(attr(tag, "height"));
  if (w && h) return { width: w, height: h };

  const box = attr(tag, "viewBox");
  const nums = box ? box.trim().split(/[\s,]+/).map(Number) : [];
  const boxW = nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 ? nums[2] : null;
  const boxH = nums.length === 4 && nums.every(Number.isFinite) && nums[3] > 0 ? nums[3] : null;
  if (boxW && boxH) {
    // One absolute side plus the box's aspect ratio still pins the drawing.
    if (w) return { width: w, height: Math.max(1, Math.round((w * boxH) / boxW)) };
    if (h) return { width: Math.max(1, Math.round((h * boxW) / boxH)), height: h };
    return { width: boxW, height: boxH };
  }
  if (w) return { width: w, height: w };
  if (h) return { width: h, height: h };
  return { width: defaultEdge, height: defaultEdge };
}

/**
 * The same SVG with width and height stated on its root, so the box it is laid
 * out in is the one that was computed for it rather than whatever the engine
 * would default to.
 */
export function withExplicitSize(svg: string, size: RasterSize): string {
  const tag = rootTag(svg);
  if (!tag) return svg;
  const stripped = tag
    .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s*\/?>$/, "");
  const rewritten = `${stripped} width="${size.width}" height="${size.height}"${tag.endsWith("/>") ? "/>" : ">"}`;
  return svg.replace(tag, rewritten);
}

/** A decoded picture the webview can draw. Its size is 0 when it would not say. */
export interface RasterImage {
  width: number;
  height: number;
  /** Draw onto white at this size and encode as JPEG. Bare base64, no prefix. */
  encode: (size: RasterSize) => Promise<string>;
  release: () => void;
}

export interface Rasterizer {
  /** Decode bytes of this type, or null when the webview will not take them. */
  decode: (bytes: Uint8Array, mimeType: string) => Promise<RasterImage | null>;
}

export interface RasterResult {
  base64: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

/**
 * Redraw one archived picture for the view tier. SVG text is given an explicit
 * size before it is handed over, and what an SVG references outside itself — a
 * font, another archive entry through <image href> — is not resolved: it is
 * drawn as a lone document, which is what a browser does with an SVG in an
 * <img> anyway.
 *
 * Resolves null when the picture will not decode, and the caller falls back the
 * way it does for a PDF crop that would not render.
 */
export async function rasterizeEpubFigure(
  bytes: Uint8Array,
  mimeType: string,
  rasterizer: Rasterizer,
  maxBytes: number = VIEW_MAX_BYTES,
): Promise<RasterResult | null> {
  const vector = mimeType === SVG_MIME;
  let source = bytes;
  let declared: RasterSize | null = null;
  if (vector) {
    const text = new TextDecoder("utf-8").decode(bytes);
    declared = svgIntrinsicSize(text);
    source = new TextEncoder().encode(withExplicitSize(text, declared));
  }

  const image = await rasterizer.decode(source, mimeType);
  if (!image) return null;
  try {
    const natural =
      image.width > 0 && image.height > 0 ? { width: image.width, height: image.height } : declared;
    if (!natural) return null;
    let size = rasterSize(natural.width, natural.height, vector);
    let base64 = await image.encode(size);
    for (let pass = 0; pass < MAX_SHRINK_PASSES; pass++) {
      const next = shrinkToFit(size, base64Bytes(base64), maxBytes);
      if (!next) break;
      size = next;
      base64 = await image.encode(size);
    }
    return { base64, mimeType: "image/jpeg", width: size.width, height: size.height };
  } finally {
    image.release();
  }
}
