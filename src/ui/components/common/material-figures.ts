// The pure half of MaterialFigureScope: what a set of a retell's materials adds
// up to as one figure host, and whether there is a host to be had at all.
//
// A retell spans several books, so a [fig:N] written in its conversation names a
// figure of one of them and nothing in the citation says which. The answer is
// the same one the retell's own view_figure tool gives (reading/retell/turn.ts):
// pool every material's figures in the order the materials are listed, and let
// the first match win. Which book a figure came from is kept by object identity
// rather than by id, because two books in one retell can both print a "Figure
// 3" and only the object knows which page of which file to crop.

import { findFigureById } from "../../../reading/figures";
import type { Figure } from "../../../reading/figures";

// One material as this module needs it: a book id and whatever figures were
// extracted from it. A narrower shape than the retell's LoadedMaterial, which
// also carries the full text, the marks and the skeleton — a picture needs none
// of that.
export interface MaterialFigures {
  bookId: string;
  figures: readonly Figure[];
}

export interface FigureScope {
  // Every figure across the materials, in material order.
  figures: Figure[];
  // The book each of them came from.
  bookOf: Map<Figure, string>;
}

// A figure resolved back to the file it has to be cropped from.
export interface ScopedFigure {
  figure: Figure;
  bookId: string;
}

// Pool the materials' figures, or null when there is not a single figure among
// them — which is the whole decision about whether a host should exist. Null
// rather than an empty scope: a host that resolves nothing would still turn
// every [fig:N] into a dead grey chip, and leaving the citation as the text the
// model wrote is what the surface did before figures reached it.
export function figureScope(materials: readonly MaterialFigures[]): FigureScope | null {
  const figures: Figure[] = [];
  const bookOf = new Map<Figure, string>();
  for (const m of materials) {
    for (const f of m.figures) {
      figures.push(f);
      bookOf.set(f, m.bookId);
    }
  }
  return figures.length > 0 ? { figures, bookOf } : null;
}

// Resolve a [fig:N] id across every material. The id is matched the way the
// reader matches it (figures/lookup.ts: exact printed form first, then
// separators folded), so a citation resolves to the same figure here as it does
// with the book open.
export function scopeFigure(scope: FigureScope | null, id: string): ScopedFigure | null {
  if (!scope) return null;
  const figure = findFigureById(scope.figures, id);
  if (!figure) return null;
  const bookId = scope.bookOf.get(figure);
  return bookId ? { figure, bookId } : null;
}
