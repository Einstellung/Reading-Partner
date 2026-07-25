// Pen/finger input routing for the reader. Given the active tool, the pointer's
// device type and one setting, decides whether a single-pointer gesture should
// DRAW (annotate) or SCROLL (pan / turn pages). Pure and DOM-free so the whole
// routing table is unit testable; the host translates the verdict into engine
// calls.
//
// The design mirrors paper: the stylus marks the page, the finger moves it. That
// holds on every platform and at every moment — the finger never draws unless
// the reader has been told to let it, by the "draw with your finger" setting,
// which a device with no stylus turns on.
//
// The rule used to be inferred instead of set: the finger drew until a stylus
// had been seen this session. It made the first swipe of every session mark the
// page (the Pencil had not touched the glass yet), and which of the two a finger
// would do could not be read off the screen. One explicit input replaces it.
//
// The navigation lock (the palm toggle in the tool group) suspends the split
// entirely: while it is on, every device only moves the page.

// What the tool group is set to.
//   "none"    — nothing selected. The traditional mode: a stylus marks and
//               selects through the engine, the finger moves the page.
//   "navlock" — the palm toggle, a navigation lock. Every pointer only moves
//               the page: no ink, no text selection, stylus and finger alike.
//   "annotate"— a drawing tool (highlight / underline / ink / AI pen).
// "navlock" and "annotate" are mutually exclusive by construction: the tool
// group holds one value.
export type ToolKind = "none" | "navlock" | "annotate";

// The pointer's device. Apple Pencil reports "pen" in WKWebView.
export type PointerKind = "mouse" | "pen" | "touch";

export type RouteAction = "draw" | "scroll";

// The routing table. `fingerDraw` is the setting: off (the default) means the
// finger only ever moves the page, on any platform.
//
// - navlock: always scroll (mouse/pen/touch alike) — the whole point of it.
// - none:
//   - mouse/pen: draw, i.e. the engine's own pointer pipeline (text selection).
//   - touch:     scroll.
// - annotate:
//   - mouse: draw (desktop, unchanged).
//   - pen:   draw.
//   - touch: draw only when the setting says so; scroll otherwise.
export function routePointer(tool: ToolKind, pointer: PointerKind, fingerDraw: boolean): RouteAction {
  if (tool === "navlock") return "scroll";
  if (pointer !== "touch") return "draw"; // mouse and pen go to the engine
  if (tool === "annotate") return fingerDraw ? "draw" : "scroll";
  return "scroll";
}

// Normalize a tool id to the three routing classes. Anything that is not the
// navigation lock and not a drawing tool (null / "pointer" / "none") is "none".
export function toolKindOf(toolId: string | null | undefined): ToolKind {
  if (toolId === "navlock") return "navlock";
  if (!toolId || toolId === "pointer" || toolId === "none") return "none";
  return "annotate";
}

// Which pointers the host router drives itself, as contacts of its own gesture
// machines, instead of letting them through to the engine.
//
// Fingers always — the page divs are touch-action:none in every mode, so a
// finger gesture only exists if the router makes it (pitfall 37). The stylus
// only under the navigation lock, where it is treated exactly like a finger:
// same scroll, same page flip, same rubber band, same fling. The mouse never,
// so the desktop paths stay untouched.
export function routesAsContact(tool: ToolKind, pointer: PointerKind): boolean {
  if (pointer === "mouse") return false;
  if (pointer === "pen") return tool === "navlock";
  return true;
}

// What one routed pointer does in either layout, plus when the engine's pointer
// pipeline has to be shut off. Both layout branches go through this, so paged
// and vertical can never drift apart on the routing policy.
export interface PointerPlan {
  action: RouteAction;
  // Pause the engine at pointerdown, not at the gesture commit: an annotation
  // tool starts its stroke on pointerdown, so the few px of lead-in before the
  // gesture commits would leave a flash of ink on the page (pitfall 37). With no
  // drawing tool active there is no stroke to leak, so the pause waits for the
  // commit and a stationary tap still reaches the engine (dismiss / select an
  // annotation).
  pauseAtDown: boolean;
  // Paged mode hands a pointer that dwells in place to native text selection, so
  // a later drag of a selection handle is not stolen as a page turn. The
  // navigation lock is the one mode that does not: under it nothing selects text.
  longPressSelect: boolean;
}

export function planPointer(tool: ToolKind, pointer: PointerKind, fingerDraw: boolean): PointerPlan {
  const action = routePointer(tool, pointer, fingerDraw);
  return {
    action,
    pauseAtDown: tool === "annotate" && action === "scroll",
    longPressSelect: tool === "none" && action === "scroll",
  };
}

// The finger case, the one both layouts always have.
export function planFinger(tool: ToolKind, fingerDraw: boolean): PointerPlan {
  return planPointer(tool, "touch", fingerDraw);
}

// Paged (horizontal flip) mode maps the same verdict onto the paged gesture
// machine's two tool modes ("pointer" = one pointer turns the page anywhere;
// "pen" = one pointer draws, a turn must start from a screen edge). Every
// pointer that reaches paged is either a finger or a stylus under the navigation
// lock, and the lock answers "pointer" for every device, so the finger plan
// decides for both.
export function pagedGestureTool(tool: ToolKind, fingerDraw: boolean): "pointer" | "pen" {
  return planFinger(tool, fingerDraw).action === "scroll" ? "pointer" : "pen";
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
