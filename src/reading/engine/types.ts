// The adapter's public type surface.
//
// It lives apart from EmbedPdfView.tsx because everything under this directory
// needs it: the imperative wiring (wire-engine.ts) takes EmbedPdfViewProps and
// QuoteHighlight in its signature. Declaring them in the component file and
// importing them back would be a cycle. The touch router's shared context is
// gesture/context.ts, which also owns EmbedTool — re-exported here so the
// adapter's surface stays in one place.

import type * as React from "react";
import type { PdfAnnotationObject, PdfDocumentObject, Rect } from "@embedpdf/models";
import type { ZoteroAnnotation } from "./convert";
import type { EmbedTool } from "./gesture/context";

export type { EmbedTool };

// Reading layout: "vertical" = the classic continuous vertical scroll; "paged" =
// one fit-page screen at a time, flipped horizontally by touch swipe (iPad).
export type EmbedLayout = "vertical" | "paged";

// A transient, non-persistent overlay marking an AI-cited quote on a page. Two
// tiers: `rects` draws a violet highlight over the located text (Tier A);
// `banner` shows the quote text as a chip near the page top when the text could
// not be located geometrically (Tier B). Never becomes a saved annotation.
export type QuoteHighlight =
  | { pageIndex: number; kind: "rects"; rects: Rect[] }
  | { pageIndex: number; kind: "banner"; quote: string };

// What highlightQuote takes: `searchText` is fed to the engine's text search
// (ideally the exact on-page substring), `displayText` is the model's quote
// shown in the Tier-B banner fallback.
export interface QuoteRequest {
  searchText: string;
  displayText: string;
}

export interface EmbedViewState {
  pageIndex: number;
  zoom: number;
  // Top-left of the visible region within the current page, in unscaled page
  // coordinates (top-left origin) — enables exact in-page position restore.
  pageX?: number;
  pageY?: number;
  // Reading layout (per book). Absent restores to vertical.
  layout?: EmbedLayout;
}

// Viewport-space rect of an annotation, reported when it gets selected — the
// precise anchor for the shell's popup/bubble.
export interface AnnotationAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EmbedViewStats {
  pageIndex: number;
  pagesCount: number;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  layout: EmbedLayout;
}

export interface EmbedPdfHandle {
  setTool(tool: EmbedTool): void;
  // The "draw with your finger" setting. Off (the default) means a finger only
  // ever moves the page and the stylus does the marking.
  setFingerDraw(on: boolean): void;
  setColor(color: string): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  // Switch between vertical continuous scroll and paged horizontal flip.
  setLayout(mode: EmbedLayout): void;
  navigateToPage(pageIndex: number): void;
  navigateToAnnotation(id: string): void;
  // Scroll to the page and show a transient violet overlay on the cited quote.
  // Resolves true when the quote was located and highlighted (Tier A), false
  // when it fell back to the quote banner (Tier B).
  highlightQuote(pageIndex: number, req: QuoteRequest): Promise<boolean>;
  clearQuoteHighlight(): void;
  updateAnnotation(id: string, patch: { color?: string; comment?: string; starred?: boolean }): void;
  // Host-driven upsert of full zotero annotations (reflect host edits / import
  // new). Does not re-emit onSaveAnnotations (host is the source of truth).
  upsertAnnotations(anns: ZoteroAnnotation[]): void;
  deleteAnnotation(id: string): void;
  selectAnnotation(id: string): void;
  getState(): EmbedViewState;
  // Spike/introspection surface: closes items 3 (coords) and 7 (custom) live.
  _debug: {
    dumpEmbed(): PdfAnnotationObject[];
    pageHeight(pageIndex: number): number;
    doc(): PdfDocumentObject | null;
  };
}

export interface EmbedPdfViewProps {
  buffer: ArrayBuffer;
  annotations?: ZoteroAnnotation[];
  authorName?: string;
  initialViewState?: EmbedViewState | null;
  onReady?: (handle: EmbedPdfHandle) => void;
  onError?: (e: Error) => void;
  onSaveAnnotations?: (anns: ZoteroAnnotation[]) => void;
  onDeleteAnnotations?: (ids: string[]) => void;
  onSelectAnnotation?: (id: string | null) => void;
  // Fired (after onSelectAnnotation) with the selected annotation's measured
  // viewport rect, via the AnnotationLayer selectionMenu slot. Once per
  // selection — re-renders while selected do not re-fire.
  onAnnotationAnchor?: (id: string, rect: AnnotationAnchor) => void;
  onViewState?: (s: EmbedViewState) => void;
  onViewStats?: (s: EmbedViewStats) => void;
  // Fired when the transient AI-quote overlay appears (true) or is dismissed
  // (false), so the shell can route Escape to dismiss it.
  onQuoteHighlight?: (active: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}
