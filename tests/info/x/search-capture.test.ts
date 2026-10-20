// The capture script against a fake page (its own fetch and XMLHttpRequest),
// the drain, and putting a captured answer over a search card.

import { describe, expect, test } from "bun:test";
import { postsOfAnswer } from "../../../src/info/x/graphql-post";
import {
  captureMismatch,
  parseCaptureDrain,
  withCaptured,
  X_CAPTURE_CHANNEL,
  X_CAPTURE_DRAIN,
  X_CAPTURE_SCRIPT,
  xCaptureScript,
} from "../../../src/info/x/search-capture";
import type { XSearchPost } from "../../../src/info/x/search-page";
import { entry, searchTimeline, tweet } from "./graphql-fixtures";

const SEARCH = "https://x.com/i/api/graphql/Q1/SearchTimeline?variables=%7B%7D";

/** A page's XMLHttpRequest that answers every request with `body` after send. */
function fakeXhr(body: string, status = 200) {
  class FakeXHR {
    status = 0;
    responseType = "";
    responseText = "";
    response: unknown = null;
    private listeners: (() => void)[] = [];
    onload: (() => void) | null = null;
    url = "";
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      queueMicrotask(() => {
        this.status = status;
        if (this.responseType === "json") this.response = JSON.parse(body);
        else this.responseText = this.response = body as unknown as string;
        this.onload?.();
        for (const l of this.listeners) l();
      });
    }
    addEventListener(type: string, fn: () => void) {
      if (type === "load") this.listeners.push(fn);
    }
  }
  return FakeXHR;
}

/** A page at `href` with its own fetch answering `bodies` by URL; the script run in it at document start. */
function page(href: string, bodies: Record<string, { body: string; status?: number }>, script = X_CAPTURE_SCRIPT) {
  const fetched: string[] = [];
  const win: Record<string, unknown> = {
    fetch: async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      fetched.push(url);
      const b = bodies[url] ?? { body: "{}", status: 404 };
      return new Response(b.body, { status: b.status ?? 200 });
    },
    XMLHttpRequest: fakeXhr(Object.values(bodies)[0]?.body ?? "{}"),
  };
  const location = new URL(href);
  new Function("window", "location", script)(win, location);
  const drain = () => new Function("window", `return ${X_CAPTURE_DRAIN}`)(win) as unknown;
  return { win, fetched, drain };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

const ANSWER = JSON.stringify(
  searchTimeline([
    entry(
      tweet({
        id: "1900000000000000001",
        handle: "lab",
        note: `Whole long text about protein design. ${"word ".repeat(80)}see https://t.co/p1`,
        urls: [{ tco: "https://t.co/p1", url: "https://arxiv.org/abs/2605.24043", inNote: true }],
        counts: { likes: 1234 },
      }),
    ),
  ]),
);

describe("the capture script", () => {
  test("keeps a copy of a search answer the page fetched; the page reads its own whole", async () => {
    const p = page("https://x.com/search?q=x", { [SEARCH]: { body: ANSWER } });
    const res = await (p.win.fetch as typeof fetch)(SEARCH);
    expect(await res.text()).toBe(ANSWER);
    await settle();
    const drained = p.drain() as { bodies: { op: string; text: string }[]; seen: number };
    expect(drained.bodies).toEqual([{ op: "SearchTimeline", text: ANSWER }]);
    expect(p.fetched).toEqual([SEARCH]);
    // Drained means forgotten.
    expect((p.drain() as { bodies: unknown[] }).bodies).toEqual([]);
  });

  test("other calls, failed answers and Request objects", async () => {
    const other = "https://x.com/i/api/graphql/Q2/UserByScreenName?v=1";
    const failed = "https://x.com/i/api/graphql/Q3/TweetDetail?v=1";
    const p = page("https://x.com/home", { [other]: { body: "{}" }, [failed]: { body: "{}", status: 429 }, [SEARCH]: { body: ANSWER } });
    const f = p.win.fetch as typeof fetch;
    await f(other);
    await f(failed);
    await f(new Request(SEARCH));
    await settle();
    const drained = p.drain() as { bodies: { op: string }[] };
    expect(drained.bodies.map((b) => b.op)).toEqual(["SearchTimeline"]);
  });

  test("an XMLHttpRequest answer, as text and as JSON", async () => {
    const p = page("https://x.com/search?q=x", { [SEARCH]: { body: ANSWER } });
    const XHR = p.win.XMLHttpRequest as new () => { open(m: string, u: string): void; send(): void; responseType: string; onload: (() => void) | null };
    let pageSaw = 0;
    for (const type of ["", "json"]) {
      const x = new XHR();
      x.responseType = type;
      x.onload = () => void pageSaw++;
      x.open("GET", SEARCH);
      x.send();
    }
    const unrelated = new XHR();
    unrelated.open("GET", "https://x.com/i/api/2/badge_count/badge_count.json");
    unrelated.send();
    await settle();
    expect(pageSaw).toBe(2);
    const drained = parseCaptureDrain(p.drain());
    expect(drained).toMatchObject({ hooked: true, bodies: 2, parsed: 2, seen: 2 });
    expect(drained.posts.get("1900000000000000001")?.counts.likes).toBe(1234);
  });

  test("does nothing on another site, and is a plain named global on X", () => {
    const elsewhere = page("https://www.bloomberg.com/news", {});
    expect(elsewhere.win[X_CAPTURE_CHANNEL]).toBeUndefined();
    expect(parseCaptureDrain(elsewhere.drain()).hooked).toBe(false);
    const local = page("http://127.0.0.1:8080/search", {}, xCaptureScript(["127.0.0.1"]));
    expect(Object.keys(local.win)).toContain(X_CAPTURE_CHANNEL);
    const sub = page("https://mobile.x.com/search", {});
    expect(sub.win[X_CAPTURE_CHANNEL]).toBeDefined();
  });

  test("an unparsable body is counted and skipped", () => {
    const d = parseCaptureDrain({ bodies: [{ op: "SearchTimeline", text: "<html>" }, { op: "SearchTimeline", text: ANSWER }], seen: 2, dropped: 0 });
    expect(d).toMatchObject({ hooked: true, bodies: 2, parsed: 1 });
    expect(d.posts.size).toBe(1);
    expect(parseCaptureDrain(null).hooked).toBe(false);
    expect(parseCaptureDrain({ availWidth: 1 }).hooked).toBe(false);
  });
});

function card(over: Partial<XSearchPost> = {}): XSearchPost {
  return {
    id: "1900000000000000001",
    handle: "lab",
    name: "The Lab",
    text: "Whole long text about protein design. word word",
    postedAt: 0,
    shownAt: null,
    counts: { replies: 1, reposts: 2, likes: 1200, bookmarks: null, views: 9000, quotes: null },
    links: [],
    truncated: true,
    article: false,
    quoted: null,
    permalink: "https://x.com/lab/status/1900000000000000001",
    ...over,
  };
}

describe("a card with its answer", () => {
  const cap = postsOfAnswer(JSON.parse(ANSWER)).get("1900000000000000001")!;

  test("whole text, links, exact counts; no longer cut short", () => {
    const post = withCaptured(card(), cap);
    expect(post.truncated).toBe(false);
    expect(post.text).toBe(cap.text);
    expect(post.links).toEqual([{ tco: "https://t.co/p1", url: "https://arxiv.org/abs/2605.24043", card: false }]);
    expect(post.counts.likes).toBe(1234);
    expect(post.counts.quotes).toBe(0);
    expect(captureMismatch(card(), cap)).toBeNull();
  });

  test("a link the card already had is not added twice", () => {
    const post = withCaptured(card({ links: [{ tco: "https://t.co/p1", url: null, card: false }] }), cap);
    expect(post.links).toEqual([{ tco: "https://t.co/p1", url: "https://arxiv.org/abs/2605.24043", card: false }]);
  });

  test("an Article stays cut short: its body is not in the answer", () => {
    const art = postsOfAnswer(searchTimeline([entry(tweet({ id: "1900000000000000002", text: "", article: { id: "9", title: "T" } }))])).get("1900000000000000002")!;
    const post = withCaptured(card({ id: "1900000000000000002", text: "T\nA preview", article: true }), art);
    expect(post.truncated).toBe(true);
    expect(post.text).toBe("T\nA preview");
  });

  test("the quoted post takes its whole text and keeps its links apart", () => {
    const quoted = tweet({ id: "1800000000000000010", handle: "author", text: "the paper https://t.co/q1", urls: [{ tco: "https://t.co/q1", url: "https://arxiv.org/abs/2605.11111" }] });
    const q = postsOfAnswer(searchTimeline([entry(tweet({ id: "1900000000000000003", text: "look", quoted }))])).get("1900000000000000003")!;
    const post = withCaptured(card({ id: "1900000000000000003", text: "look", truncated: false, quoted: { id: null, handle: "author", name: "Au Thor", text: "the paper https://arxiv.org/abs/26…", postedAt: null, truncated: true } }), q);
    expect(post.links).toEqual([]);
    expect(post.quoted).toMatchObject({ id: "1800000000000000010", name: "Au Thor", text: "the paper https://arxiv.org/abs/2605.11111", truncated: false, links: ["https://arxiv.org/abs/2605.11111"] });
  });

  test("mismatches are named, links and case aside", () => {
    expect(captureMismatch(card({ handle: "other" }), cap)).toContain("handle");
    expect(captureMismatch(card({ text: "Something else entirely here" }), cap)).toContain("text starts");
    expect(captureMismatch(card({ text: "WHOLE long text about protein https://t.co/x design" }), cap)).toBeNull();
    expect(captureMismatch(card({ text: "Whole   long text about protein design." }), cap)).toBeNull();
  });
});
