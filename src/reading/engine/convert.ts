// Pure, headless converters between the shell's zotero-schema annotations (what
// the host persists) and EmbedPDF's PdfAnnotationObject model. No engine or DOM
// access — every transform is a function of the annotation plus the page height,
// so it is unit-testable under `bun test` the same way src/fulltext is.
//
// Coordinate systems (spike item 3, verified — see docs/07 and the harness):
//   - zotero  position.rects: [left, yBottom, right, yTop] in PDF points,
//     bottom-left origin, yBottom < yTop.
//   - EmbedPDF Rect: { origin:{x,y}, size:{w,h} } in page space, TOP-LEFT origin
//     (y grows downward). Confirmed by renderPageRect's "top-left quadrant is
//     origin (0,0)" example and by the round-trip harness.
// The bridge is a Y flip about the page height H; x is unchanged.

import { PdfAnnotationSubtype } from "@embedpdf/models";
import type {
  PdfAnnotationObject,
  PdfHighlightAnnoObject,
  PdfInkAnnoObject,
  PdfUnderlineAnnoObject,
  Rect,
} from "@embedpdf/models";

// The shell's annotation is intentionally loose: the engine round-trips unknown
// fields untouched, so we only name what we read/write here.
export interface ZoteroAnnotation {
  id: string;
  type: string;
  color?: string;
  comment?: string;
  text?: string;
  tags?: unknown[];
  sortIndex?: string;
  pageLabel?: string;
  position?: {
    pageIndex: number;
    rects?: number[][];
    paths?: number[][];
    width?: number;
  };
  dateCreated?: string;
  dateModified?: string;
  authorName?: string;
  aiThreadId?: string;
  starred?: boolean;
  [key: string]: unknown;
}

// Fields the shell owns that PdfAnnotationObject has no first-class home for.
// They ride along in `custom` (round-trips through export/import/update — spike
// item 7). Anything already modeled by EmbedPDF (color, opacity, geometry) is
// NOT duplicated here.
interface ShellCustom {
  schema: "reading-partner/v1";
  text?: string;
  tags?: unknown[];
  pageLabel?: string;
  aiThreadId?: string;
  starred?: boolean;
  dateCreated?: string;
  // The zotero 8-char key, kept only when migrating legacy data so a trace can
  // be matched back to its old id. New annotations use EmbedPDF's uuid as id.
  legacyId?: string;
}

const DEFAULT_OPACITY = 0.4;

function pad(n: number, width: number): string {
  const v = Math.max(0, Math.round(n));
  return String(v).padStart(width, "0");
}

// Document-order key that sorts lexicographically into (page, top-to-bottom,
// left-to-right). EmbedPDF has no sortIndex; TraceList still sorts on this
// string, so we synthesize an equivalent from the top-left page coordinates.
// `topY` is the distance from the top of the page (EmbedPDF origin.y), so a
// smaller value is higher on the page and therefore earlier.
export function makeSortIndex(pageIndex: number, topY: number, x: number): string {
  return `${pad(pageIndex, 5)}|${pad(topY, 6)}|${pad(x, 5)}`;
}

// --- geometry -------------------------------------------------------------

// zotero rect [l, yBottom, r, yTop] (bottom-left) -> EmbedPDF Rect (top-left).
export function zoteroRectToEmbed(rect: number[], pageHeight: number): Rect {
  const [l, yb, r, yt] = rect;
  return {
    origin: { x: l, y: pageHeight - yt },
    size: { width: r - l, height: yt - yb },
  };
}

// EmbedPDF Rect (top-left) -> zotero rect [l, yBottom, r, yTop] (bottom-left).
export function embedRectToZotero(rect: Rect, pageHeight: number): number[] {
  const l = rect.origin.x;
  const r = rect.origin.x + rect.size.width;
  const yTop = pageHeight - rect.origin.y;
  const yBottom = pageHeight - (rect.origin.y + rect.size.height);
  return [l, yBottom, r, yTop];
}

// Axis-aligned union of segment rects, in EmbedPDF top-left space.
export function boundingRect(rects: Rect[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of rects) {
    minX = Math.min(minX, s.origin.x);
    minY = Math.min(minY, s.origin.y);
    maxX = Math.max(maxX, s.origin.x + s.size.width);
    maxY = Math.max(maxY, s.origin.y + s.size.height);
  }
  if (!isFinite(minX)) return { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } };
  return { origin: { x: minX, y: minY }, size: { width: maxX - minX, height: maxY - minY } };
}

// zotero flat path [x0,y0,x1,y1,...] (bottom-left) -> EmbedPDF points (top-left).
function zoteroPathToPoints(path: number[], pageHeight: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) {
    pts.push({ x: path[i], y: pageHeight - path[i + 1] });
  }
  return pts;
}

// EmbedPDF points (top-left) -> zotero flat path [x0,y0,...] (bottom-left).
function pointsToZoteroPath(points: { x: number; y: number }[], pageHeight: number): number[] {
  const flat: number[] = [];
  for (const p of points) {
    flat.push(p.x, pageHeight - p.y);
  }
  return flat;
}

// --- custom field (round-trip carrier) ------------------------------------

function packCustom(ann: ZoteroAnnotation): ShellCustom {
  const c: ShellCustom = { schema: "reading-partner/v1" };
  if (typeof ann.text === "string" && ann.text) c.text = ann.text;
  if (Array.isArray(ann.tags) && ann.tags.length) c.tags = ann.tags;
  if (typeof ann.pageLabel === "string" && ann.pageLabel) c.pageLabel = ann.pageLabel;
  if (typeof ann.aiThreadId === "string" && ann.aiThreadId) c.aiThreadId = ann.aiThreadId;
  if (ann.starred === true) c.starred = true;
  if (typeof ann.dateCreated === "string") c.dateCreated = ann.dateCreated;
  return c;
}

function readCustom(obj: PdfAnnotationObject): ShellCustom {
  const raw = (obj as { custom?: unknown }).custom;
  if (raw && typeof raw === "object") return raw as ShellCustom;
  return { schema: "reading-partner/v1" };
}

// --- zotero color <-> #rrggbb --------------------------------------------
// Both sides use "#rrggbb"; EmbedPDF's ink prefers `strokeColor`, highlight
// uses `color`. Kept as a seam in case normalization is needed later.
function normColor(c: string | undefined, fallback: string): string {
  return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}

// --- top-level converters -------------------------------------------------

// zotero annotation -> EmbedPDF PdfAnnotationObject. Returns null for shapes we
// do not render through EmbedPDF (e.g. retired image regions). `pageHeight` is
// the height in PDF points of the annotation's page.
export function zoteroToEmbed(
  ann: ZoteroAnnotation,
  pageHeight: number,
): PdfAnnotationObject | null {
  const pageIndex = ann.position?.pageIndex ?? 0;
  const custom = packCustom(ann);
  const common = {
    id: ann.id,
    pageIndex,
    custom,
    ...(typeof ann.comment === "string" && ann.comment ? { contents: ann.comment } : {}),
    ...(typeof ann.dateModified === "string" ? { modified: new Date(ann.dateModified) } : {}),
    ...(typeof ann.dateCreated === "string" ? { created: new Date(ann.dateCreated) } : {}),
    ...(typeof ann.authorName === "string" ? { author: ann.authorName } : {}),
  };

  if (ann.type === "highlight" || ann.type === "underline") {
    const rects = ann.position?.rects ?? [];
    const segmentRects = rects.map((r) => zoteroRectToEmbed(r, pageHeight));
    const rect = boundingRect(segmentRects);
    if (ann.type === "highlight") {
      const obj: PdfHighlightAnnoObject = {
        ...common,
        type: PdfAnnotationSubtype.HIGHLIGHT,
        rect,
        segmentRects,
        color: normColor(ann.color, "#ffd400"),
        opacity: DEFAULT_OPACITY,
      };
      return obj;
    }
    const obj: PdfUnderlineAnnoObject = {
      ...common,
      type: PdfAnnotationSubtype.UNDERLINE,
      rect,
      segmentRects,
      color: normColor(ann.color, "#ffd400"),
      opacity: DEFAULT_OPACITY,
    };
    return obj;
  }

  if (ann.type === "ink") {
    const paths = ann.position?.paths ?? [];
    const inkList = paths.map((p) => ({ points: zoteroPathToPoints(p, pageHeight) }));
    const allPts = inkList.flatMap((l) => l.points);
    const rect = boundingRect(allPts.map((p) => ({ origin: p, size: { width: 0, height: 0 } })));
    const obj: PdfInkAnnoObject = {
      ...common,
      type: PdfAnnotationSubtype.INK,
      inkList,
      rect,
      color: normColor(ann.color, "#a28ae5"),
      strokeColor: normColor(ann.color, "#a28ae5"),
      opacity: 1,
      strokeWidth: ann.position?.width ?? 2,
    };
    return obj;
  }

  return null;
}

// EmbedPDF PdfAnnotationObject -> zotero annotation. `authorName` seeds the
// author on freshly-created objects that carry none.
export function embedToZotero(
  obj: PdfAnnotationObject,
  pageHeight: number,
  authorName = "Reading-Partner",
): ZoteroAnnotation | null {
  const custom = readCustom(obj);
  const pageIndex = obj.pageIndex;
  const created =
    custom.dateCreated ?? (obj.created ? new Date(obj.created).toISOString() : new Date().toISOString());
  const modified = obj.modified ? new Date(obj.modified).toISOString() : new Date().toISOString();

  const base: ZoteroAnnotation = {
    id: obj.id,
    type: "",
    text: custom.text ?? "",
    comment: typeof obj.contents === "string" ? obj.contents : "",
    tags: custom.tags ?? [],
    pageLabel: custom.pageLabel ?? String(pageIndex + 1),
    dateCreated: created,
    dateModified: modified,
    authorName: obj.author ?? authorName,
    isAuthorNameAuthoritative: true,
  };
  if (custom.aiThreadId) base.aiThreadId = custom.aiThreadId;
  if (custom.starred) base.starred = true;
  if (custom.legacyId) base.legacyId = custom.legacyId;

  if (obj.type === PdfAnnotationSubtype.HIGHLIGHT || obj.type === PdfAnnotationSubtype.UNDERLINE) {
    const seg = (obj as PdfHighlightAnnoObject | PdfUnderlineAnnoObject).segmentRects ?? [];
    const rects = seg.map((r) => embedRectToZotero(r, pageHeight));
    const bb = boundingRect(seg);
    return {
      ...base,
      type: obj.type === PdfAnnotationSubtype.HIGHLIGHT ? "highlight" : "underline",
      color: (obj as PdfHighlightAnnoObject).color ?? "#ffd400",
      position: { pageIndex, rects },
      sortIndex: makeSortIndex(pageIndex, bb.origin.y, bb.origin.x),
    };
  }

  if (obj.type === PdfAnnotationSubtype.INK) {
    const ink = obj as PdfInkAnnoObject;
    const paths = (ink.inkList ?? []).map((l) => pointsToZoteroPath(l.points, pageHeight));
    const bb = boundingRect((ink.inkList ?? []).flatMap((l) => l.points).map((p) => ({ origin: p, size: { width: 0, height: 0 } })));
    return {
      ...base,
      type: "ink",
      color: ink.strokeColor ?? ink.color ?? "#a28ae5",
      position: { pageIndex, paths, width: ink.strokeWidth },
      sortIndex: makeSortIndex(pageIndex, bb.origin.y, bb.origin.x),
    };
  }

  return null;
}
