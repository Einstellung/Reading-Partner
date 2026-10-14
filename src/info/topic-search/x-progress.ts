// The X reader's records (docs/info/88 「取材 / X」): the progress file, one line
// per step, that a run resumes from; where each search line stopped last time;
// and the device's daily allowance of X pages. Pure shapes and folds; where the
// files live is the caller's.

import type { XHalt, XSearchPost } from "../x/search-page";

/** Why a line stopped being read. */
export type XLineStop =
  | "caught-up" // 8 posts in a row seen before, or older than the last top
  | "exhausted" // screens in a row that brought nothing new
  | "bottom" // the page would not scroll further
  | "no-results"
  | "limit"; // the run's or the day's ceiling came first

/** One step. `n` counts from 1 across the run, resumes included; `activeMs` is the run's reading time so far. */
export type XStep = { n: number; at: number; activeMs: number } & (
  | { kind: "start"; order: string[] }
  | { kind: "resume" }
  | { kind: "open"; line: string; url: string; status: string; landed: string | null; ms: number }
  | {
      kind: "read";
      line: string;
      screen: number;
      /** Posts on screen, in page order. */
      ids: string[];
      /** Posts kept from this read, whole. */
      fresh: XSearchPost[];
      dropped: number;
      textChars: number;
      scrollY: number;
      height: number;
    }
  | { kind: "stay"; line: string; ms: number; chars: number; why: "screen" | "long" | "sitting" | "between" }
  | { kind: "scroll"; line: string; asked: number; moved: number }
  | { kind: "line-end"; line: string; why: XLineStop; screens: number; kept: number; topId: string | null }
  | { kind: "permalink"; line: string; id: string; status: string; text: string | null }
  | { kind: "expand"; tco: string; url: string | null }
  | { kind: "halt"; halt: XHalt }
  | { kind: "end"; status: XRunStatus; why: string | null }
);

export type XRunStatus = "done" | "limit" | "quota" | "halted" | "interrupted" | "unavailable";

/** Where the progress file is kept. Append-only: a line written is never changed. */
export interface XProgressLog {
  load(): Promise<XStep[]>;
  append(step: XStep): Promise<void>;
}

/** Where a search line stopped: the newest post it has read, and every post it read in the last 30 days. */
export interface XLineMark {
  topId: string | null;
  /** Status id to when it was read, epoch ms. */
  seen: Record<string, number>;
}

/** X pages this device opened today, across all runs (88: 60 search, 80 permalink a day). */
export interface XDailyCount {
  /** Local date, YYYY-MM-DD. */
  day: string;
  search: number;
  permalink: number;
}

export interface XReaderMemory {
  marks: Record<string, XLineMark>;
  daily: XDailyCount | null;
}

/** The reader's memory across runs, on this device only. */
export interface XReaderStore {
  load(): Promise<XReaderMemory>;
  save(memory: XReaderMemory): Promise<void>;
}

export const SEEN_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Which of two status ids is newer. Ids are snowflakes, past 2^53, compared as bigints. */
export function newerId(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return BigInt(a) >= BigInt(b) ? a : b;
}

/** Whether a post on a newest-first line is at or behind where the line stopped last time. */
export function atOrBehind(id: string, topId: string | null): boolean {
  return topId !== null && BigInt(id) <= BigInt(topId);
}

/** The line's mark after a visit that read `ids`, dropping what was read over 30 days ago. */
export function markAfter(mark: XLineMark | undefined, ids: readonly string[], now: number): XLineMark {
  const seen: Record<string, number> = {};
  for (const [id, at] of Object.entries(mark?.seen ?? {})) if (now - at <= SEEN_KEEP_MS) seen[id] = at;
  let topId = mark?.topId ?? null;
  for (const id of ids) {
    seen[id] = now;
    topId = newerId(topId, id);
  }
  return { topId, seen };
}

/** Today's count: a count from another day starts over. */
export function today(daily: XDailyCount | null, day: string): XDailyCount {
  return daily && daily.day === day ? daily : { day, search: 0, permalink: 0 };
}

/** Local calendar day of `ms`. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** What a run had done when its progress file was last written. */
export interface XReplay {
  order: string[] | null;
  /** Lines whose reading ended. */
  ended: Set<string>;
  /** Kept posts by id, with the line that found them, in the order found. */
  posts: Map<string, { line: string; post: XSearchPost }>;
  /** Post ids a permalink page was opened for, and t.co links already tried. */
  permalinked: Set<string>;
  expanded: Map<string, string | null>;
  pages: { search: number; permalink: number };
  activeMs: number;
  lastN: number;
  halt: XHalt | null;
  end: { status: XRunStatus; why: string | null } | null;
  lineEnds: Map<string, { why: XLineStop; screens: number; kept: number }>;
}

/** Fold a progress file back into where the run was. */
export function replay(steps: readonly XStep[]): XReplay {
  const out: XReplay = {
    order: null,
    ended: new Set(),
    posts: new Map(),
    permalinked: new Set(),
    expanded: new Map(),
    pages: { search: 0, permalink: 0 },
    activeMs: 0,
    lastN: 0,
    halt: null,
    end: null,
    lineEnds: new Map(),
  };
  for (const step of steps) {
    out.lastN = Math.max(out.lastN, step.n);
    out.activeMs = Math.max(out.activeMs, step.activeMs);
    switch (step.kind) {
      case "start":
        out.order = step.order;
        break;
      case "open":
        out.pages.search++;
        break;
      case "read":
        for (const post of step.fresh) if (!out.posts.has(post.id)) out.posts.set(post.id, { line: step.line, post });
        break;
      case "line-end":
        out.ended.add(step.line);
        out.lineEnds.set(step.line, { why: step.why, screens: step.screens, kept: step.kept });
        break;
      case "permalink": {
        out.pages.permalink++;
        out.permalinked.add(step.id);
        const kept = out.posts.get(step.id);
        if (kept && step.text) out.posts.set(step.id, { ...kept, post: { ...kept.post, text: step.text, truncated: false } });
        break;
      }
      case "expand":
        out.expanded.set(step.tco, step.url);
        break;
      case "halt":
        out.halt = step.halt;
        break;
      case "end":
        out.end = { status: step.status, why: step.why };
        break;
    }
  }
  // A link's target found after the post was kept is written into the post.
  for (const [id, kept] of out.posts) {
    if (!kept.post.links.some((l) => l.url === null && out.expanded.get(l.tco))) continue;
    const links = kept.post.links.map((l) => (l.url === null ? { ...l, url: out.expanded.get(l.tco) ?? null } : l));
    out.posts.set(id, { ...kept, post: { ...kept.post, links } });
  }
  return out;
}
