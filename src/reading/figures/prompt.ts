// When a point would land better as a picture, and what to do about it — one
// block, one place.
//
// The only picture on offer is the book's own figure: it costs nothing, and it
// is what the reader meets again on the page. Anything else is prose, which is
// faster to read than a picture of the same thing.
//
// Written here rather than left to the figure catalog's own heading, because a
// rule about when to reach for a figure cannot live in two places without the
// halves drifting. buildFigureCatalog's heading is overridden below for that
// reason — it carries half this judgement.

import { buildFigureCatalog } from "./catalog";
import type { Figure } from "./types";

export interface VisualAidOptions {
  figures: Figure[];
  // When the catalog is capped, keep the figures nearest this 1-based page.
  currentPage?: number | null;
  max?: number;
  // The window was tight and the figure list was given up (the "figure-catalog"
  // rung of the reduction ladder). The rule itself is a few lines and stays:
  // dropping the judgement costs more than the list it was about.
  omitCatalog?: boolean;
}

const CATALOG_HEADING = "The figures in this document, which you have and the reader can see:";

export function buildVisualAidGuidance(opts: VisualAidOptions): string {
  const hasFigures = opts.figures.length > 0;
  const catalog =
    hasFigures && !opts.omitCatalog
      ? buildFigureCatalog(opts.figures, {
          max: opts.max,
          currentPage: opts.currentPage,
          heading: CATALOG_HEADING,
        })
      : "";

  const lines: string[] = [];
  if (catalog) lines.push(catalog, "");
  lines.push("When a point would land better as a picture, in this order:");

  if (hasFigures && catalog) {
    lines.push(
      "1. If a figure listed above already shows it, cite it as [fig:N] and explain",
      "   that figure. It is the book's own picture, it costs nothing, and it is",
      "   what the reader meets again on the page.",
    );
  } else if (hasFigures) {
    lines.push(
      "1. This document has figures, but the list of them did not fit this turn.",
      "   Read the page you are discussing to find one, and cite it as [fig:N].",
    );
  } else {
    lines.push("1. This document has no figure index, so there is no figure to cite.");
  }

  lines.push("2. Otherwise, describe it in words. You cannot draw in this conversation.");
  return lines.join("\n");
}
