// The decisions behind the library cover cache, kept away from the IO in
// covers.ts so they can be tested without a webview: what a cover is filed
// under, how large to raster it, when a cover that failed may be tried again,
// and how concurrent requests for the same book collapse into one render.

import { hashPath } from "../platform/app/storage";

// The part of a topic FileRef a cover is derived from (platform/app/topics.ts).
// Structural, so this module does not depend on the shelf's record shape.
export interface CoverRef {
  path: string;
  hash?: string;
}

const DIR = "covers";

// A cover is filed under the book id — the content hash of the file bytes, the
// same id library.ts stores the book under. A file replaced at the same path
// gets a different id, so a stale cover can never be served: invalidation is
// the key, not a rule on top of it.
export function coverImagePath(bookId: string): string {
  return `${DIR}/${bookId}.jpg`;
}

// Beside the cover, the record of why there isn't one. Read only when no cover
// image exists for the key, so a marker left behind by a book that later
// rendered is inert.
export function coverFailurePath(key: string): string {
  return `${DIR}/${key}.failed.json`;
}

// The key for a file whose bytes could not be read at all: with no bytes there
// is no book id, and the path is the only thing left to remember it by.
export function unreadableKey(path: string): string {
  return `path-${hashPath(path)}`;
}

// The key concurrent callers are deduplicated on. Derived from the ref alone,
// because the book id of a file that has never been opened is not known until
// its bytes have been read — and reading them is the work being deduplicated.
export function coverRequestKey(ref: CoverRef): string {
  return ref.hash ? `id-${ref.hash}` : unreadableKey(ref.path);
}

// A cover is shown at about a third of a library card's width on an iPad, so
// ~120 CSS px; rastered at 2x for retina. Wider is wasted bytes on the shelf's
// first paint, narrower is visibly soft.
export const COVER_CSS_WIDTH = 120;
export const COVER_DPR = 2;
export const COVER_WIDTH_PX = COVER_CSS_WIDTH * COVER_DPR;
export const COVER_JPEG_QUALITY = 0.8;

// US Letter, used when a page reports no usable width.
const FALLBACK_PAGE_WIDTH_PT = 612;
const MAX_SCALE = 4;
const MIN_SCALE = 0.05;

// The engine scale factor that renders a page of `pageWidthPt` points at
// COVER_WIDTH_PX pixels. Clamped so a degenerate page size cannot ask PDFium
// for a raster of an absurd size.
export function coverScaleFactor(pageWidthPt: number): number {
  const usable = Number.isFinite(pageWidthPt) && pageWidthPt > 0;
  const width = usable ? pageWidthPt : FALLBACK_PAGE_WIDTH_PT;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, COVER_WIDTH_PX / width));
}

export type CoverFailureReason =
  // The file's bytes could not be read (moved, deleted, permission).
  | "unreadable"
  // PDFium refused the document (corrupt, encrypted).
  | "open"
  // It opened, and has no page to render.
  | "no-pages"
  // Page one failed to raster.
  | "render";

export interface CoverFailure {
  reason: CoverFailureReason;
  // The engine's or the filesystem's own words, so a cover that never appears
  // can be diagnosed from the marker alone.
  message: string;
  // Which file this was, at the time it failed.
  path: string;
  name: string;
  at: number;
}

const REASONS: CoverFailureReason[] = ["unreadable", "open", "no-pages", "render"];

export function parseCoverFailure(raw: unknown): CoverFailure | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<CoverFailure>;
  if (!REASONS.includes(r.reason as CoverFailureReason)) return null;
  if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
  return {
    reason: r.reason as CoverFailureReason,
    message: typeof r.message === "string" ? r.message : "",
    path: typeof r.path === "string" ? r.path : "",
    name: typeof r.name === "string" ? r.name : "",
    at: r.at,
  };
}

// A recorded failure stops the shelf from re-rendering the same broken file on
// every visit. It expires so a file that was merely offline (an unmounted
// volume, a cloud file not downloaded yet) is not written off forever.
export const COVER_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export function coverRetryDue(failure: CoverFailure | null, now: number): boolean {
  if (!failure) return true;
  return now - failure.at >= COVER_RETRY_AFTER_MS;
}

export interface SingleFlight<T> {
  run(key: string, work: () => Promise<T>): Promise<T>;
}

// Runs `work` once per key: callers that arrive while it is in flight join the
// same promise, and the settled value is kept, so a card that re-renders does
// not re-read the cover off disk. A rejection is dropped rather than kept —
// only resolved values are answers.
export function createSingleFlight<T>(): SingleFlight<T> {
  const entries = new Map<string, Promise<T>>();
  return {
    run(key, work) {
      const existing = entries.get(key);
      if (existing) return existing;
      const started = work();
      entries.set(key, started);
      started.catch(() => {
        if (entries.get(key) === started) entries.delete(key);
      });
      return started;
    },
  };
}
