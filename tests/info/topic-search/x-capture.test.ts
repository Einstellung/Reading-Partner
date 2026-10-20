// The X reader with the page's own answers captured (info/x/search-capture.ts):
// present, partial, absent, disagreeing, on a post's page, and turned off.

import { describe, expect, test } from "bun:test";
import type { BrowseEval, BrowseLoad, BrowseOpen, BrowseScroll, BrowseSession } from "../../../src/workshop/extract/webview-browse";
import { PERMALINK_SCRIPT } from "../../../src/info/x/permalink";
import { PAGE_CHROME_SCRIPT, SEARCH_PAGE_SCRIPT } from "../../../src/info/x/search-page";
import { X_CAPTURE_DRAIN, X_CAPTURE_SCRIPT } from "../../../src/info/x/search-capture";
import { CAPTURE_MIN_POSTS, readXSearch, type XReadDeps, type XReadInput } from "../../../src/info/topic-search/x-reader";
import { replay, tallySteps, xReadNote, type XStep } from "../../../src/info/topic-search/x-progress";
import { X_PACE } from "../../../src/info/topic-search/x-pace";
import { entry, searchTimeline, tweet, tweetDetail } from "../x/graphql-fixtures";

const EPOCH = 1288834974657n;
const NOW = Date.parse("2026-10-14T02:00:00Z");
const pid = (i: number) => String(((BigInt(NOW - 3_600_000 - i * 60_000) - EPOCH) << 22n) + 0n);

const paper = (i: number) => `https://arxiv.org/abs/2605.2404${i % 10}`;
const LONG = (i: number) => `post ${i} about protein design, the long version. ${"More on the method and the data. ".repeat(12)}Paper https://t.co/p${i}`;

function card(i: number, opts: { showMore?: boolean; text?: string } = {}) {
  const id = pid(i);
  const ms = Number((BigInt(id) >> 22n) + EPOCH);
  return {
    path: `/lab/status/${id}`,
    datetime: new Date(Math.floor(ms / 1000) * 1000).toISOString(),
    userName: "The Lab@lab·1h",
    text: opts.text ?? `post ${i} about protein design, the long version.`,
    showMore: opts.showMore ?? true,
    article: false,
    counts: { reply: "1 Reply", retweet: "2 reposts", like: "1.2K Likes", bookmark: "Bookmark", views: "9K views" },
    links: [],
    quote: null,
    top: 100,
    bottom: 400,
    chars: 120,
  };
}

function capturedPost(i: number) {
  return tweet({
    id: pid(i),
    handle: "lab",
    note: LONG(i),
    urls: [{ tco: `https://t.co/p${i}`, url: paper(i), inNote: true }],
    counts: { likes: 1234 },
  });
}

const screen = (posts: ReturnType<typeof card>[]) => ({
  path: "/search",
  href: "https://x.com/search",
  textChars: 5000,
  viewport: 2000,
  scrollY: 0,
  height: 9000,
  loginWall: false,
  chrome: "Search",
  posts,
});

const drained = (...answers: unknown[]) => ({ bodies: answers.map((a) => ({ op: "SearchTimeline", text: JSON.stringify(a) })), seen: answers.length, dropped: 0 });

/** One search page of screens; each search read is followed by the drain the reader asks for. */
class Site {
  screens: ReturnType<typeof screen>[] = [];
  /** What each drain answers, in turn; past the end, an empty drain. Null: no capture on the page. */
  drains: (unknown | null)[] = [];
  permalinkDrain: unknown = null;
  permalink: unknown = null;
  navigations: string[] = [];
  opened: { initScript?: string }[] = [];
  evaluated: string[] = [];
  hooked = true;
  private at = 0;
  private scrolled = false;
  private onPermalink = false;

  session(): BrowseSession {
    const load = (url: string): BrowseLoad => ({ status: "ok", url, title: null, loaded: true, value: true, error: null, elapsedMs: 900, detail: null });
    const ev = (value: unknown): BrowseEval => ({ status: "ok", url: null, title: null, value, error: null, elapsedMs: 5, detail: null });
    return {
      id: 1,
      navigate: async (url) => {
        this.navigations.push(url);
        this.onPermalink = url.includes("/status/");
        if (!this.onPermalink) this.at = 0;
        return load(url);
      },
      back: async () => load(""),
      evaluate: async (script) => {
        this.evaluated.push(script);
        if (script === SEARCH_PAGE_SCRIPT) {
          this.scrolled = false;
          return ev(this.screens[Math.min(this.at, this.screens.length - 1)]);
        }
        if (script === X_CAPTURE_DRAIN) {
          if (!this.hooked) return ev(null);
          if (this.onPermalink) return ev(this.permalinkDrain ?? drained());
          return ev(this.drains.shift() ?? drained());
        }
        if (script === PAGE_CHROME_SCRIPT) return ev({ path: "/lab/status/1", chrome: "Post", loginWall: false });
        if (script === PERMALINK_SCRIPT) return ev(this.permalink);
        return ev({ availWidth: 2560, availHeight: 2560 });
      },
      scrollBy: async (dy): Promise<BrowseScroll> => {
        if (!this.scrolled) this.at++;
        this.scrolled = true;
        return { status: "ok", before: 0, after: this.at < this.screens.length ? dy : 0, height: 9000, viewport: 2000, detail: null };
      },
      close: async () => true,
    };
  }
}

function run(site: Site, extra: Partial<XReadInput> = {}, steps: XStep[] = []) {
  let now = NOW;
  const deps: XReadDeps = {
    open: async (_v, opts): Promise<BrowseOpen> => {
      site.opened.push(opts ?? {});
      return { status: "ok", session: site.session() };
    },
    progress: { load: async () => [...steps], append: async (s) => void steps.push(s) },
    memory: { load: async () => ({ marks: {}, daily: null }), save: async () => {} },
    expandLink: async () => null,
    onHalt: async () => {},
    sleep: async (ms) => void (now += ms),
    now: () => now,
    random: () => 0.5,
  };
  const input: XReadInput = {
    lines: [{ key: "t:q1", query: "protein", order: "live", relevance: "protein design" }],
    limits: { posts: 400, searchPages: 30, permalinkPages: 40, activeMs: 150 * 60_000 },
    pace: { ...X_PACE, segments: [1, 1], segmentMs: [600 * 60_000, 600 * 60_000] },
    ...extra,
  };
  return { result: readXSearch(input, deps), steps };
}

const kinds = (steps: XStep[]) => steps.map((s) => s.kind);

describe("captured answers", () => {
  test("present: whole text and links from the answer, no post page opened", async () => {
    const site = new Site();
    site.screens = [screen([card(0), card(1)])];
    site.drains = [drained(searchTimeline([entry(capturedPost(0)), entry(capturedPost(1))]))];
    const { result, steps } = run(site);
    const r = await result;

    expect(site.opened).toEqual([{ initScript: X_CAPTURE_SCRIPT }]);
    expect(site.navigations.filter((u) => u.includes("/status/"))).toEqual([]);
    const post = r.posts[0].post;
    expect(post.truncated).toBe(false);
    expect(post.text).toBe(LONG(0).replace("https://t.co/p0", paper(0)));
    expect(post.links.map((l) => l.url)).toEqual([paper(0)]);
    expect(post.counts.likes).toBe(1234);
    const read = steps.find((s): s is Extract<XStep, { kind: "read" }> => s.kind === "read")!;
    expect(read.captured).toEqual([pid(0), pid(1)]);
    expect(tallySteps(steps).line()).toContain("2 distinct posts found (2 filled from X's own answers, 0 from the page)");
    // Read back from the file, the posts are the filled ones.
    const back = replay(steps);
    expect(back.posts.get(pid(1))?.post.truncated).toBe(false);
    expect([...back.captured]).toEqual([pid(0), pid(1)]);
  });

  test("partial: the post the answer covers is filled, the other opens its page as before", async () => {
    const site = new Site();
    site.screens = [screen([card(0), card(1)])];
    site.drains = [drained(searchTimeline([entry(capturedPost(0))]))];
    site.permalink = null;
    const { result, steps } = run(site);
    const r = await result;
    expect(r.posts.find((p) => p.post.id === pid(0))?.post.truncated).toBe(false);
    expect(site.navigations.filter((u) => u.includes("/status/"))).toEqual([`https://x.com/lab/status/${pid(1)}`]);
    expect(kinds(steps)).toContain("permalink");
    expect(r.captureSilent).toBeNull();
  });

  test("a post page's own answer gives the whole text when the search answer did not", async () => {
    const site = new Site();
    site.screens = [screen([card(1)])];
    site.permalinkDrain = { bodies: [{ op: "TweetDetail", text: JSON.stringify(tweetDetail(capturedPost(1))) }], seen: 1, dropped: 0 };
    const { result, steps } = run(site);
    const r = await result;
    const step = steps.find((s): s is Extract<XStep, { kind: "permalink" }> => s.kind === "permalink")!;
    expect(step.source).toBe("captured");
    expect(step.text).toContain("More on the method");
    expect(step.links?.map((l) => l.url)).toEqual([paper(1)]);
    expect(r.posts[0].post.truncated).toBe(false);
    expect(replay(steps).captured.has(pid(1))).toBe(true);
  });

  test("a card and its answer that disagree: logged, the read goes on", async () => {
    const site = new Site();
    site.screens = [screen([card(0, { text: "Something unrelated to the answer" })])];
    site.drains = [drained(searchTimeline([entry(capturedPost(0))]))];
    const { result, steps } = run(site);
    const r = await result;
    const m = steps.find((s): s is Extract<XStep, { kind: "capture-mismatch" }> => s.kind === "capture-mismatch")!;
    expect(m).toMatchObject({ line: "t:q1", id: pid(0) });
    expect(m.why).toContain("text starts");
    expect(r.status).toBe("done");
  });

  test("an answer by another author is not this post: logged, the card stands alone", async () => {
    const site = new Site();
    site.screens = [screen([card(0, { showMore: false })])];
    site.drains = [drained(searchTimeline([entry(tweet({ id: pid(0), handle: "someone_else", text: "post 0 about protein design" }))]))];
    const { result, steps } = run(site);
    const r = await result;
    expect(r.posts[0].post.text).toBe("post 0 about protein design, the long version.");
    expect(replay(steps).captured.size).toBe(0);
    expect(steps.find((s) => s.kind === "capture-mismatch")).toMatchObject({ why: expect.stringContaining("handle") });
  });

  test("absent: read as before, and once enough posts are read, one warning", async () => {
    const site = new Site();
    site.hooked = false;
    const many = Array.from({ length: CAPTURE_MIN_POSTS + 2 }, (_, i) => card(i, { showMore: false }));
    site.screens = [screen(many.slice(0, 12)), screen(many.slice(12))];
    const { result, steps } = run(site);
    const r = await result;
    expect(r.posts.length).toBe(CAPTURE_MIN_POSTS + 2);
    expect(r.captureSilent).toEqual({ posts: CAPTURE_MIN_POSTS + 2, bodies: 0 });
    expect(kinds(steps).filter((k) => k === "capture-silent").length).toBe(1);
    expect(tallySteps(steps).line()).toContain("warning: no post was covered by X's own search answers");
    expect(xReadNote(r)).toContain("no post was covered");
    expect(replay(steps).captureSilent).toEqual(r.captureSilent!);
  });

  test("turned off: no script on the session, no drain, no warning", async () => {
    const site = new Site();
    site.screens = [screen(Array.from({ length: CAPTURE_MIN_POSTS + 1 }, (_, i) => card(i, { showMore: false })))];
    const { result, steps } = run(site, { capture: false });
    const r = await result;
    expect(site.opened).toEqual([{}]);
    expect(site.evaluated).not.toContain(X_CAPTURE_DRAIN);
    expect(r.captureSilent).toBeNull();
    expect(kinds(steps)).not.toContain("capture-silent");
  });
});
