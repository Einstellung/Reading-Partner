// Putting one spine document on the paper: the shadow root a page card and the
// ruler both fill (docs/64). The sanitized document's <html> element is cloned
// whole into a multi-column box the size of the text block, so column k of the
// layout is page k of the document. Nothing is added inside that <html>
// element — the baseline stylesheet, the clip box and the overlay sit beside
// it — which is what keeps a CFI computed on the ingestion's tree true on this
// one (cfi.ts).
//
// The book's resources are answered from the archive as blob URLs: an <img>'s
// src, an SVG image's href, a linked stylesheet (inlined, sanitized, its own
// urls rewritten) and the url()s of a <style>. Attribute values change; the
// tree's shape does not.

import { SHIPPED_FONT_STACK, rewriteCssUrls, sanitizeCss } from "./css-sanitize";
import {
  BASE_FONT_PX,
  BASE_LINE_HEIGHT,
  BODY_HEIGHT,
  BODY_WIDTH,
  PAGE_HEIGHT,
  PAGE_PAD_X,
  PAGE_PAD_Y,
  PAGE_WIDTH,
} from "./page-geometry";
import type { SpineDocument } from "./parse";
import { XLINK_NS } from "./sanitize";
import { resolveZipPath, type EpubZip } from "./zip";

/** The faces shipped in public/fonts, declared in styles.css. */
export const READING_FONT_STACK = SHIPPED_FONT_STACK;

// The baseline under the book's CSS. Everything a book is likely to restyle
// is set without !important so the book wins; the box geometry is on elements
// the book cannot name.
export const BASELINE_CSS = `
.rp-clip {
  position: absolute;
  left: ${PAGE_PAD_X}px;
  top: ${PAGE_PAD_Y}px;
  width: ${BODY_WIDTH}px;
  height: ${BODY_HEIGHT}px;
  overflow: hidden;
  contain: paint;
}
.rp-columns {
  width: ${BODY_WIDTH}px;
  height: ${BODY_HEIGHT}px;
  column-width: ${BODY_WIDTH}px;
  column-gap: 0;
  column-fill: auto;
  will-change: transform;
}
.rp-overlay {
  position: absolute;
  inset: 0;
  width: ${PAGE_WIDTH}px;
  height: ${PAGE_HEIGHT}px;
  pointer-events: none;
}
html {
  display: block;
  font-family: ${READING_FONT_STACK};
  font-size: ${BASE_FONT_PX}px;
  line-height: ${BASE_LINE_HEIGHT};
  color: #1c1c1c;
  -webkit-hyphens: auto;
  hyphens: auto;
  overflow-wrap: break-word;
  text-rendering: optimizeLegibility;
}
head { display: none; }
body { display: block; margin: 0; padding: 0; }
p { margin: 0 0 0.75em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; break-after: avoid; }
img, svg, video { max-width: 100%; max-height: ${BODY_HEIGHT}px; height: auto; break-inside: avoid; }
figure { margin: 1em 0; break-inside: avoid; }
table { border-collapse: collapse; break-inside: auto; max-width: 100%; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: inherit; }
/* The one place the book does not get a say. The marks read a caret out of the
   sheet themselves and never use the system selection, so a long press here
   must raise nothing (docs/pitfall/49, 262) — and a touch on the sheet
   belongs to the desk's own scroll (docs/pitfall/37). Inheritance from the host
   would carry the first two in, but a book that sets user-select on its own
   body would take them back, which is what the !important is for. */
html, body {
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-touch-callout: none !important;
  touch-action: none !important;
}
`;

/** What answers the book's resource references. */
export interface PageResources {
  /** A blob URL for an archive entry, or null when the entry is absent. */
  url(entry: string): string | null;
  zip: EpubZip;
}

/**
 * Blob URLs for the archive, one per entry, alive until `revoke()`. A copy of
 * the bytes goes into each blob: the lazy zip caches the array it inflated and
 * a Blob keeps the buffer it is handed.
 */
export function createPageResources(zip: EpubZip): PageResources & { revoke(): void } {
  const urls = new Map<string, string>();
  return {
    zip,
    url(entry) {
      const hit = urls.get(entry);
      if (hit !== undefined) return hit;
      const bytes = zip.bytes(entry);
      if (!bytes) return null;
      const url = URL.createObjectURL(
        new Blob([bytes.slice() as unknown as BlobPart], { type: mimeOf(entry) }),
      );
      urls.set(entry, url);
      return url;
    },
    revoke() {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

const MIME: Record<string, string> = {
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function mimeOf(entry: string): string {
  const dot = entry.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME[entry.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

/** A sanitized stylesheet entry with its url()s answered from the archive. */
function inlineStylesheet(res: PageResources, cssEntry: string): string {
  const source = res.zip.text(cssEntry);
  if (source === null) return "";
  const has = (entry: string) => res.zip.has(entry);
  const clean = sanitizeCss(source, {
    resolveUrl: (raw) => {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith("#")) return null;
      const entry = resolveZipPath(cssEntry, raw);
      return has(entry) ? raw : null;
    },
  });
  return rewriteCssUrls(clean, (raw) => res.url(resolveZipPath(cssEntry, raw)));
}

function rewriteResources(html: Element, doc: SpineDocument, res: PageResources): void {
  const from = doc.entry;
  for (const img of Array.from(html.getElementsByTagName("img"))) {
    const src = img.getAttribute("src");
    if (!src || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) continue;
    const url = res.url(resolveZipPath(from, src));
    if (url) img.setAttribute("src", url);
    else img.removeAttribute("src");
  }
  for (const image of Array.from(html.getElementsByTagNameNS("*", "image"))) {
    const href = image.getAttributeNS(XLINK_NS, "href") ?? image.getAttribute("href");
    if (!href || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) continue;
    const url = res.url(resolveZipPath(from, href));
    if (url) {
      if (image.hasAttributeNS(XLINK_NS, "href")) image.setAttributeNS(XLINK_NS, "xlink:href", url);
      else image.setAttribute("href", url);
    }
  }
  for (const link of Array.from(html.getElementsByTagName("link"))) {
    const href = link.getAttribute("href");
    const style = html.ownerDocument.createElement("style");
    style.textContent = href ? inlineStylesheet(res, resolveZipPath(from, href)) : "";
    link.replaceWith(style);
  }
  for (const style of Array.from(html.getElementsByTagName("style"))) {
    if (style.textContent) {
      style.textContent = rewriteCssUrls(style.textContent, (raw) => res.url(resolveZipPath(from, raw)));
    }
  }
  for (const el of Array.from(html.querySelectorAll("[style]"))) {
    const value = el.getAttribute("style");
    if (value && value.includes("url(")) {
      el.setAttribute("style", rewriteCssUrls(value, (raw) => res.url(resolveZipPath(from, raw))));
    }
  }
}

export interface MountedDocument {
  /** The cloned <html>: the content root every CFI is resolved against. */
  root: Element;
  clip: HTMLElement;
  columns: HTMLElement;
  overlay: HTMLElement;
  /** Resolves once the pictures that decide the layout have loaded (or given up). */
  ready: Promise<void>;
}

// How long a picture may take before the layout goes ahead without it. The
// blobs are local; a second is an image that will not decode.
const IMAGE_WAIT_MS = 1500;

function imagesSettled(root: Element): Promise<void> {
  const imgs = Array.from(root.getElementsByTagName("img")).filter((i) => !i.complete);
  if (imgs.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = imgs.length;
    const done = () => {
      if (--left === 0) resolve();
    };
    const timer = setTimeout(resolve, IMAGE_WAIT_MS);
    for (const img of imgs) {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    }
    void timer;
  });
}

/**
 * Fill a shadow root with one spine document on the paper. Replaces whatever
 * the root held.
 */
export function mountDocument(shadow: ShadowRoot, doc: SpineDocument, res: PageResources): MountedDocument {
  const owner = shadow.ownerDocument;
  shadow.replaceChildren();
  const base = owner.createElement("style");
  base.textContent = BASELINE_CSS;
  const clip = owner.createElement("div");
  clip.className = "rp-clip";
  const columns = owner.createElement("div");
  columns.className = "rp-columns";
  const root = owner.importNode(doc.doc.documentElement, true);
  rewriteResources(root, doc, res);
  columns.append(root);
  clip.append(columns);
  const overlay = owner.createElement("div");
  overlay.className = "rp-overlay";
  shadow.append(base, clip, overlay);
  return { root, clip, columns, overlay, ready: imagesSettled(root) };
}

/** The reading faces, loaded before anything is measured against them. */
export async function readingFontsReady(): Promise<void> {
  const fonts = (globalThis.document as Document | undefined)?.fonts;
  if (!fonts) return;
  await Promise.all([
    fonts.load(`${BASE_FONT_PX}px "Noto Serif"`),
    fonts.load(`bold ${BASE_FONT_PX}px "Noto Serif"`),
    fonts.load(`italic ${BASE_FONT_PX}px "Noto Serif"`),
    fonts.load(`${BASE_FONT_PX}px "Noto Serif CJK SC"`, "中"),
  ]).catch(() => undefined);
  await fonts.ready;
}
