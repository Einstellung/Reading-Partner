// The X reader's records (docs/info/88 「取材 / X」): the progress file, one line
// per step, that a run resumes from; where each search line stopped last time;
// and the device's daily allowance of X pages. Pure shapes and folds; where the
// files live is the caller's.

import type { XHalt, XLinkOut, XSearchPost } from "../x/search-page";
import { linkKey } from "../x/text-links";

/** Why a line stopped being read. */
export type XLineStop =
  | "caught-up" // 8 posts in a row seen before, or older than the last top
  | "exhausted" // screens in a row that brought nothing new
  | "bottom" // the page would not scroll further
  | "no-results"
  | "share" // took its part of the run's posts or reading time; the other lines get the rest
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
  | {
      kind: "permalink";
      line: string;
      id: string;
      status: string;
      text: string | null;
      /** The post's links out on its own page, as read there; absent in files written before 2026-10-18. */
      links?: XLinkOut[];
    }
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

/**
 * A post after its permalink page was read: the whole text when the page gave
 * it, and the links out the page showed added to the search card's, each once
 * (pitfall 657: the card of a cut-short post carries only the links in the part
 * it shows).
 */
export function afterPermalink(post: XSearchPost, text: string | null, links: readonly XLinkOut[]): XSearchPost {
  const merged = [...post.links];
  for (const l of links) {
    const same = merged.findIndex((m) => (l.tco !== null && m.tco === l.tco) || (l.url !== null && m.url !== null && linkKey(m.url) === linkKey(l.url)));
    if (same < 0) merged.push(l);
    else if (l.url && !merged[same].url) merged[same] = { ...merged[same], url: l.url };
  }
  return { ...post, ...(text ? { text, truncated: false } : {}), links: merged };
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
        if (kept) out.posts.set(step.id, { ...kept, post: afterPermalink(kept.post, step.text, step.links ?? []) });
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
    const post = withExpanded(kept.post, out.expanded);
    if (post !== kept.post) out.posts.set(id, { ...kept, post });
  }
  return out;
}

/** The post with each t.co link it carries unread given its target from `expanded`; the same post when none is there. */
export function withExpanded(post: XSearchPost, expanded: ReadonlyMap<string, string | null>): XSearchPost {
  const target = (l: XLinkOut) => (l.url === null && l.tco !== null ? (expanded.get(l.tco) ?? null) : null);
  if (!post.links.some(target)) return post;
  return { ...post, links: post.links.map((l) => ({ ...l, url: l.url ?? target(l) })) };
}

/** A running count of a run's X progress file, fed one step at a time. */
export interface XTally {
  add(step: XStep): void;
  /** "query 2 of 3, 14 screens read, 23 distinct posts found so far". */
  line(): string;
  steps(): number;
}

export function xTally(): XTally {
  let order: string[] | null = null;
  let current: string | null = null;
  const ended = new Set<string>();
  const posts = new Set<string>();
  let screens = 0;
  let permalinks = 0;
  let halt: string | null = null;
  let end: { status: XRunStatus; why: string | null } | null = null;
  let count = 0;
  return {
    add(step) {
      count++;
      switch (step.kind) {
        case "start":
          order = step.order;
          break;
        case "open":
          current = step.line;
          break;
        case "read":
          screens++;
          for (const p of step.fresh) posts.add(p.id);
          break;
        case "line-end":
          ended.add(step.line);
          break;
        case "permalink":
          permalinks++;
          break;
        case "halt":
          halt = step.halt.kind;
          break;
        case "end":
          end = { status: step.status, why: step.why };
          break;
      }
    },
    line() {
      const total = order?.length ?? null;
      const at = current && order ? order.indexOf(current) + 1 : 0;
      const counts =
        `${screens} screen${screens === 1 ? "" : "s"} read, ${posts.size} distinct post${posts.size === 1 ? "" : "s"} found` +
        (permalinks ? `, ${permalinks} post page${permalinks === 1 ? "" : "s"} opened` : "");
      const stopped = halt ? `; X stopped it (${halt})` : "";
      if (end) {
        const queries = total !== null ? `${ended.size} of ${total} queries read to their end, ` : "";
        return `finished (${end.status}${end.why ? `: ${end.why}` : ""}): ${queries}${counts}${stopped}`;
      }
      const where = total ? (at > 0 ? `query ${at} of ${total}` : `${total} queries to read`) : "starting";
      return `${where}, ${counts} so far${stopped}`;
    },
    steps: () => count,
  };
}

export function tallySteps(steps: readonly XStep[]): XTally {
  const t = xTally();
  for (const s of steps) t.add(s);
  return t;
}
