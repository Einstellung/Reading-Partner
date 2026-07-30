// Reading a pasted http(s) link, pure (docs/09 link ingestion). Recognises an
// http(s) URL, reads a provisional title and a slug stem out of it (both refined
// after the fetch), and sniffs a fetched response's content type. Nothing here
// knows the prep model: turning a read link into the record the pipeline stores
// is prep's job (resolveUrlAddition in plan.ts). No IO either — live.ts wires
// these to readingFetch; tests drive them directly.

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

// Read a pasted link. Throws on a non-https URL so the caller (add_source tool /
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

export type SniffedKind = "pdf" | "html";

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
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/pdf")) return "pdf";
  return "html";
}
