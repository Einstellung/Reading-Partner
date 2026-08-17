// Public surface of the diagram unit: the DSL, the passes over it, and the
// tools that write it.

export type {
  Diagram,
  DiagramArrow,
  DiagramDirection,
  DiagramEdge,
  DiagramEdgeKind,
  DiagramFocus,
  DiagramGroup,
  DiagramLayout,
  DiagramNode,
  DiagramNote,
  DiagramPatch,
  DiagramShape,
  DiagramSource,
  DiagramStage,
  DiagramTone,
} from "./types";
export { DIAGRAM_VERSION } from "./types";

export type { DiagramCard, DiagramCardData } from "./cards";

export { normalizeDiagram, withEdgeIds, type NormalizeResult } from "./normalize";
export { applyDiagramPatch, describePatch } from "./patch";
export { layoutDiagram, resolveEmphasis, resolveFocus, type LayoutOptions } from "./layout";
export type { Emphasis, Scene, SceneBox, SceneEdge, SceneGroup, SceneLifeline, SceneNote } from "./scene";
export { sceneToSvg, serializeSvg, type SvgNode, type SvgOptions } from "./svg";
export { buildDiagramTools, type DiagramToolDeps } from "./tools";
export { buildVisualAidGuidance, type VisualAidOptions } from "./prompt";
export { FONT_STACK, measureLine, wrapText } from "./text";
