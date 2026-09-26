// After an item leaves a list in place (use-hold-delete.ts), the ones after it
// slide into the space it freed instead of jumping there: measure them before
// the item is taken out, measure again once it is gone, and play each one back
// from where it was (FLIP). Grid cards move sideways and up, rows move up.
// "Gone" is watched on the DOM, not on a render: the shelf hides the item by
// key, the lesson drops it when it rereads the conversation, and either way
// the mutation observer runs before the next paint.

/** How long the slide takes. */
export const SLIDE_MS = 280;
const SLIDE_EASING = "cubic-bezier(.2,.8,.2,1)";

export interface Place {
  left: number;
  top: number;
}

export interface Offset {
  dx: number;
  dy: number;
}

/** What `followers` walks: the part of a DOM element it reads. */
export interface TreeNode {
  parentElement: TreeNode | null;
  nextElementSibling: TreeNode | null;
}

/**
 * Everything that can move when `el` goes: its later siblings, then the later
 * siblings of each ancestor, up to and not past the ancestor `stop` accepts
 * (the scroller). What comes before `el` in the document stays where it is.
 */
export function followers<T extends TreeNode>(el: T, stop: (node: T) => boolean): T[] {
  const out: T[] = [];
  let node: T | null = el;
  while (node && !stop(node)) {
    for (let s = node.nextElementSibling as T | null; s; s = s.nextElementSibling as T | null) out.push(s);
    node = node.parentElement as T | null;
  }
  return out;
}

/** How far back each element starts: where it was, less where it is now. */
export function slideOffsets(before: readonly Place[], after: readonly Place[]): Offset[] {
  return after.map((a, i) => {
    const b = before[i];
    return b ? { dx: b.left - a.left, dy: b.top - a.top } : { dx: 0, dy: 0 };
  });
}

function scrolls(el: HTMLElement): boolean {
  if (el === document.body) return true;
  const y = getComputedStyle(el).overflowY;
  return y === "auto" || y === "scroll";
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// How long to wait for the item to be taken out before giving up the slide.
const GONE_WAIT_MS = 5000;

/**
 * Measure what follows `el` while it is still in the list, and play the slide
 * when `el` leaves the document. Answers the cancel, for a delete that failed.
 * A no-op under reduced motion or where the Web Animations API is missing.
 */
export function slideWhenGone(el: HTMLElement | null): () => void {
  if (!el || reducedMotion() || typeof el.animate !== "function") return () => {};
  const moving = followers(el, scrolls);
  const play = captureSlide(moving);
  const watch = new MutationObserver(() => {
    if (el.isConnected) return;
    stop();
    play();
  });
  const timer = setTimeout(() => stop(), GONE_WAIT_MS);
  function stop() {
    watch.disconnect();
    clearTimeout(timer);
  }
  // The whole document: the list the item is in may itself be rendered anew.
  watch.observe(document.body, { childList: true, subtree: true });
  return stop;
}

// Measure now; answers what plays the slide from these places.
function captureSlide(moving: readonly HTMLElement[]): () => void {
  const before = moving.map((m) => m.getBoundingClientRect());
  return () => {
    const kept = moving.flatMap((m, i) => (m.isConnected ? [{ el: m, was: before[i]! }] : []));
    const live = kept.map((k) => k.el);
    const after = live.map((m) => m.getBoundingClientRect());
    slideOffsets(kept.map((k) => k.was), after).forEach(({ dx, dy }, i) => {
      if (!dx && !dy) return;
      live[i]!.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: SLIDE_MS,
        easing: SLIDE_EASING,
      });
    });
  };
}
