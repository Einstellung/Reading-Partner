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

// What a finger does in either layout, plus when the engine's pointer pipeline
// has to be shut off. Both layout branches go through this, so paged and
// vertical can never drift apart on the pen/finger policy.
export interface FingerPlan {
  action: RouteAction;
  // Pause the engine at pointerdown, not at the gesture commit: an annotation
  // tool starts its stroke on pointerdown, so the few px of lead-in before the
  // gesture commits would leave a flash of ink on the page (pitfall 37). The
  // hand tool defers its pause to the commit instead, so a stationary tap still
  // reaches the engine (dismiss / select).
  pauseAtDown: boolean;
}

export function planFinger(tool: ToolKind, penSeen: boolean): FingerPlan {
  const action = routePointer(tool, "touch", penSeen);
  return { action, pauseAtDown: tool === "annotate" && action === "scroll" };
}

// Paged (horizontal flip) mode maps the same verdict onto the paged gesture
// machine's two tool modes ("pointer" = one finger turns the page anywhere;
// "pen" = one finger draws, a turn must start from a screen edge). Paged only
// ever handles finger pointers, so pen/mouse never reach here.
export function pagedGestureTool(tool: ToolKind, penSeen: boolean): "pointer" | "pen" {
  return planFinger(tool, penSeen).action === "scroll" ? "pointer" : "pen";
}

// Once a finger is classified as scroll, a move past the slop in ANY direction
// commits it to scrolling — a horizontal pan must never fall through to the
// drawing layer. Direction only decides the axis afterwards, never draw-vs-scroll.
export function shouldCommitScroll(dx: number, dy: number, slop: number): boolean {
  return Math.abs(dx) >= slop || Math.abs(dy) >= slop;
}

// Normalize a PointerEvent.pointerType to a PointerKind. Unknown/empty types
// (some engines report "") are treated as touch, the most conservative class.
export function pointerKindOf(pointerType: string): PointerKind {
  if (pointerType === "mouse") return "mouse";
  if (pointerType === "pen") return "pen";
  return "touch";
}

// --- finger-count semantics -------------------------------------------------

// What a gesture means by the number of fingers on the glass:
//   single   — one finger: routePointer above decides draw vs scroll.
//   pinch    — two fingers: zoom (engine's own touch-driven wrapper) plus pan;
//              nothing may be selected or drawn while it lasts.
//   reserved — three or more: swallowed whole. No action is wired to it yet;
//              this is the slot a future 3-finger gesture (undo, page sweep)
//              would take.
export type TouchGestureMode = "single" | "pinch" | "reserved";

export function touchGestureMode(fingers: number): TouchGestureMode {
  if (fingers >= 3) return "reserved";
  if (fingers === 2) return "pinch";
  return "single";
}

// The multi-touch latch. Once a second finger lands, the gesture belongs to the
// pinch until every finger is off the glass — going 2 -> 3 -> 2 stays the same
// gesture and must not restart it, and the finger that outlives the pinch must
// not turn into a fresh scroll.
export function multiTouchLatch(prev: boolean, fingers: number): boolean {
  if (fingers >= 2) return true;
  if (fingers === 0) return false;
  return prev;
}

// The pen-priority latch. A stylus outranks every finger: the moment it lands,
// the fingers already resting on the glass (the writing hand) are dead — no
// scroll, no fling, no engine events — until every one of them lifts.
//
// On iPadOS this rarely fires: the system holds back touch events while a
// Pencil is down (docs/pitfall/39), so the resting hand mostly never reaches
// the page. It stays for the boundary the system does deliver — a pen landing
// during a finger scroll already in flight — and for stylus platforms that have
// no such rule.
export function fingerLockAfterPen(prev: boolean, penDown: boolean, fingers: number): boolean {
  if (penDown) return fingers > 0;
  if (fingers === 0) return false;
  return prev;
}

// What the router does with a finger event: hand it to the one-finger machine,
// or eat it here so the engine never sees it.
export type FingerVerdict = "route" | "swallow";

export function fingerVerdict(
  mode: TouchGestureMode,
  multiTouch: boolean,
  penLock: boolean,
): FingerVerdict {
  if (penLock) return "swallow";
  if (multiTouch || mode !== "single") return "swallow";
  return "route";
}

// Mid-point of the live contacts, the point a two-finger pan follows. Returns
// null for an empty set so the caller keeps its previous baseline.
export function centroidOf(points: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

// There is no palm rejection here, and there will not be: see
// docs/pitfall/39. iPadOS makes pen and touch mutually exclusive at the system
// level (the web page is not sent the finger contacts while the Pencil is
// down), and iOS Safari does not report a contact patch a page could measure
// anyway. Every contact that reaches this module is a real one.

// --- stray selection cleanup ------------------------------------------------

// A finger gesture that takes over (scroll commit, pinch start) drops the
// selection it caused on the way in — the engine can begin a text drag inside
// the few px before the takeover. A selection that was already on screen when
// the finger landed (a pen selection with its AI menu open) is left alone.
export function shouldClearGestureSelection(
  hadSelectionAtStart: boolean,
  hasSelectionNow: boolean,
): boolean {
  return hasSelectionNow && !hadSelectionAtStart;
}
