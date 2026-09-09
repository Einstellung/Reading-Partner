// The lines on the Today screen (docs/51), minus React. Every one of them is
// computed from something already on disk — a reading position, an annotation
// file, the briefing's own counts. Nothing here goes through the model: a
// sentence a model wrote about what you are reading is a sentence that can be
// wrong about a number the app already knows (memory: no facts through the
// model).

import type { Briefing } from "../../../info/collect/types";
import type { BookMeta } from "../shelf/file-title";

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// The date above the heading, in the device's own locale and calendar. No year:
// the screen is called Today.
export function todayDateLine(now: Date, locale?: string): string {
  return now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

// The line under a Continue reading title: which question the book is read
// against, where the reader left off, and how much of it is marked. A book that
// was never opened contributes neither of the last two, so the line is just the
// topic — which is still worth saying.
export function continueMetaLine(topicName: string, meta: BookMeta | undefined): string {
  const parts = [topicName];
  if (meta?.page) parts.push(meta.pages ? `p. ${meta.page} of ${meta.pages}` : `p. ${meta.page}`);
  if (meta?.marks) parts.push(plural(meta.marks, "mark"));
  return parts.join(" · ");
}

// When the briefing was built, in local time. A reader can be looking at one
// made hours ago on another machine, or — after midnight, or in another timezone
// — at yesterday's, which is the right thing to show as long as it says so.
export function builtAt(generatedAt: number, now: Date = new Date()): string {
  const at = new Date(generatedAt);
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? time : `${at.toLocaleDateString()} ${time}`;
}

// The briefing card's eyebrow.
export function briefingEyebrow(briefing: Briefing | null, now: Date = new Date()): string {
  return briefing ? `Today's briefing · built ${builtAt(briefing.generatedAt, now)}` : "Today's briefing";
}

// The line under the card's two rows: what the card is not showing. The
// out-of-lane pick and the one-liners are on the briefing page; the filtered
// ones are a count the reader can open and argue with.
export function briefingFooterLine(briefing: Briefing): string {
  return [
    `${briefing.outOfLane.length} out of your lane`,
    plural(briefing.oneLiners.length, "one-liner"),
    `${(briefing.filtered ?? []).length} filtered`,
  ].join(" · ");
}

// How many of the day's picks the card shows before the footer takes over.
export const TODAY_CARD_ITEMS = 2;
