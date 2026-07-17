// Public surface of the figure-index module (M9).

export type { Figure, FigureBBox, FiguresIndex } from "./types";
export { FIGURES_VERSION } from "./types";
export { ensureFigures, getFigures, onFiguresError, parseFiguresCache } from "./store";
export { buildFigureCatalog, selectCatalogFigures, type CatalogOptions } from "./catalog";
export { renderFigure, clearFigureCache, type RenderedFigure, type FigureTier } from "./render";
export {
  buildFigureTools,
  figureToolResult,
  type FigureImage,
  type BuildFigureToolsOptions,
} from "./tools";
export { findFigureById } from "./lookup";
