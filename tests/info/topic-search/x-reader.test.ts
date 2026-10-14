// The topic-search X reader against a fake browse session and a fake clock:
// where a line stops, the ceilings, stopping on X's say-so, and picking a run
// back up from its progress file.

import { describe, expect, test } from "bun:test";
import type { BrowseEval, BrowseLoad, BrowseOpen, BrowseScroll, BrowseSession } from "../../../src/workshop/extract/webview-browse";
import { PERMALINK_SCRIPT } from "../../../src/info/x/permalink";
import { PAGE_CHROME_SCRIPT, SEARCH_PAGE_SCRIPT, type XHalt } from "../../../src/info/x/search-page";
import { readXSearch, type XReadDeps, type XReadInput, type XReadLine } from "../../../src/info/topic-search/x-reader";
import { fitViewport, PROBE_PACE, screenStayMs, scrollSteps, X_PACE } from "../../../src/info/topic-search/x-pace";
import { markAfter, type XReaderMemory, type XStep } from "../../../src/info/topic-search/x-progress";

// Snowflake ids: (ms since X's epoch) << 22, so a bigger number is a later post.
const EPOCH = 1288834974657n;
const NOW = Date.parse("2026-10-14T02:00:00Z");
function idAt(ms: number, seq = 0): string {
  return String(((BigInt(ms) - EPOCH) << 22n) + BigInt(seq));
}
/** Post `i` of a newest-first line: one minute older per step. */
const pid = (i: number) => idAt(NOW - 3_600_000 - i * 60_000);

function raw(id: string, opts: { onScreen?: boolean; text?: string; showMore?: boolean; handle?: string } = {}) {
  const ms = Number((BigInt(id) >> 22n) + EPOCH);
  return {
    path: `/${opts.handle ?? "someone"}/status/${id}`,
    datetime: new Date(Math.floor(ms / 1000) * 1000).toISOString(),
    userName: `Some One@${opts.handle ?? "someone"}·1h`,
    text: opts.text ?? `post ${id} about protein design`,
    showMore: opts.showMore ?? false,
    article: false,
    counts: { reply: "0 Replies. Reply", retweet: "2 reposts. Repost", like: "5 Likes. Like", bookmark: "Bookmark", views: "90 views. View post analytics" },
    links: [] as { href: string; text: string; label: string; card: boolean }[],
    quote: null,
    top: opts.onScreen === false ? 3000 : 100,
    bottom: opts.onScreen === false ? 3300 : 400,
    chars: 120,
  };
}

function screen(posts: ReturnType<typeof raw>[], extra: Record<string, unknown> = {}) {
  return { path: "/search", href: "https://x.com/search", textChars: 5000, viewport: 2000, scrollY: 0, height: 9000, loginWall: false, chrome: "Search\nTop\nLatest", posts, ...extra };
}

type Screen = ReturnType<typeof screen>;

/** A browse session that answers each search page with its list of screens, one per read. */
class FakeSite {
  pages: Map<string, Screen[]> = new Map();
  permalink: unknown = null;
  navigations: string[] = [];
  opens = 0;
  closeAfterReads = Infinity;
  private reads = 0;
  private current: Screen[] = [];
  private at = 0;
  private scrolled = false;

  session(): BrowseSession {
    const load = (url: string): BrowseLoad => ({ status: "ok", url, title: null, loaded: true, value: true, error: null, elapsedMs: 900, detail: null });
    const ev = (value: unknown, status: BrowseEval["status"] = "ok"): BrowseEval => ({ status, url: null, title: null, value, error: null, elapsedMs: 5, detail: null });
    return {
      id: 1,
      navigate: async (url) => {
        this.navigations.push(url);
        const key = [...this.pages.keys()].find((k) => url.includes(encodeURIComponent(k).replace(/%20/g, "+")));
        this.current = key ? this.pages.get(key)! : [];
        this.at = 0;
        return load(url);
      },
      back: async () => load(""),
      evaluate: async (script) => {
        if (script === SEARCH_PAGE_SCRIPT) {
          if (++this.reads > this.closeAfterReads) return ev(null, "closed");
          this.scrolled = false;
          const s = this.current[Math.min(this.at, this.current.length - 1)] ?? screen([]);
          return ev(s);
        }
        if (script === PAGE_CHROME_SCRIPT) return ev({ path: "/someone/status/1", chrome: "Post", loginWall: false });
        if (script === PERMALINK_SCRIPT) return ev(this.permalink);
        return ev({ availWidth: 2560, availHeight: 2560 });
      },
      scrollBy: async (dy): Promise<BrowseScroll> => {
        // One scroll (its small steps together) moves to the next screen.
        if (!this.scrolled) this.at++;
        this.scrolled = true;
        return { status: "ok", before: 0, after: this.at < this.current.length ? dy : 0, height: 9000, viewport: 2000, detail: null };
      },
      close: async () => true,
    };
  }
}

function harness(site: FakeSite, memory: XReaderMemory = { marks: {}, daily: null }, steps: XStep[] = []) {
  let now = NOW;
  const halts: XHalt[] = [];
  const saved = { memory };
  const deps: XReadDeps = {
    open: async (): Promise<BrowseOpen> => {
      site.opens++;
      return { status: "ok", session: site.session() };
    },
    progress: { load: async () => [...steps], append: async (s) => void steps.push(s) },
    memory: { load: async () => structuredClone(saved.memory), save: async (m) => void (saved.memory = structuredClone(m)) },
    expandLink: async (tco) => `https://example.org/${tco.slice(-4)}`,
    onHalt: async (h) => void halts.push(h),
    sleep: async (ms) => void (now += ms),
    now: () => now,
    random: () => 0.5,
  };
  return { deps, steps, halts, saved };
}

const line = (key: string, query: string, order: "live" | "top" = "live"): XReadLine => ({ key, query, order, relevance: query });
const input = (lines: XReadLine[], extra: Partial<XReadInput> = {}): XReadInput => ({
  lines,
  limits: { posts: 400, searchPages: 30, permalinkPages: 40, activeMs: 150 * 60_000 },
  pace: { ...X_PACE, segments: [1, 1], segmentMs: [600 * 60_000, 600 * 60_000] },
  ...extra,
});

describe("reading a line", () => {
  test("stops at 8 posts in a row read last time, and moves the line's mark", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [
      screen([0, 1, 2, 3].map((i) => raw(pid(i)))),
      screen([2, 3, 4, 5, 6, 7].map((i) => raw(pid(i)))),
      screen([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => raw(pid(i)))),
    ]);
    // Last time the line read down from post 5.
    const mark = markAfter(undefined, [5, 6, 7, 8, 9, 10, 11, 12, 13].map(pid), NOW - 86_400_000);
    const h = harness(site, { marks: { "t:q1": mark }, daily: null });
    const result = await readXSearch(input([line("t:q1", "protein")]), h.deps);

    expect(result.status).toBe("done");
    expect(result.posts.map((p) => p.post.id)).toEqual([0, 1, 2, 3, 4].map(pid));
    expect(result.lines).toEqual([{ key: "t:q1", why: "caught-up", screens: 2, kept: 5 }]);
    expect(h.saved.memory.marks["t:q1"].topId).toBe(pid(0));
    expect(h.saved.memory.daily?.search).toBe(1);
    expect(h.steps.map((s) => s.kind).filter((k) => k !== "stay" && k !== "scroll")).toEqual([
      "start", "open", "read", "read", "read", "line-end", "end",
    ]);
  });

  test("newest first, a post older than the last top counts as read", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [screen([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => raw(pid(i))))]);
    const h = harness(site, { marks: { "t:q1": { topId: pid(2), seen: {} } }, daily: null });
    const result = await readXSearch(input([line("t:q1", "protein")]), h.deps);
    expect(result.posts.map((p) => p.post.id)).toEqual([pid(0), pid(1)]);
    expect(result.lines[0].why).toBe("caught-up");
  });

  test("the stay on a screen is the new text on screen, read once", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [
      screen([raw(pid(0), { text: "x".repeat(320) }), raw(pid(1), { onScreen: false, text: "y".repeat(800) })]),
      screen([raw(pid(0), { text: "x".repeat(320) }), raw(pid(1), { text: "y".repeat(800) })]),
    ]);
    const h = harness(site);
    await readXSearch(input([line("t:q1", "protein")]), h.deps);
    const stays = h.steps.filter((s): s is Extract<XStep, { kind: "stay" }> => s.kind === "stay" && s.why === "screen");
    expect(stays.slice(0, 2).map((s) => s.chars)).toEqual([320, 800]);
  });
});

describe("stopping", () => {
  test("a sign-in page halts the run once, and calling again touches nothing", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [screen([], { path: "/i/flow/login" })]);
    const h = harness(site);
    const first = await readXSearch(input([line("t:q1", "protein"), line("t:q2", "protein folding")]), h.deps);
    expect(first.status).toBe("halted");
    expect(first.halt?.kind).toBe("signed-out");
    expect(h.halts.length).toBe(1);
    expect(site.navigations.length).toBe(1);
    expect(h.steps[h.steps.length - 1]).toMatchObject({ kind: "end", status: "halted" });

    const again = await readXSearch(input([line("t:q1", "protein")]), h.deps);
    expect(again.status).toBe("halted");
    expect(site.opens).toBe(1);
  });

  test("three screens of page text and no posts: the page changed", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [screen([]), screen([]), screen([]), screen([])]);
    const h = harness(site);
    const result = await readXSearch(input([line("t:q1", "protein")]), h.deps);
    expect(result.status).toBe("halted");
    expect(result.halt?.kind).toBe("structure");
  });

  test("the day's search pages used up: nothing opened", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [screen([raw(pid(0))])]);
    const day = new Date(NOW);
    const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const h = harness(site, { marks: {}, daily: { day: today, search: 60, permalink: 0 } });
    const result = await readXSearch(input([line("t:q1", "protein")]), h.deps);
    expect(result.status).toBe("quota");
    expect(site.navigations).toEqual([]);
  });

  test("the run's post ceiling ends it and still moves the mark", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [screen([0, 1, 2, 3, 4, 5].map((i) => raw(pid(i)))), screen([6, 7].map((i) => raw(pid(i))))]);
    const h = harness(site);
    const result = await readXSearch(input([line("t:q1", "protein")], { limits: { posts: 6, searchPages: 30, permalinkPages: 0, activeMs: 9e9 } }), h.deps);
    expect(result.status).toBe("limit");
    expect(result.why).toBe("posts");
    expect(result.posts.length).toBe(6);
    expect(h.saved.memory.marks["t:q1"].topId).toBe(pid(0));
  });
});

describe("resuming", () => {
  test("a run cut off mid-line keeps its posts, skips finished lines, and reads the rest", async () => {
    const site = new FakeSite();
    site.pages.set("protein", [screen([0, 1].map((i) => raw(pid(i))))]);
    site.pages.set("enzyme", [screen([10, 11].map((i) => raw(pid(i)))), screen([12, 13].map((i) => raw(pid(i))))]);
    const lines = [line("t:a", "protein"), line("t:b", "enzyme")];
    // random 0.5 puts t:b before t:a; the session dies on t:a's second read... so cut it on the third read overall.
    site.closeAfterReads = 3;
    const h = harness(site);
    const first = await readXSearch(input(lines), h.deps);
    expect(first.status).toBe("interrupted");
    expect(h.steps.some((s) => s.kind === "end")).toBe(false);
    const keptBefore = first.posts.map((p) => p.post.id);

    site.closeAfterReads = Infinity;
    const second = await readXSearch(input(lines), h.deps);
    expect(second.status).toBe("done");
    expect(h.steps.filter((s) => s.kind === "resume").length).toBe(1);
    const ids = second.posts.map((p) => p.post.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of keptBefore) expect(ids).toContain(id);
    expect(ids.sort()).toEqual([0, 1, 10, 11, 12, 13].map(pid).sort());
    // Each line was read to its end exactly once.
    expect(h.steps.filter((s) => s.kind === "line-end").map((s) => (s as { line: string }).line).sort()).toEqual(["t:a", "t:b"]);
  });
});

describe("following up a line", () => {
  test("a cut-short post on topic gets its permalink page; a card link gets t.co's target", async () => {
    const site = new FakeSite();
    const long = pid(0);
    const shown = raw(long, { text: "Protein design with diffusion models is moving fast", showMore: true, handle: "lab" });
    const card = { ...raw(pid(1)), links: [{ href: "https://t.co/abcd1234", text: "", label: "example.org Title", card: true }] };
    site.pages.set("protein", [screen([shown, card])]);
    site.permalink = {
      url: `https://x.com/lab/status/${long}`,
      title: "",
      posts: [{
        anchors: [{ href: "https://x.com/lab", path: "/lab", text: "" }, { href: `https://x.com/lab/status/${long}`, path: `/lab/status/${long}`, text: "" }],
        images: [],
        videos: 0,
        text: "Lab\n@lab\nProtein design with diffusion models is moving fast, and here is the rest of the thread.\n2:03 AM · Oct 14, 2026\n12\nViews",
      }],
    };
    const h = harness(site);
    const result = await readXSearch(input([line("t:q1", "protein design")]), h.deps);
    const post = result.posts.find((p) => p.post.id === long)!.post;
    expect(post.truncated).toBe(false);
    expect(post.text).toBe("Protein design with diffusion models is moving fast, and here is the rest of the thread.");
    expect(result.pages).toEqual({ search: 1, permalink: 1 });
    expect(result.posts.find((p) => p.post.id === pid(1))!.post.links[0].url).toBe("https://example.org/1234");
    expect(site.navigations[1]).toBe(`https://x.com/lab/status/${long}`);
  });
});

describe("pace", () => {
  test("a screen's stay: the new text at 12-20 characters a second plus 2-6 s", () => {
    expect(screenStayMs(320, PROBE_PACE, () => 0)).toBe(Math.round((320 / 12) * 1000 + 2000));
    expect(screenStayMs(320, PROBE_PACE, () => 1)).toBe(Math.round((320 / 20) * 1000 + 6000));
    expect(screenStayMs(1e6, PROBE_PACE, () => 0.5)).toBe(PROBE_PACE.maxScreenMs);
  });

  test("a scroll is 0.6-0.9 of a screen in 3-4 steps", () => {
    for (const r of [0, 0.3, 0.99]) {
      const steps = scrollSteps(2000, X_PACE, () => r);
      const sum = steps.reduce((a, b) => a + b, 0);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(steps.length).toBeLessThanOrEqual(4);
      expect(sum).toBeGreaterThanOrEqual(1199);
      expect(sum).toBeLessThanOrEqual(1801);
    }
  });

  test("the viewport is never taller than its screen could show", () => {
    expect(fitViewport({ width: 1440, height: 2420 }, { availWidth: 1440, availHeight: 2560 })).toEqual({ width: 1440, height: 2420 });
    expect(fitViewport({ width: 1440, height: 2420 }, { availWidth: 2560, availHeight: 1400 })).toEqual({ width: 1440, height: 1260 });
    expect(fitViewport({ width: 1440, height: 2420 }, null)).toEqual({ width: 1440, height: 2420 });
  });
});
