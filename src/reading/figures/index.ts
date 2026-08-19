// Public surface of the figure-index module (M9).

export type { Figure, FigureBBox, FiguresIndex } from "./types";
export { FIGURES_VERSION } from "./types";
export { ensureFigures, getFigures, parseFiguresCache } from "./store";
export { buildFigureCatalog, selectCatalogFigures, type CatalogOptions } from "./catalog";
export {
  renderFigure,
  renderPageImage,
  clearFigureCache,
  cardDisplayWidth,
  type RenderedFigure,
  type FigureTier,
} from "./render";
export {
  attachPageWindow,
  pageImageTokens,
  pageRangeLabel,
  pageWindowGate,
  pageWindowMarker,
  pageWindowPages,
  pageWindowPrompt,
  planPageWindow,
  ANCHOR_PAGE_WIDTH_PX,
  NEIGHBOUR_PAGE_WIDTH_PX,
  PAGE_WINDOW_RADIUS,
  SPARSE_PAGE_CHARS,
  type PageWindowGate,
  type PageWindowImage,
  type PageWindowPage,
  type PageWindowPlan,
} from "./page-window";
export {
  buildFigureTools,
  figureToolResult,
  type FigureImage,
  type BuildFigureToolsOptions,
} from "./tools";
export {
  canonicalFigureId,
  compareFigureIds,
  findFigureById,
  normalizeFigureId,
  FIGURE_ID_PATTERN,
  FIGURE_ID_RE,
} from "./lookup";
