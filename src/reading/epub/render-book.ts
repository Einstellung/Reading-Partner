// The book object foliate-js renders from (docs/39 §2). foliate takes the
// archive as an interface — loadText, loadBlob, getSize — rather than as an
// implementation, which is the whole reason it was chosen: the sanitizing sits
// here, between the archive and the renderer, instead of being a repair applied
// afterwards.
//
// The one thing worth stating twice: a spine document's text is the sanitized
// markup, never the archive's. The ingestion computed every position block's
// CFI against the sanitized tree (paginate.ts, cfi.ts), and a CFI addresses
// nodes by their index among their siblings — so if the renderer were handed
// the raw document, every locator would point at a different node. Same bytes
// in, same tree out, one position language for both halves.
//
// A consequence, and it is a deliberate one: the sanitizer drops <style> and
// <link>, so a book's own stylesheet never reaches the page. The book is set in
// the app's typography instead (reader-styles.ts). Keeping the publisher's CSS
// would mean either letting it into the sanitized tree — which the ingestion
// also walks — or handing the renderer a different document than the one the
// positions were computed against.

import type { EpubBook } from "./parse";

/** What foliate's EPUB constructor is handed. */
export interface RenderLoader {
  loadText(href: string): string | null;
  loadBlob(href: string): Blob | null;
  getSize(href: string): number;
  sha1(data: ArrayBuffer | Uint8Array): Promise<string>;
}

// Blob types, by extension. A blob with the wrong type is not a rendering
// nicety: an XHTML document served as octet-stream is downloaded rather than
// parsed, and a font with no type does not load.
const MIME: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  ncx: "application/x-dtbncx+xml",
  opf: "application/oebps-package+xml",
  xml: "application/xml",
};

export function mimeOf(href: string): string {
  const dot = href.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME[href.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

// foliate resolves manifest hrefs against the package document and hands them
// back percent-decoded or not depending on how the book spelled them; the
// archive's own names are the raw entry names. Both spellings are tried, in the
// order that costs nothing when the first one hits.
function entryNames(href: string): string[] {
  const names = [href];
  try {
    const decoded = decodeURIComponent(href);
    if (decoded !== href) names.push(decoded);
  } catch {
    // A stray "%" is part of the name, not an escape.
  }
  return names;
}

/**
 * The archive side of the book, with every spine document replaced by its
 * sanitized markup.
 */
export function renderLoader(book: EpubBook): RenderLoader {
  const sanitized = new Map(book.docs.map((d) => [d.entry, d.html]));
  const decoder = new TextDecoder();

  const find = <T,>(href: string, read: (name: string) => T | null): T | null => {
    for (const name of entryNames(href)) {
      const value = read(name);
      if (value !== null) return value;
    }
    return null;
  };

  return {
    loadText: (href) =>
      find(href, (name) => {
        const clean = sanitized.get(name);
        if (clean !== undefined) return clean;
        const text = book.zip.text(name);
        if (text !== null) return text;
        const bytes = book.zip.bytes(name);
        return bytes ? decoder.decode(bytes) : null;
      }),
    loadBlob: (href) =>
      find(href, (name) => {
        const clean = sanitized.get(name);
        if (clean !== undefined) return new Blob([clean], { type: mimeOf(name) });
        const bytes = book.zip.bytes(name);
        // A fresh copy: the Blob keeps a reference to the buffer it is given,
        // and the lazy zip caches that same array for the next reader.
        return bytes ? new Blob([bytes.slice() as unknown as BlobPart], { type: mimeOf(name) }) : null;
      }),
    getSize: (href) => {
      for (const name of entryNames(href)) {
        const hit = book.zip.entries.find((e) => e.name === name);
        if (hit) return hit.size;
      }
      return 0;
    },
    // Font deobfuscation. Available under the custom protocol: it is a secure
    // context and SHA-1 is present on both backends (docs/62 §5).
    sha1: async (data) => {
      const buf = await crypto.subtle.digest("SHA-1", data as BufferSource);
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}

/** What the reading pane hands `view.open()`. */
export interface RenderBook {
  // resolveHref turns a link the book wrote — relative to the section it sits
  // in — into one the renderer can navigate to.
  sections: { id: string; size: number; resolveHref?(href: string): string }[];
  destroy(): void;
}

/**
 * Build the renderer's book. The import is dynamic so nothing that merely reads
 * this module pulls foliate — and its seven throwing stubs (docs/pitfall/243) —
 * into a test process.
 */
export async function createRenderBook(book: EpubBook): Promise<RenderBook> {
  const { EPUB } = await import("foliate-js/epub.js");
  return (await new EPUB(renderLoader(book)).init()) as unknown as RenderBook;
}
