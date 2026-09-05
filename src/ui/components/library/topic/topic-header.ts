// The line under a topic's name (docs/51): how much is in it and when it was
// last touched. Files and marks only — a conversation count says nothing about
// the reading, and the header is not a dashboard.

import type { BookMeta } from "../../shelf/file-title";
import type { Topic } from "../../../../platform/app/topics";

const DAY = 24 * 60 * 60 * 1000;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// The most recent time any file in the topic was opened, or null for a topic
// nobody has read yet.
export function lastReadAt(topic: Topic): number | null {
  const times = topic.files.map((f) => f.lastOpenedAt ?? 0).filter((t) => t > 0);
  return times.length ? Math.max(...times) : null;
}

// Calendar days apart, not elapsed milliseconds: something read at 23:50 was
// read yesterday at 00:10, whatever the clock says about the fourteen minutes.
export function relativeDayLabel(at: number, now: Date): string {
  const then = new Date(at);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(then)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return plural(Math.floor(days / 7), "week") + " ago";
  if (days < 365) return plural(Math.floor(days / 30), "month") + " ago";
  return plural(Math.floor(days / 365), "year") + " ago";
}

// Marks across every file in the topic. The reads are the shelf's own
// (book-meta.ts); a file whose meta has not landed yet contributes nothing,
// which is what an unfinished count looks like rather than a wrong one.
export function totalMarks(topic: Topic, meta: Record<string, BookMeta>): number {
  return topic.files.reduce((n, f) => n + (meta[f.path]?.marks ?? 0), 0);
}

export function topicHeaderLine(topic: Topic, meta: Record<string, BookMeta>, now: Date): string {
  const parts = [plural(topic.files.length, "file")];
  const marks = totalMarks(topic, meta);
  if (marks) parts.push(plural(marks, "mark"));
  const read = lastReadAt(topic);
  if (read) parts.push(`last read ${relativeDayLabel(read, now)}`);
  return parts.join(" · ");
}
