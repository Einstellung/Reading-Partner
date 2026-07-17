// Resolve a figure id as the model or a [fig:N] citation writes it. Tolerant of
// a "fig"/"figure" prefix and surrounding punctuation so "Figure 3", "fig.3" and
// "3" all find figure "3". Pure; shared by the view_figure tool and the card.

import type { Figure } from "./types";

export function normalizeFigureId(id: string): string {
  return id.trim().toLowerCase().replace(/^fig(?:ure)?[.:\s]*/i, "");
}

export function findFigureById(figures: Figure[], id: string): Figure | null {
  const q = normalizeFigureId(id);
  return figures.find((f) => f.id === q) ?? null;
}
