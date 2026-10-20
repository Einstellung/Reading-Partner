// The X reader of a topic-search run (docs/info/88 「取材 / X」, the run's `read`
// phase): given search lines (a query, an order, a window), read each one in
// the browse session the way a person reads a timeline, and hand back what the
// program read off the pages. No model is called here.
//
// A line is read screen by screen: read the posts in the DOM, stay as long as
// the new text on screen takes to read, now and then a long pause, scroll most
// of a screen in a few small steps. It stops at where it stopped last time (8
// posts in a row seen before, or, newest first, older than the newest post read
// last time), when screens stop bringing anything new, or at a ceiling. Lines
// go in a shuffled order, reading comes in sittings with breaks between, and
// every search and permalink page counts against the run's ceiling and the
// device's daily allowance. A cut-short post that clears the local relevance
// floor gets its permalink page opened for the whole text and the links out of
// it, which the search card did not show (pitfall 657). The floor is measured
// on the same words the build measures it on (rank-pool.ts relevanceBasis:
// the X query, not the ranking question, which may be in another language,
// pitfall 660). When nearly every post of the run scores 0 the floor has
// stopped telling anything apart: the run writes a warning and opens the
// first few cut-short posts of each line in page order instead.
//
// The session is opened with X's capture script (info/x/search-capture.ts):
// the page's own GraphQL answers are copied as they arrive and drained after
// every screen, nothing requested or changed. A kept post an answer covers
// takes its whole text, links and counts from there, so its permalink page is
// not opened; the DOM reading stays the primary path and the fallback, and the
// two are cross-checked. When enough posts are read and no answer covered any
// of them, the run writes a warning (the hook is gone or X changed the shape)
// and reads on exactly as without it.
//
// Every step is a line in the progress file. Called again with the same file,
// the run picks up where it was: finished lines are not read again, kept posts
// come back from the file, and a run that already ended answers from the file
// without opening anything. The first sign that X wants the reader gone —
// signed out, a challenge, a limit message, three screens in a row with page
// text and no posts — ends the run on the spot (88 「停手」); the caller is told
// once, to put it in the collector's state file.
//
// Phase 3's run calls `readXSearch`, inside its keep-awake hold.

import type { BrowseOpen, BrowseSession } from "../../workshop/extract/webview-browse";
import { localRelevance, prepareQuery, RELEVANCE_FLOOR, type PreparedQuery } from "../rank/relevance";
import type { XCapturedPost } from "../x/graphql-post";
import { bodyText, focalPost, outboundLinks, parsePermalinkResult, PERMALINK_SCRIPT, postBodyLines } from "../x/permalink";
import {
  noResults,
  PAGE_CHROME_SCRIPT,
  pageHalt,
  parseSearchRead,
  SEARCH_PAGE_SCRIPT,
  SEARCH_READY,
  xSearchUrl,
  type XHalt,
  type XLinkOut,
  type XSearchLineSpec,
  type XSearchPost,
} from "../x/search-page";
import { captureMismatch, mergeLinks, parseCaptureDrain, withCaptured, X_CAPTURE_DRAIN, X_CAPTURE_SCRIPT } from "../x/search-capture";
import { draw, drawInt, fitViewport, screenStayMs, scrollSteps, X_PACE, type XPace } from "./x-pace";
import {
  afterPermalink,
  atOrBehind,
  localDay,
  markAfter,
  replay,
  today,
  type XCaptureSilent,
  type XDailyCount,
  type XLineStop,
  type XProgressLog,
  type XReaderMemory,
  type XReaderStore,
  type XRelevanceCollapse,
  type XReplay,
  type XRunStatus,
  type XStep,
  withExpanded,
} from "./x-progress";

const MIN = 60_000;

/** One search line of a run. `key` names it across runs: the topic search's id and the query's. */
export interface XReadLine extends XSearchLineSpec {
  key: string;
  /** What the local relevance floor is measured against: the words the build measures it on (rank-pool.ts relevanceBasis). */
  relevance: string;
}

export interface XReadLimits {
  /** Posts kept. */
  posts: number;
  searchPages: number;
  permalinkPages: number;
  /** Reading time, breaks between sittings not counted. */
  activeMs: number;
}

/** 88: a night, every topic together. */
export const X_NIGHTLY_LIMITS: XReadLimits = { posts: 400, searchPages: 30, permalinkPages: 40, activeMs: 150 * MIN };
/** 88: a topic's first run. */
export const X_FIRST_RUN_LIMITS: XReadLimits = { posts: 300, searchPages: 12, permalinkPages: 40, activeMs: 150 * MIN };
/** 88: X pages a device opens in a day, every run together. */
export const X_DAILY_ALLOWANCE = { search: 60, permalink: 80 };

/** Posts in a row already read that end a line. */
export const SEEN_IN_A_ROW = 8;
/** Screens in a row with nothing new that end a line. */
export const QUIET_SCREENS = 4;
/** Screens in a row with page text but no posts that mean the page changed under the script. */
export const EMPTY_SCREENS = 3;
/** Page text, in characters, that counts as a page that loaded. */
export const LOADED_PAGE_CHARS = 400;
/** Scrolls in a row that move nothing that end a line. */
export const STUCK_SCROLLS = 2;

/** Posts scored, across the run's lines, before the relevance alarm may go off. */
export const COLLAPSE_MIN_POSTS = 60;
/** Share of posts scoring 0 that sets off the alarm. */
export const COLLAPSE_ZERO_SHARE = 0.9;
/** Cut-short posts per line opened in page order once the alarm went off and the floor passes none. */
export const COLLAPSE_FALLBACK = 3;

/** Posts kept, across the run's lines since the page was opened, with none covered by a captured answer, before the capture alarm goes off. */
export const CAPTURE_MIN_POSTS = 20;

const PAGE_TIMEOUT_MS = 60_000;
const PERMALINK_READY = `document.querySelectorAll("article").length > 0 || !location.pathname.includes("/status/")`;
const SCREEN_SCRIPT = `({ availWidth: screen.availWidth, availHeight: screen.availHeight })`;

export interface XReadInput {
  lines: XReadLine[];
  limits: XReadLimits;
  pace?: XPace;
  allowance?: { search: number; permalink: number };
  relevanceFloor?: number;
  /** Open the session with X's capture script (search-capture.ts). Default true. */
  capture?: boolean;
}

export interface XReadDeps {
  /** Open the browse session at this viewport, with this document-start script when given (`openBrowse` with both). */
  open(viewport: { width: number; height: number }, opts?: { initScript?: string }): Promise<BrowseOpen>;
  progress: XProgressLog;
  memory: XReaderStore;
  /** Where a t.co link goes, read off its redirect (info/x/outbound.ts), or null. */
  expandLink(tco: string): Promise<string | null>;
  /** The run stopped on X's say-so. Called once; the caller writes it to the collector's state file. */
  onHalt(halt: XHalt): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  random(): number;
}

export interface XReadResult {
  status: XRunStatus;
  why: string | null;
  halt: XHalt | null;
  /** Kept posts in the order found, each with the line that found it. */
  posts: { line: string; post: XSearchPost }[];
  lines: { key: string; why: XLineStop; screens: number; kept: number }[];
  pages: { search: number; permalink: number };
  activeMs: number;
  /** Set when nearly every post scored 0 relevance (relevanceCollapse). */
  collapse?: XRelevanceCollapse | null;
  /** Set when enough posts were read and no captured answer covered any (CAPTURE_MIN_POSTS). */
  captureSilent?: XCaptureSilent | null;
}

/** One line's part of what is left of the run's ceilings (Run.share). */
export interface LineShare {
  posts: number;
  activeMs: number;
}

class Stop {
  constructor(
    readonly status: XRunStatus,
    readonly why: string | null,
  ) {}
}

/** Read the lines, or pick up a run that was cut off, from its progress file. */
export async function readXSearch(input: XReadInput, deps: XReadDeps): Promise<XReadResult> {
  const past = replay(await deps.progress.load());
  const run = new Run(input, deps, past, await deps.memory.load());
  if (past.end) return run.result(past.end.status, past.end.why);
  if (past.halt) return run.result("halted", past.halt.detail);
  return run.go();
}

class Run {
  private readonly pace: XPace;
  private readonly allowance: { search: number; permalink: number };
  private readonly floor: number;
  private n: number;
  private active: number;
  private clock = 0;
  private sittingsLeft = 0;
  private sittingEnd = 0;
  private daily: XDailyCount;
  private halted: XHalt | null;
  private readonly capture: boolean;
  /** Posts out of the answers drained so far this session, by id. */
  private readonly captured = new Map<string, XCapturedPost>();
  private bodies = 0;
  /** Posts kept since this call opened the page: a run picked up from a file written before capture existed has none captured. */
  private keptHere = 0;

  constructor(
    private readonly input: XReadInput,
    private readonly deps: XReadDeps,
    private readonly past: XReplay,
    private readonly memory: XReaderMemory,
  ) {
    this.pace = input.pace ?? X_PACE;
    this.allowance = input.allowance ?? X_DAILY_ALLOWANCE;
    this.floor = input.relevanceFloor ?? RELEVANCE_FLOOR;
    this.n = past.lastN;
    this.active = past.activeMs;
    this.daily = today(memory.daily, localDay(deps.now()));
    this.halted = past.halt;
    this.capture = input.capture ?? true;
  }

  result(status: XRunStatus, why: string | null): XReadResult {
    return {
      status,
      why,
      halt: this.halted,
      posts: [...this.past.posts.values()],
      lines: [...this.past.lineEnds].map(([key, end]) => ({ key, ...end })),
      pages: { ...this.past.pages },
      activeMs: Math.round(this.active),
      collapse: this.past.collapse,
      captureSilent: this.past.captureSilent,
    };
  }

  async go(): Promise<XReadResult> {
    const keys = this.input.lines.map((l) => l.key);
    let order = this.past.order;
    if (order) {
      order = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order!.includes(k))];
      await this.log({ kind: "resume" });
    } else {
      order = shuffle(keys, this.deps.random);
      await this.log({ kind: "start", order });
    }
    const session = await this.openPage();
    if (!session) return this.result("unavailable", "no browse session");
    this.clock = this.deps.now();
    this.sittingsLeft = drawInt(this.pace.segments, this.deps.random);
    this.sittingEnd = this.active + draw(this.pace.segmentMs, this.deps.random);
    const byKey = new Map(this.input.lines.map((l) => [l.key, l]));
    let opened = 0;
    try {
      // Lines that ended before an interruption may still owe their follow-ups.
      for (const key of order) {
        const line = byKey.get(key);
        if (line && this.past.ended.has(key)) await this.followUp(session, line);
      }
      for (const key of order) {
        const line = byKey.get(key);
        if (!line || this.past.ended.has(key)) continue;
        this.checkCeilings(true);
        if (opened++ > 0) await this.stay(draw(this.pace.betweenPagesMs, this.deps.random), 0, "between", key);
        await this.readLine(session, line, this.share(order));
        await this.followUp(session, line);
      }
      return await this.finish("done", null);
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      // A ceiling ends the reading, not the follow-ups of what was read: they
      // keep to their own ceilings (followUp checks them).
      if (e.status === "limit" || e.status === "quota") {
        try {
          for (const key of order) {
            const line = byKey.get(key);
            if (line && this.past.ended.has(key)) await this.followUp(session, line);
          }
        } catch (late) {
          if (late instanceof Stop) return await this.finish(late.status, late.why);
          throw late;
        }
      }
      return await this.finish(e.status, e.why);
    } finally {
      await session.close().catch(() => false);
    }
  }

  // --- the page ---------------------------------------------------------------

  /** Open the session at the pace's viewport, cut to what the screen it is on could show. */
  private async openPage(): Promise<BrowseSession | null> {
    const opts = this.capture ? { initScript: X_CAPTURE_SCRIPT } : {};
    let opened = await this.deps.open(this.pace.viewport, opts);
    if (opened.status !== "ok") return null;
    const probe = await opened.session.evaluate(SCREEN_SCRIPT);
    const screen = probe.value as { availWidth?: unknown; availHeight?: unknown } | null;
    const fit = fitViewport(
      this.pace.viewport,
      screen && typeof screen.availWidth === "number" && typeof screen.availHeight === "number"
        ? { availWidth: screen.availWidth, availHeight: screen.availHeight }
        : null,
    );
    if (fit.width === this.pace.viewport.width && fit.height === this.pace.viewport.height) return opened.session;
    await opened.session.close();
    opened = await this.deps.open(fit, opts);
    return opened.status === "ok" ? opened.session : null;
  }

  /**
   * What the next line may take of what is left: an even split of the posts
   * and the reading time among the lines not yet read, so one busy query
   * cannot spend the whole run while the others are never opened. A line that
   * stops short leaves its unspent part to the ones after it. The last line
   * has no share: the run's ceilings end it.
   */
  share(order: readonly string[]): LineShare | null {
    const left = order.filter((k) => !this.past.ended.has(k)).length;
    if (left <= 1) return null;
    const { limits } = this.input;
    return {
      posts: Math.max(1, Math.ceil((limits.posts - this.past.posts.size) / left)),
      activeMs: Math.max(0, (limits.activeMs - this.active) / left),
    };
  }

  private async readLine(session: BrowseSession, line: XReadLine, share: LineShare | null): Promise<void> {
    const key = line.key;
    const startedActive = this.active;
    const mark = this.memory.marks[key];
    if (this.daily.search >= this.allowance.search) throw new Stop("quota", "search pages for today used up");
    const url = xSearchUrl(line);
    const load = await session.navigate(url, { until: SEARCH_READY, timeoutMs: PAGE_TIMEOUT_MS });
    this.past.pages.search++;
    this.daily = { ...this.daily, search: this.daily.search + 1 };
    await this.saveMemory();
    await this.log({ kind: "open", line: key, url, status: load.status, landed: load.url, ms: load.elapsedMs });
    // A timeout is not a failure: X pages often finish loading long after the
    // posts show (docs/pitfall/496). The script decides.
    if (load.status !== "ok" && load.status !== "timeout") throw new Stop("interrupted", `search page: ${load.status} ${load.detail ?? ""}`.trim());

    const readIds: string[] = [];
    const inDom = new Set<string>();
    const counted = new Set<string>();
    let screens = 0;
    let kept = 0;
    let empty = 0;
    let quiet = 0;
    let stuck = 0;
    let seenRow = 0;
    let nextLong = drawInt(this.pace.longPauseEvery, this.deps.random);
    let why: XLineStop;
    const end = async (stop: XLineStop) => {
      const after = markAfter(mark, readIds, this.deps.now());
      this.memory.marks[key] = after;
      await this.saveMemory();
      this.past.ended.add(key);
      this.past.lineEnds.set(key, { why: stop, screens, kept });
      await this.log({ kind: "line-end", line: key, why: stop, screens, kept, topId: after.topId });
    };

    try {
      for (;;) {
        const ev = await session.evaluate(SEARCH_PAGE_SCRIPT);
        if (ev.status !== "ok") throw new Stop("interrupted", `search page script: ${ev.status}`);
        const read = parseSearchRead(ev.value);
        await this.drain(session);
        if (read) {
          const halt = pageHalt(read, "search");
          if (halt) await this.halt(halt);
          if (read.posts.length === 0 && noResults(read)) {
            why = "no-results";
            break;
          }
        }
        if (!read || read.posts.length === 0) {
          if (!read || read.textChars >= LOADED_PAGE_CHARS) empty++;
          if (empty >= EMPTY_SCREENS) {
            await this.halt({
              kind: "structure",
              detail: `${empty} screens with page text and no posts read${ev.error ? ` (${ev.error.slice(0, 120)})` : ""}`,
            });
          }
        } else {
          empty = 0;
        }

        const fresh: XSearchPost[] = [];
        const filled: string[] = [];
        const mismatches: { id: string; why: string }[] = [];
        let arrived = 0;
        let caughtUp = false;
        for (const { post } of read?.posts ?? []) {
          if (inDom.has(post.id)) continue;
          inDom.add(post.id);
          arrived++;
          readIds.push(post.id);
          const before =
            mark?.seen[post.id] !== undefined || (line.order === "live" && atOrBehind(post.id, mark?.topId ?? null));
          if (before) {
            if (++seenRow >= SEEN_IN_A_ROW) {
              caughtUp = true;
              break;
            }
            continue;
          }
          seenRow = 0;
          if (this.past.posts.has(post.id)) continue;
          const cap = this.captured.get(post.id);
          const why = cap ? captureMismatch(post, cap) : null;
          if (why) mismatches.push({ id: post.id, why });
          // A different author means the answer is not this post: the card stands alone.
          const usable = cap && (cap.handle === null || cap.handle.toLowerCase() === post.handle.toLowerCase());
          const whole = usable ? withCaptured(post, cap) : post;
          if (usable) {
            filled.push(post.id);
            this.past.captured.add(post.id);
          }
          this.past.posts.set(post.id, { line: key, post: whole });
          fresh.push(whole);
          kept++;
          this.keptHere++;
        }
        let chars = 0;
        for (const p of read?.posts ?? []) {
          if (!p.onScreen || counted.has(p.post.id)) continue;
          counted.add(p.post.id);
          chars += this.pace.count === "text" ? p.readChars : p.wholeChars;
        }
        await this.log({
          kind: "read",
          line: key,
          screen: screens,
          ids: (read?.posts ?? []).filter((p) => p.onScreen).map((p) => p.post.id),
          fresh,
          dropped: read?.dropped.length ?? 0,
          textChars: read?.textChars ?? 0,
          scrollY: read?.scrollY ?? 0,
          height: read?.height ?? 0,
          ...(filled.length ? { captured: filled } : {}),
        });
        for (const m of mismatches) await this.log({ kind: "capture-mismatch", line: key, ...m });
        await this.watchCapture();
        if (caughtUp) {
          why = "caught-up";
          break;
        }
        if (share && (kept >= share.posts || this.active - startedActive >= share.activeMs)) {
          why = "share";
          break;
        }
        quiet = arrived === 0 ? quiet + 1 : 0;
        if (quiet >= QUIET_SCREENS) {
          why = "exhausted";
          break;
        }

        await this.stay(screenStayMs(chars, this.pace, this.deps.random), chars, "screen", key);
        screens++;
        if (screens >= nextLong) {
          await this.stay(draw(this.pace.longPauseMs, this.deps.random), 0, "long", key);
          nextLong = screens + drawInt(this.pace.longPauseEvery, this.deps.random);
        }
        this.checkCeilings(false);
        await this.sitting(key);

        let asked = 0;
        let moved = 0;
        for (const dy of scrollSteps(read?.viewport || this.pace.viewport.height, this.pace, this.deps.random)) {
          const s = await session.scrollBy(dy);
          if (s.status !== "ok") throw new Stop("interrupted", `scroll: ${s.status}`);
          asked += dy;
          moved += s.after - s.before;
          await this.pause(draw(this.pace.stepGapMs, this.deps.random));
        }
        await this.log({ kind: "scroll", line: key, asked, moved });
        stuck = moved <= 0 ? stuck + 1 : 0;
        if (stuck >= STUCK_SCROLLS) {
          why = "bottom";
          break;
        }
      }
    } catch (e) {
      // What was read stays read: the mark moves before the run stops.
      if (e instanceof Stop && e.status !== "interrupted") await end("limit");
      throw e;
    }
    await end(why);
  }

  /**
   * After a line: its own follow-ups. When this line sets off the relevance
   * alarm, the lines already followed up get theirs again, now with the
   * page-order fallback.
   */
  private async followUp(session: BrowseSession, line: XReadLine): Promise<void> {
    const fired = await this.watchRelevance();
    await this.followUpLine(session, line);
    if (!fired) return;
    for (const other of this.input.lines) {
      if (other.key !== line.key && this.past.ended.has(other.key)) await this.followUpLine(session, other);
    }
  }

  /** Score every kept post against its line; write the alarm the first time it goes off. True when it went off now. */
  private async watchRelevance(): Promise<boolean> {
    if (this.past.collapse) return false;
    const byKey = new Map(this.input.lines.map((l) => [l.key, prepareQuery(l.relevance)]));
    const scores: number[] = [];
    for (const { line, post } of this.past.posts.values()) {
      const query = byKey.get(line);
      if (query) scores.push(localRelevance(query, postText(post)));
    }
    const collapse = relevanceCollapse(scores);
    if (!collapse) return false;
    this.past.collapse = collapse;
    await this.log({ kind: "relevance-collapse", ...collapse });
    return true;
  }

  /** A line's follow-ups: links out that the page did not spell out, and permalink pages for cut-short posts worth it. */
  private async followUpLine(session: BrowseSession, line: XReadLine): Promise<void> {
    const mine = [...this.past.posts.values()].filter((k) => k.line === line.key);
    for (const kept of mine) await this.expandLinks(kept.post.id);

    const owed = permalinkPicks(
      mine.map((k) => k.post),
      prepareQuery(line.relevance),
      { floor: this.floor, collapsed: this.past.collapse !== null, permalinked: this.past.permalinked },
    );
    for (const post of owed) {
      if (this.past.pages.permalink >= this.input.limits.permalinkPages) return;
      if (this.daily.permalink >= this.allowance.permalink) return;
      if (this.active >= this.input.limits.activeMs) return;
      await this.stay(draw(this.pace.screenExtraMs, this.deps.random), 0, "between", line.key);
      const load = await session.navigate(post.permalink, { until: PERMALINK_READY, timeoutMs: PAGE_TIMEOUT_MS });
      this.past.pages.permalink++;
      this.past.permalinked.add(post.id);
      this.daily = { ...this.daily, permalink: this.daily.permalink + 1 };
      await this.saveMemory();
      if (load.status !== "ok" && load.status !== "timeout") {
        await this.log({ kind: "permalink", line: line.key, id: post.id, status: load.status, text: null });
        throw new Stop("interrupted", `permalink page: ${load.status}`);
      }
      const chrome = await session.evaluate(PAGE_CHROME_SCRIPT);
      const c = chrome.value as { path?: unknown; chrome?: unknown; loginWall?: unknown } | null;
      if (c && typeof c.path === "string") {
        const halt = pageHalt({ path: c.path, chrome: String(c.chrome ?? ""), loginWall: c.loginWall === true }, "status");
        if (halt) {
          await this.log({ kind: "permalink", line: line.key, id: post.id, status: "halt", text: null });
          await this.halt(halt);
        }
      }
      const ev = await session.evaluate(PERMALINK_SCRIPT);
      const read = permalinkRead(ev.value, post);
      await this.drain(session);
      const cap = this.captured.get(post.id);
      const fromAnswer = cap && cap.text && !cap.article && !captureMismatch(post, cap) ? cap : null;
      const whole = fromAnswer ? fromAnswer.text : (read?.text ?? null);
      const links = fromAnswer ? mergeLinks(read?.links ?? [], fromAnswer.links) : (read?.links ?? []);
      // The links are written with the step, so a run picked up from the file keeps them.
      await this.log({
        kind: "permalink",
        line: line.key,
        id: post.id,
        status: whole ? "ok" : "unread",
        text: whole,
        links,
        ...(fromAnswer ? { source: "captured" as const } : {}),
      });
      const kept = this.past.posts.get(post.id)!;
      this.past.posts.set(post.id, { ...kept, post: afterPermalink(kept.post, whole, links) });
      if (fromAnswer) this.past.captured.add(post.id);
      await this.expandLinks(post.id);
      if (whole) {
        const extra = Math.max(0, whole.length - post.text.length);
        await this.stay(screenStayMs(extra, this.pace, this.deps.random), extra, "screen", line.key);
      }
    }
  }

  /** Take the answers the page kept since the last drain. Capture is a help, never a reason to stop: a page that does not answer gives nothing. */
  private async drain(session: BrowseSession): Promise<void> {
    if (!this.capture) return;
    const ev = await session.evaluate(X_CAPTURE_DRAIN);
    if (ev.status !== "ok") return;
    this.bodies += parseCaptureDrain(ev.value, this.captured).bodies;
  }

  /** The capture alarm: enough posts kept and none covered by an answer. Written once a run. */
  private async watchCapture(): Promise<void> {
    if (!this.capture || this.past.captureSilent || this.past.captured.size > 0) return;
    if (this.keptHere < CAPTURE_MIN_POSTS) return;
    this.past.captureSilent = { posts: this.keptHere, bodies: this.bodies };
    await this.log({ kind: "capture-silent", ...this.past.captureSilent });
  }

  /** Where each t.co link of a kept post goes that the page did not spell out, asked once a run. */
  private async expandLinks(id: string): Promise<void> {
    const kept = this.past.posts.get(id);
    if (!kept) return;
    for (const link of kept.post.links) {
      if (link.url !== null || link.tco === null || this.past.expanded.has(link.tco)) continue;
      const url = await this.deps.expandLink(link.tco).catch(() => null);
      this.past.expanded.set(link.tco, url);
      await this.log({ kind: "expand", tco: link.tco, url });
    }
    const post = withExpanded(kept.post, this.past.expanded);
    if (post !== kept.post) this.past.posts.set(id, { ...kept, post });
  }

  // --- time, ceilings, stopping -------------------------------------------------

  /** Advance the reading clock to now. */
  private tick(): void {
    const now = this.deps.now();
    this.active += Math.max(0, now - this.clock);
    this.clock = now;
  }

  private async pause(ms: number): Promise<void> {
    await this.deps.sleep(Math.round(ms));
    this.tick();
  }

  private async stay(ms: number, chars: number, why: "screen" | "long" | "between", line: string): Promise<void> {
    this.tick();
    await this.log({ kind: "stay", line, ms: Math.round(ms), chars, why });
    await this.pause(ms);
  }

  /** A sitting that ran its length: a break, or the end of the run after the last one. */
  private async sitting(line: string): Promise<void> {
    this.tick();
    if (this.active < this.sittingEnd) return;
    if (this.sittingsLeft <= 1) throw new Stop("limit", "sittings over");
    this.sittingsLeft--;
    const off = Math.round(draw(this.pace.segmentGapMs, this.deps.random));
    await this.log({ kind: "stay", line, ms: off, chars: 0, why: "sitting" });
    await this.deps.sleep(off);
    // The break is not reading time.
    this.clock = this.deps.now();
    this.sittingEnd = this.active + draw(this.pace.segmentMs, this.deps.random);
  }

  /** The run's ceilings; the page counts only before a new page is opened. */
  private checkCeilings(opening: boolean): void {
    this.tick();
    const limits = this.input.limits;
    if (this.past.posts.size >= limits.posts) throw new Stop("limit", "posts");
    if (this.active >= limits.activeMs) throw new Stop("limit", "reading time");
    if (!opening) return;
    if (this.past.pages.search >= limits.searchPages) throw new Stop("limit", "search pages");
    if (this.daily.search >= this.allowance.search) throw new Stop("quota", "search pages for today used up");
  }

  private async halt(halt: XHalt): Promise<never> {
    this.halted = halt;
    await this.log({ kind: "halt", halt });
    await this.deps.onHalt(halt);
    throw new Stop("halted", `${halt.kind}: ${halt.detail}`);
  }

  private async finish(status: XRunStatus, why: string | null): Promise<XReadResult> {
    this.tick();
    // An interrupted run has no end line, so calling again picks it up.
    if (status !== "interrupted" && status !== "unavailable") await this.log({ kind: "end", status, why });
    return this.result(status, why);
  }

  private async log(step: DistributiveOmit<XStep, "n" | "at" | "activeMs">): Promise<void> {
    this.n++;
    await this.deps.progress.append({ ...step, n: this.n, at: this.deps.now(), activeMs: Math.round(this.active) } as XStep);
  }

  private async saveMemory(): Promise<void> {
    this.memory.daily = this.daily;
    await this.deps.memory.save(this.memory);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function postText(p: XSearchPost): string {
  return `${p.text}\n${p.quoted?.text ?? ""}`;
}

/**
 * The relevance alarm: once enough posts are scored, nearly all of them at 0
 * means the floor is measuring against words the posts do not use (pitfall
 * 660), not that every post is off-topic. Null when it does not go off.
 */
export function relevanceCollapse(scores: readonly number[]): XRelevanceCollapse | null {
  if (scores.length < COLLAPSE_MIN_POSTS) return null;
  const zero = scores.filter((s) => s <= 0).length;
  return zero >= COLLAPSE_ZERO_SHARE * scores.length ? { posts: scores.length, zero } : null;
}

/**
 * The cut-short posts of one line whose permalink pages to open, in order:
 * those past the floor, best first. When the alarm went off and the floor
 * passes none, the first few in page order, less those of the line already
 * opened. `posts` is the line's kept posts in page order.
 */
export function permalinkPicks(
  posts: readonly XSearchPost[],
  query: PreparedQuery,
  opts: { floor: number; collapsed: boolean; permalinked: ReadonlySet<string> },
): XSearchPost[] {
  const owed = posts.filter((p) => p.truncated && !p.article && !opts.permalinked.has(p.id));
  const passed = owed
    .map((p) => ({ post: p, score: localRelevance(query, postText(p)) }))
    .filter((c) => c.score >= opts.floor)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.post);
  if (passed.length || !opts.collapsed) return passed;
  const opened = posts.filter((p) => opts.permalinked.has(p.id)).length;
  return owed.slice(0, Math.max(0, COLLAPSE_FALLBACK - opened));
}

/** Fisher-Yates with the caller's random source. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A cut-short post's whole text off its permalink page, or null when the page
 * did not give it: the post is not there, or what is there does not start the
 * way the search page showed it.
 */
export function wholeText(value: unknown, post: Pick<XSearchPost, "id" | "handle" | "text">): string | null {
  return permalinkRead(value, post)?.text ?? null;
}

/**
 * What a cut-short post's permalink page gave: its whole text (null as in
 * `wholeText`) and the links out its own text and card carry there (pitfall
 * 657), t.co ones not yet expanded; null when the post is not on the page.
 */
export function permalinkRead(value: unknown, post: Pick<XSearchPost, "id" | "handle" | "text">): { text: string | null; links: XLinkOut[] } | null {
  const read = parsePermalinkResult(value);
  if (!read) return null;
  const found = focalPost(read, post.id, post.handle);
  if (!found) return null;
  const links = outboundLinks(found.focal);
  const text = bodyText(postBodyLines(found.focal.text, { handle: post.handle }));
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const head = squash(post.text).slice(0, 40);
  if (!text || !squash(text).startsWith(head) || squash(text).length < squash(post.text).length) return { text: null, links };
  return { text, links };
}
