// Pen/finger input routing. Given the active tool and the pointer's device
// type, decides whether a single-pointer gesture should DRAW (annotate) or
// SCROLL (pan / turn pages). Pure and DOM-free so the whole routing table is
// unit testable; the host translates the verdict into engine calls.
//
// Two surfaces answer with this table now: the page (attach-touch.ts) and the
// classroom, where the same two pens draw on an AI reply (docs/09,
// ui/components/chat/chat-pen-drag.ts). What the finger does must not depend on
// which of them the reader is looking at, so there is one table and no second
// answer to the same question. The parts below the routing table itself —
// finger counts, the pinch latch, the pen-priority latch — are the page's: the
// classroom takes one pointer at a time and reads none of them.
//
// The design mirrors paper: the stylus marks the page, the finger moves it, on
// every platform and with every tool. A finger marks only by holding still on
// the words, which selects them (docs/82); that hold is the router's, not this
// table's.
//
// The navigation lock (the palm toggle in the tool group) suspends the split
// entirely: while it is on, every device only moves the page and nothing
// selects.

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

// The routing table.
//
// - navlock: always scroll (mouse/pen/touch alike) — the whole point of it.
// - mouse/pen: draw, i.e. the engine's own pointer pipeline (a drawing tool's
//   stroke, or text selection with no tool).
// - touch: scroll.
export function routePointer(tool: ToolKind, pointer: PointerKind): RouteAction {
  if (tool === "navlock") return "scroll";
  return pointer === "touch" ? "scroll" : "draw";
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
  // Whether a finger that holds still on the words selects them (docs/82).
  // Every tool but the navigation lock: under it nothing selects text.
  holdSelects: boolean;
  // Whether the engine's pointer pipeline may watch this pointer MOVE. Under the
  // navigation lock it may not. The engine does not read pointerType and its
  // selection handler needs nothing but a move, so a stylus sliding down a page
  // drags a text selection out under the scroll — the lock scrolls correctly and
  // leaves a blue word behind it anyway. The down and the up still reach the
  // engine, so a stationary tap under the lock keeps doing what it always did
  // (dismiss an overlay, select an annotation); only the drag is taken away,
  // which is exactly what the lock means.
  //
  // Blocked per pointer with stopPropagation, not with the interaction manager's
  // global pause (docs/pitfall/38): pause is all-or-nothing and would also have
  // to be undone before the tap could go through.
  engineMayDrag: boolean;
}

export function planPointer(tool: ToolKind, pointer: PointerKind): PointerPlan {
  const action = routePointer(tool, pointer);
  return {
    action,
    pauseAtDown: tool === "annotate" && action === "scroll",
    holdSelects: tool !== "navlock" && action === "scroll",
    engineMayDrag: tool !== "navlock",
  };
}

// The finger case, the one both layouts always have.
export function planFinger(tool: ToolKind): PointerPlan {
  return planPointer(tool, "touch");
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

// A pinch that has come down to its last finger. That finger takes the gesture
// over as a one-finger pan — it is already on the glass and the content is
// already following it, so waiting for the glass to empty would strand the
// reader mid-zoom. 2 -> 3 -> 2 is not a handoff (still a multi-finger gesture),
// and a pen holding the fingers dead is not one either: those fingers are inert
// until they lift. The caller clears the multi-touch latch itself when this is
// true; the latch alone cannot tell "one finger left" from "one finger left and
// the host has picked it up".
export function pinchHandsOff(prevMulti: boolean, fingers: number, penLock: boolean): boolean {
  return prevMulti && !penLock && fingers === 1;
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

// The engine's text-selection handler arms an anchor on the pointerdown it sees
// and disarms it only on the matching pointerup. The moment this router takes a
// gesture over it captures the pointer on the viewport, and from there on every
// event for that pointer is retargeted to the viewport — the page below never
// gets another one, so that pointerup never arrives and the anchor stays armed
// for as long as the page is mounted. The next move the engine does see, with no
// pointerdown in front of it, is measured against that stale anchor and drags a
// selection out of nothing: from the word the last swipe started on to wherever
// the pointer is now, which after a few screens of scrolling is the whole
// visible page (docs/pitfall/38 — the same dangling anchor as before, reached by
// capturing the pointer instead of by swallowing its up).
//
// Dropping the selection is not a substitute: that resets the plugin's state,
// not the per-page handler that holds the anchor, and an anchor with no rects
// yet is invisible to any "is something selected" check.
//
// So a pointer whose pointerdown the engine saw is handed a synthetic pointerup
// at the takeover — while the engine is still listening, because a paused one
// drops the event and the anchor survives anyway.
export function shouldHandEngineTheUp(engineSawDown: boolean, enginePaused: boolean): boolean {
  return engineSawDown && !enginePaused;
}
