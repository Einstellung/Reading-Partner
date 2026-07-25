// Compact figure catalog for the model's context (M9). One line per figure —
// tag, page, truncated caption — so the model knows which figures exist and can
// cite them as [fig:N] without spending tokens on full captions. Capped; for a
// long survey the cap keeps the figures nearest the reader's current page. Pure.

import type { Figure } from "./types";

const DEFAULT_MAX = 40;
const CAPTION_CHARS = 100;

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

export interface CatalogOptions {
  max?: number;
  // When the catalog is capped, keep the figures nearest this 1-based page.
  currentPage?: number | null;
}

// Select at most `max` figures, preferring those near `currentPage` when capping,
// then return them in page order. Exported for testing the cap directly.
export function selectCatalogFigures(figures: Figure[], opts: CatalogOptions = {}): Figure[] {
  const max = opts.max ?? DEFAULT_MAX;
  if (figures.length <= max) {
    return [...figures].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id));
  }
  const anchor = opts.currentPage ?? figures[0]?.page ?? 1;
  const nearest = [...figures]
    .sort((a, b) => Math.abs(a.page - anchor) - Math.abs(b.page - anchor))
    .slice(0, max);
  return nearest.sort((a, b) => a.page - b.page || a.id.localeCompare(b.id));
}

// The catalog block for a system prompt, or "" when there are no figures.
export function buildFigureCatalog(figures: Figure[], opts: CatalogOptions = {}): string {
  if (figures.length === 0) return "";
  const chosen = selectCatalogFigures(figures, opts);
  const lines = ["Figures in this document (cite one as [fig:N] when it shows what you explain):"];
  for (const f of chosen) {
    lines.push(`- [fig:${f.id}] p.${f.page} — ${clip(f.caption, CAPTION_CHARS)}`);
  }
  if (chosen.length < figures.length) {
    lines.push(`(${figures.length - chosen.length} more figures elsewhere; ask to read a page to find them.)`);
  }
  return lines.join("\n");
}
