// The dot on the phone's Learn button (docs/77). The lesson is left open while
// the reader is back on the page — the call is only not drawn — so everything
// the dot says is read off the open call: a reply still being written, or one
// that finished after the reader last had the lesson on screen.
//
// "Last had it on screen" is kept by the shell as a timestamp and moved forward
// by seenReplyTs on every render: while the lesson is showing, every finished
// reply in it has been seen.

import type { CallRow, CallView } from "../call-state";

export type LessonDot =
  // Pulsing: a reply is being written.
  | "writing"
  // Steady: a reply finished that the reader has not looked at.
  | "unseen"
  | null;

export interface LessonDotCall {
  isBook?: boolean;
  view: CallView;
  messages: readonly Pick<CallRow, "role" | "ts" | "streaming">[];
}

// When the last reply that is done being written was started; null when there
// is none.
function lastReplyTs(messages: LessonDotCall["messages"]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "ai" && !m.streaming) return m.ts;
  }
  return null;
}

/** The newest reply the reader has seen, from what was seen before and the call now. */
export function seenReplyTs(prev: number | null, call: LessonDotCall | null): number | null {
  if (!call?.isBook || call.view !== "chat-main") return prev;
  return lastReplyTs(call.messages);
}

/** What the Learn button's dot shows while the page is on screen. */
export function lessonDot(call: LessonDotCall | null, seen: number | null): LessonDot {
  // No lesson open, or the lesson is what is on screen: nothing to point at.
  if (!call?.isBook || call.view === "chat-main") return null;
  if (call.messages.some((m) => m.streaming)) return "writing";
  const last = lastReplyTs(call.messages);
  return last !== null && (seen === null || last > seen) ? "unseen" : null;
}
