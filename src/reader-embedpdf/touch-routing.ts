// Adaptive pen/finger input routing for the reader. Given the active tool, the
// pointer's device type, and whether a stylus has ever been seen this session,
// decides whether a single-pointer gesture should DRAW (annotate) or SCROLL
// (pan / turn pages). Pure and DOM-free so the whole routing table is unit
// testable; the host translates the verdict into engine calls.
//
// The design ("pen writes, finger scrolls" once a stylus is in play) mirrors
// paper: with an Apple Pencil present the finger is only ever for moving the
// page, the pen for marking it. On a stylus-less device (iPhone) the finger has
// to draw or annotation would be unreachable.

// Whether the active tool marks the page. "hand" = the pointer/pan tool (no
// annotation tool active): everything scrolls. "annotate" = any drawing tool
// (highlight / underline / ink / AI pen).
export type ToolKind = "hand" | "annotate";

// The pointer's device. Apple Pencil reports "pen" in WKWebView.
export type PointerKind = "mouse" | "pen" | "touch";

export type RouteAction = "draw" | "scroll";

// The routing table. `penSeen` is the session-level latch: true once any pointer
// event this session reported pointerType "pen".
//
// - hand tool: always scroll (mouse/pen/touch alike).
// - annotate tool:
//   - mouse: draw (desktop, unchanged).
//   - pen:   draw.
//   - touch: scroll when a stylus has been seen (finger only moves the page),
//            draw otherwise (stylus-less device still needs to annotate).
export function routePointer(tool: ToolKind, pointer: PointerKind, penSeen: boolean): RouteAction {
  if (tool === "hand") return "scroll";
  if (pointer === "touch") return penSeen ? "scroll" : "draw";
  return "draw"; // mouse and pen always draw under an annotation tool
}

// Normalize an EmbedPDF tool id to the two routing classes. Anything that is not
// a drawing tool (null / "pointer") is the hand.
export function toolKindOf(toolId: string | null | undefined): ToolKind {
  if (!toolId || toolId === "pointer") return "hand";
  return "annotate";
}

// Paged (horizontal flip) mode maps the same penSeen policy onto the paged
// gesture machine's two tool modes ("pointer" = one finger turns the page
// anywhere; "pen" = one finger draws, a turn must start from a screen edge).
// Paged only ever handles finger pointers, so pen/mouse never reach here.
//   - hand tool: finger turns (pointer).
//   - annotate tool: a stylus was seen → finger turns (pointer, the pen draws);
//     no stylus → finger draws (pen).
export function pagedGestureTool(tool: ToolKind, penSeen: boolean): "pointer" | "pen" {
  if (tool === "hand") return "pointer";
  return penSeen ? "pointer" : "pen";
}

// Normalize a PointerEvent.pointerType to a PointerKind. Unknown/empty types
// (some engines report "") are treated as touch, the most conservative class.
export function pointerKindOf(pointerType: string): PointerKind {
  if (pointerType === "mouse") return "mouse";
  if (pointerType === "pen") return "pen";
  return "touch";
}
