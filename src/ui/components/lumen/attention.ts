// Where Lumen is looking, from what the turn is doing (docs/66 "四段"). The
// check act — eyes down on the desk, two quick scans, then back up — is driven
// by a real event and nothing else: a tool call in flight. No model output is
// involved, which is why this can run today while SoulIntent's `attention`
// field is still ahead of us.
//
// Display maths with no React in it, beside lumen-motion.ts, for the same
// reason: the numbers below are the ones worth a test, and a component is not
// where they can have one.

import type { TurnActivity } from "../../../ai/activity";
import type { Attention } from "./lumen-motion";

/**
 * The shortest a glance at the desk lasts. The scan itself takes about 400 ms
 * (lumen-motion.ts) and the crossfade between acts another 280 ms, so a 50 ms
 * tool call with no floor under it would be a twitch rather than a look.
 */
export const WORK_DWELL_MS = 600;

/**
 * How long the desk stays interesting after the last tool came back. A turn
 * that calls three tools in a row leaves gaps of a few milliseconds between
 * them, and without this the head would bob up and down once per tool.
 */
export const WORK_LINGER_MS = 250;

/**
 * What has happened on the turn so far, folded down to the three numbers the
 * answer needs. Not a list of events: a long call would grow one forever.
 */
export interface LumenActivity {
  /** Tool calls started and not yet finished. */
  running: number;
  /** When the current stretch of work began, or null when there is none. */
  workSince: number | null;
  /** When the last tool of the current stretch came back. */
  lastEndAt: number | null;
}

/** Nothing has happened. */
export function noActivity(): LumenActivity {
  return { running: 0, workSince: null, lastEndAt: null };
}

/** When the glance would end, were nothing else to happen. */
function workUntil(state: LumenActivity): number {
  const since = state.workSince ?? 0;
  const end = state.lastEndAt ?? since;
  return Math.max(since + WORK_DWELL_MS, end + WORK_LINGER_MS);
}

/**
 * Where the eyes go. `work` from the first tool start until the last tool end,
 * held for the dwell and the linger above; `reader` the rest of the time.
 *
 * `away` is not produced here. It is a thing the soul would have to say about
 * itself, and this file only reads what the app can see.
 */
export function attentionFrom(state: LumenActivity, now: number): Attention {
  if (state.workSince === null) return "reader";
  if (state.running > 0) return "work";
  return now < workUntil(state) ? "work" : "reader";
}

/**
 * Fold one event in. A start while the eyes are already down joins the stretch
 * in progress rather than restarting its dwell — the floor is on the glance,
 * not on each tool. An end with no start is ignored, so a driver that closes a
 * dropped turn twice cannot push the count below zero.
 */
export function applyActivity(
  state: LumenActivity,
  event: TurnActivity,
  now: number,
): LumenActivity {
  if (event.kind !== "tool") return state;
  if (event.phase === "start") {
    // A stretch that has already ended is not extended: the next glance is a
    // new one and gets the whole dwell.
    const fresh = attentionFrom(state, now) === "reader";
    return {
      running: state.running + 1,
      workSince: fresh ? now : (state.workSince ?? now),
      lastEndAt: fresh ? null : state.lastEndAt,
    };
  }
  if (state.running === 0) return state;
  return { running: state.running - 1, workSince: state.workSince, lastEndAt: now };
}

/**
 * When the answer would change on its own, so a caller can set one timer for it
 * rather than polling. Null while a tool is still out (the next event decides)
 * and null once the eyes are back on the reader.
 */
export function attentionEndsAt(state: LumenActivity, now: number): number | null {
  if (state.workSince === null || state.running > 0) return null;
  const until = workUntil(state);
  return until > now ? until : null;
}
