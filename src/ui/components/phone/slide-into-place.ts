// After an item leaves a list in place (use-hold-delete.ts), what is around it
// slides into the space it freed instead of jumping there: measure it before
// the item is taken out, measure again once it is gone, and play each element
// back from where it was (FLIP). Grid cards move sideways and up, rows move up.
// A list held at the bottom of its scroller (the lesson, read at its latest
// turn) closes the gap from above instead: the scroll clamps, the rows before
// the item move down and the ones after it stay. So both sides are measured,
// and whatever did not move is left alone.
// "Gone" is watched on the DOM, not on a render: the shelf hides the item by
// key, the lesson drops it when it rereads the conversation, and either way
// the mutation observer runs before the next paint.
//
// Elements are found again by order, not held by node: the lesson's rows are
// keyed by position (chat/MessageList.tsx), so dropping an aside's row hands
// each later node the content of the row after it and removes the last node.
// Everything removed lies between the two sides, so the k-th child from the
// start of a container before is the k-th from the start after, and likewise
// from the end, whether React kept the nodes or reused them (docs/pitfall 411).

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

/** What `movingGroups` walks: the part of a DOM element it reads. */
export interface TreeNode {
  parentElement: TreeNode | null;
  previousElementSibling: TreeNode | null;
  nextElementSibling: TreeNode | null;
}

/**
 * One container's share of what can move: its first `lead` children, which
 * come before the item, and its last `trail`, which come after it.
 */
export interface MovingGroup<T> {
  parent: T;
  lead: number;
  trail: number;
}

/**
 * Everything that can move when `el` goes: its siblings, then the siblings of
 * each ancestor, up to and not past the ancestor `stop` accepts (the
 * scroller). Grouped by the container they sit in, innermost first.
 */
export function movingGroups<T extends TreeNode>(el: T, stop: (node: T) => boolean): MovingGroup<T>[] {
  const out: MovingGroup<T>[] = [];
  let node: T | null = el;
  while (node && !stop(node)) {
    const parent = node.parentElement as T | null;
    let lead = 0;
    let trail = 0;
    for (let s = node.previousElementSibling; s; s = s.previousElementSibling) lead++;
    for (let s = node.nextElementSibling; s; s = s.nextElementSibling) trail++;
    if (parent && lead + trail > 0) out.push({ parent, lead, trail });
    node = parent;
  }
  return out;
}

/**
 * The elements the groups name, each group's lead then its trail. `childrenOf`
 * answers null for a container that has left the document; what it held left
 * with it and comes back as nulls, as does any slot a container no longer has
 * room for. Called before the item goes and again after, the two lists line
 * up one for one.
 */
export function movingSlots<T>(
  groups: readonly MovingGroup<T>[],
  childrenOf: (parent: T) => readonly T[] | null,
): (T | null)[] {
  return groups.flatMap(({ parent, lead, trail }) => {
    const kids = childrenOf(parent) ?? [];
    const first = Array.from({ length: lead }, (_, i) => kids[i] ?? null);
    const last = Array.from({ length: trail }, (_, i) => {
      const at = kids.length - trail + i;
      return at >= lead ? (kids[at] ?? null) : null;
    });
    return [...first, ...last];
  });
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

// A container's children, or null once it has left the document.
function liveChildren(parent: HTMLElement): HTMLElement[] | null {
  return parent.isConnected ? (Array.from(parent.children) as HTMLElement[]) : null;
}

/**
 * Measure what is around `el` while it is still in the list, and play the slide
 * when `el` leaves the document. Answers the cancel, for a delete that failed.
 * A no-op under reduced motion or where the Web Animations API is missing.
 */
export function slideWhenGone(el: HTMLElement | null): () => void {
  if (!el || reducedMotion() || typeof el.animate !== "function") return () => {};
  const play = captureSlide(movingGroups(el, scrolls));
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
function captureSlide(groups: readonly MovingGroup<HTMLElement>[]): () => void {
  const before = movingSlots(groups, liveChildren).map((m) => m?.getBoundingClientRect() ?? null);
  return () => {
    const now = movingSlots(groups, liveChildren);
    const pairs = now.flatMap((el, i) => {
      const was = before[i];
      return el && was ? [{ el, was }] : [];
    });
    const after = pairs.map((p) => p.el.getBoundingClientRect());
    slideOffsets(pairs.map((p) => p.was), after).forEach(({ dx, dy }, i) => {
      if (!dx && !dy) return;
      pairs[i]!.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: SLIDE_MS,
        easing: SLIDE_EASING,
      });
    });
  };
}
