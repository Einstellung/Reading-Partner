// Which ranked events a result lists (docs/info/88 「打分」 7). By score, with
// two reservations the first real run (2026-10-15) showed are needed: papers
// outscore posts on the final score's weights, so a result could list no post
// at all and the post-to-original comparison never run; and a picked subtopic
// whose best event ranks low could get nothing.
//
//   - up to POST_QUOTA items are post items when that many pass RESERVE_FLOOR;
//   - every picked subtopic with an event at or above RESERVE_FLOOR gets one;
//   - the remaining slots go by score, and the list stays in score order;
//   - nothing under ITEM_FLOOR is listed, so a small pool (a retry, the slow
//     part of a first look) leaves slots empty rather than topping them up with
//     what the rerank called promotion or off-topic (2026-10-17: three items
//     at score 0 in a retry).
//
// A study (docs/info/91 一份简报) lists its pinned items first, whatever their
// score and over the count, then selects the rest the same way
// (`selectStudy`); where each one sits — pinned, main or a Note — is the
// update's (update.ts placeOf), a demoted one going straight to the Notes.
//
// A post item is an event cluster with a post among its members whose own final
// score passes the floor. A post merged into the event of the paper (repo,
// page) it quotes counts, though the paper leads: the item lists the post and
// verify compares what the post says with that original, which is the point of
// the quota. A post that only joined a paper's cluster weakly scored does not.

/** Items of a result reserved for post items (88 「打分」 7). */
export const POST_QUOTA = 3;
/**
 * Final score an event (for the post quota: the post itself) must reach to be
 * reserved a slot. A post the rerank put at 40 or more with some fusion and
 * engagement lands around here; promotion and off-topic posts (rerank under
 * the cliff, times 0.3) stay well below.
 */
export const RESERVE_FLOOR = 40;
/**
 * Final score an event must reach to be listed at all. The rerank's cliff
 * (score under 20, times 0.3) puts promotion, one-line replies and off-topic
 * posts under it; a paper the rerank put at 25 or more stays above it (initial
 * value).
 */
export const ITEM_FLOOR = 20;

export interface SelectView<T> {
  score(t: T): number;
  /** The best final score among the item's post members; null when it has none (or must not count). */
  postScore(t: T): number | null;
  subtopic(t: T): string | null;
}

/**
 * The `want` items to list from `ranked` (best first), in `ranked` order:
 * reserved post items, then each picked subtopic's best qualifying item, then
 * by score down to ITEM_FLOOR; fewer than `want` when the rest is under it.
 */
export function selectItems<T>(ranked: readonly T[], want: number, picked: readonly string[], view: SelectView<T>): T[] {
  const chosen = new Set<number>();
  let posts = 0;
  for (const [i, t] of ranked.entries()) {
    if (chosen.size >= want || posts >= POST_QUOTA) break;
    const p = view.postScore(t);
    if (p !== null && p >= RESERVE_FLOOR) {
      chosen.add(i);
      posts++;
    }
  }
  for (const s of picked) {
    if (chosen.size >= want) break;
    if ([...chosen].some((i) => view.subtopic(ranked[i]) === s)) continue;
    const i = ranked.findIndex((t) => view.subtopic(t) === s && view.score(t) >= RESERVE_FLOOR);
    if (i >= 0) chosen.add(i);
  }
  for (const [i, t] of ranked.entries()) {
    if (chosen.size >= want) break;
    if (view.score(t) >= ITEM_FLOOR) chosen.add(i);
  }
  return [...chosen].sort((a, b) => a - b).map((i) => ranked[i]);
}

/**
 * The events the history check looks at: the best `top`, plus any further
 * down that a reservation could still take (a post item or a picked subtopic's
 * event at or above the floor), in `ranked` order.
 */
export function shortlist<T>(ranked: readonly T[], top: number, picked: readonly string[], view: SelectView<T>): T[] {
  const pickedSet = new Set(picked);
  return ranked.filter((t, i) => {
    if (i < top) return true;
    const p = view.postScore(t);
    if (p !== null && p >= RESERVE_FLOOR) return true;
    const s = view.subtopic(t);
    return s !== null && pickedSet.has(s) && view.score(t) >= RESERVE_FLOOR;
  });
}

/**
 * A study's items (docs/info/91 更新): every pinned one first, in `ranked`
 * order and never dropped, then `selectItems` over the rest for what is left
 * of `want`.
 */
export function selectStudy<T>(
  ranked: readonly T[],
  want: number,
  picked: readonly string[],
  view: SelectView<T> & { pinned(t: T): boolean },
): T[] {
  const pinned = ranked.filter((t) => view.pinned(t));
  const rest = ranked.filter((t) => !view.pinned(t));
  return [...pinned, ...selectItems(rest, Math.max(0, want - pinned.length), picked, view)];
}
