// Reading a pasted http(s) link, pure (docs/09 link ingestion). Recognises an
// http(s) URL, reads a provisional title and a slug stem out of it (both refined
// after the fetch), and sniffs a fetched response's content type. Nothing here
// knows the prep model: turning a read link into the record a pipeline stores is
// that pipeline's job (prep/papers/plan.ts's resolveUrlAddition). No IO either —
// prep/papers/live.ts wires these to the http plugin; tests drive them directly.

export function looksLikeHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

export function isHttpsUrl(s: string): boolean {
  return /^https:\/\//i.test(s.trim());
}

// A short slug stem from the URL: the filename (last path segment, extension
// dropped) when it carries one, else the hostname. Raw text — the caller runs it
// through its own slugify, which does the cleanup.
export function slugBaseFromUrl(url: string): string {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname;
  } catch {
    return "source";
  }
  const segs = path.split("/").filter(Boolean);
  // Drop a file extension (.html/.pdf/...) but not a numeric suffix like an
  // arXiv id's ".12345" — extensions start with a letter.
  const last = segs.length ? segs[segs.length - 1].replace(/\.[a-z][a-z0-9]{0,4}$/i, "") : "";
  const base = last || host;
  return decodeURIComponent(base);
}

// A human-ish provisional title until the real one is read from PDF metadata or
// the article's <title>: hostname + path, e.g. "arxiv.org/abs/2303.12345".
export function provisionalTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return decodeURIComponent(host + path);
  } catch {
    return url.trim();
  }
}

// Everything a pasted link says about itself before anything is fetched. The
// boundary type: this side reads it, the prep side records it.
export interface UrlSource {
  // The trimmed URL, the fetch target.
  url: string;
  title: string;
  // Stem for the slug, not yet slugified or deduplicated.
  slugBase: string;
}

// Read a pasted link. Throws on a non-https URL so the caller (ingest_url tool /
// PrepPanel) can surface a clear rejection.
export function resolveUrlSource(url: string): UrlSource {
  const trimmed = url.trim();
  if (!isHttpsUrl(trimmed)) {
    throw new Error("Only https URLs can be ingested.");
  }
  return {
    url: trimmed,
    title: provisionalTitleFromUrl(trimmed),
    slugBase: slugBaseFromUrl(trimmed),
  };
}

export type SniffedKind = "pdf" | "epub" | "html";

// Decide whether a fetched response is a PDF or an HTML page. The magic bytes
// win (a "%PDF" prefix is definitive even when the server mislabels it); the
// content-type header is the fallback.
export function sniffContentType(firstBytes: Uint8Array, contentType?: string | null): SniffedKind {
  // "%PDF" == 0x25 0x50 0x44 0x46.
  if (
    firstBytes.length >= 4 &&
    firstBytes[0] === 0x25 &&
    firstBytes[1] === 0x50 &&
    firstBytes[2] === 0x44 &&
    firstBytes[3] === 0x46
  ) {
    return "pdf";
  }
  // "PK\x03\x04" plus the container's mimetype string. This one is a header
  // sniff on the first bytes of a response, so it reads the layout the format
  // requires — mimetype first, stored, so its content sits in the clear right
  // after the local header. A book repacked by an ordinary zip tool fails this
  // and is recognised from the whole file instead (reading/epub/sniff.ts); no
  // prefix of the bytes can answer for the central directory.
  if (
    firstBytes.length >= 4 &&
    firstBytes[0] === 0x50 &&
    firstBytes[1] === 0x4b &&
    firstBytes[2] === 0x03 &&
    firstBytes[3] === 0x04
  ) {
    if (indexOfAscii(firstBytes, "application/epub+zip") >= 0) return "epub";
  }
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/pdf")) return "pdf";
  if (ct.includes("application/epub+zip")) return "epub";
  return "html";
}

// A byte-wise search for an ASCII needle. No TextDecoder: the bytes are the head
// of a zip, and decoding compressed data as UTF-8 is meaningless work.
function indexOfAscii(haystack: Uint8Array, needle: string): number {
  const limit = haystack.length - needle.length;
  outer: for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}
