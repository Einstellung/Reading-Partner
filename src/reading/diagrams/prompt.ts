// When a picture is worth it, and which kind — one block, one place.
//
// The rule is a ladder because there is more than one way to put a picture in
// front of the reader and they are not equal. The book's own figure costs
// nothing and is what the reader meets again on the page, so it comes first. A
// redrawn diagram costs a tool call and is a simplification the reader has to
// trust, so it comes second and only for structure. Everything else is faster to
// read as prose or a table, so it comes last and the answer is "don't".
//
// Written here rather than split between the figure catalog and the drawing
// tool, because a rule about which of two things to reach for cannot live in two
// places without the halves drifting: a model told "cite figures" beside its
// figure list and "draw diagrams" beside its drawing tool does both for the same
// point. buildFigureCatalog's own heading is overridden below for that reason —
// it used to carry half this judgement.
//
// The next rung is already sized. When image generation lands it is one more
// branch here — a concrete illustration, after "is it a structure" and before
// "don't" — and nothing else in any prompt has to move.

import { buildFigureCatalog } from "../figures/catalog";
import type { Figure } from "../figures/types";

export interface VisualAidOptions {
  figures: Figure[];
  // When the catalog is capped, keep the figures nearest this 1-based page.
  currentPage?: number | null;
  max?: number;
  // The window was tight and the figure list was given up (the "figure-catalog"
  // rung of the reduction ladder). The ladder itself is a dozen lines and stays:
  // dropping the judgement costs more than the list it was about.
  omitCatalog?: boolean;
  // Whether draw_diagram / update_diagram are mounted this turn. The prompt must
  // never offer a tool that is not there.
  canDraw: boolean;
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

  if (!opts.canDraw) {
    lines.push("2. Otherwise, describe it in words. You cannot draw in this conversation.");
    return lines.join("\n");
  }

  lines.push(
    "2. Otherwise, if what you are explaining is a STRUCTURE — parts and how they",
    "   connect, a flow of steps, an order of messages between participants, a",
    "   hierarchy — draw it with draw_diagram. Two cases are what it is for:",
    "   - The book's figure exists but is too dense to follow. Redraw just the",
    "     path you are talking about, or build it up in stages. Set source.figure",
    "     so the reader can check your simplification against the original.",
    "   - There is no figure, and the shape is the point.",
    "3. Otherwise, don't draw. A definition, a comparison, a list of properties, a",
    "   derivation: prose or a Markdown table is faster to read than a picture of",
    "   the same thing. A diagram with no edges is a bulleted list drawn badly.",
    "",
    "Never send a second picture of the same thing. When the reader says they",
    "still don't follow, call update_diagram on the one already on screen: put",
    "focus.path on the single path they are stuck on and everything else dims, or",
    "set stages and let them step through it. Two diagrams of one structure makes",
    "the reader work out what changed; one diagram that changes does not.",
  );
  return lines.join("\n");
}
