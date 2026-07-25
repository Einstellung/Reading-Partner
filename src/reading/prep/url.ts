// User-pasted-link resolution, pure (docs/09 link ingestion). Turns an http(s)
// URL into a PrepPaper stub with a provisional title/slug (both refined after
// the fetch), and sniffs a fetched response's content type. No IO here — live.ts
// wires these to prepFetch; tests drive them directly.

import { slugify, uniqueSlug } from "./plan";
import type { PrepPaper } from "./types";

export function looksLikeHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

export function isHttpsUrl(s: string): boolean {
  return /^https:\/\//i.test(s.trim());
}

// A short slug base from the URL: the filename (last path segment, extension
// dropped) when it carries one, else the hostname. slugify handles the cleanup.
export function slugFromUrl(url: string): string {
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
  return slugify(decodeURIComponent(base));
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

// Build the queued PrepPaper stub for a pasted URL. Throws on a non-https URL so
// the caller (add_source tool / PrepPanel) can surface a clear rejection.
export function resolveUrlAddition(url: string, taken: Set<string>): PrepPaper {
  const trimmed = url.trim();
  if (!isHttpsUrl(trimmed)) {
    throw new Error("Only https URLs can be ingested.");
  }
  return {
    slug: uniqueSlug(taken, slugFromUrl(trimmed)),
    title: provisionalTitleFromUrl(trimmed),
    authors: [],
    year: null,
    arxivId: null,
    citedInChapters: [],
    reason: "added by the user",
    status: "queued",
    addedByUser: true,
    sourceUrl: trimmed,
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
