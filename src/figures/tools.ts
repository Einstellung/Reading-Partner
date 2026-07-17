// The view_figure tool (M9): the model asks for a figure by id and gets the
// cropped image back so it can actually answer "what does the arrow point to".
// Rendering is injected (browser-only, src/figures/render), so the tool builder
// stays headless and unit-testable. Gated on vision support: for a text-only
// model the tool still exists but returns the caption and a note that it can't
// see the picture, so the model doesn't promise the user something it can't do.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, ToolResult } from "../ai/agent";
import { findFigureById } from "./lookup";
import type { Figure } from "./types";

export interface FigureImage {
  base64: string;
  mimeType: string;
}

export interface BuildFigureToolsOptions {
  figures: Figure[];
  modelSupportsImages: boolean;
  // Rasterize a figure to a model-sized image, or null on failure.
  renderImage: (figure: Figure) => Promise<FigureImage | null>;
}

// Compose the tool result for one figure. Pure given the (already rendered)
// image, so the vision / non-vision / not-found / render-failed shapes are
// unit-testable without a browser.
export function figureToolResult(
  figure: Figure | null,
  id: string,
  modelSupportsImages: boolean,
  image: FigureImage | null,
): ToolResult {
  if (!figure) {
    return { text: `No figure "${id}" in this document.` };
  }
  const head = `Figure ${figure.id} (p.${figure.page}): ${figure.caption}`;
  if (!modelSupportsImages) {
    return { text: `${head}\n\n(This model can't view images, so only the caption is available.)` };
  }
  if (!image) {
    return { text: `${head}\n\n(The figure image could not be rendered; only the caption is available.)` };
  }
  return { text: head, images: [{ data: image.base64, mimeType: image.mimeType }] };
}

// Build the view_figure tool, or nothing when the document has no figures.
export function buildFigureTools(opts: BuildFigureToolsOptions): AgentTool[] {
  const { figures, modelSupportsImages, renderImage } = opts;
  if (figures.length === 0) return [];
  return [
    {
      name: "view_figure",
      description:
        "Look at a figure from the current document by its number (e.g. \"3\" or \"3a\", as listed in the figure catalog). Returns the figure image so you can describe what it shows.",
      parameters: Type.Object({
        id: Type.String({ description: 'Figure number, e.g. "3" or "3a".' }),
      }),
      execute: async (args): Promise<ToolResult> => {
        const id = String(args.id);
        const figure = findFigureById(figures, id);
        const image = figure && modelSupportsImages ? await renderImage(figure) : null;
        return figureToolResult(figure, id, modelSupportsImages, image);
      },
    },
  ];
}
