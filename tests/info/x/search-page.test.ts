// The search page script and its parsing, run against a real signed-in search
// page: fixtures/search-live-ai-for-science.html is x.com's primaryColumn for
// `"AI for science" -filter:retweets` (f=live) as the browse session rendered it
// on 2026-10-14, class and style attributes and svg paths stripped.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import {
  mayBeGenericError,
  countOf,
  noResults,
  pageHalt,
  parseSearchRead,
  SEARCH_PAGE_SCRIPT,
  xSearchUrl,
  type XSearchRead,
} from "../../../src/info/x/search-page";

const FIXTURE = readFileSync(join(import.meta.dir, "fixtures/search-live-ai-for-science.html"), "utf8");

/** Run the page script in a DOM holding `html`, as the browse session would. */
function runScript(html: string, path = "/search"): unknown {
  const win = new Window({ url: `https://x.com${path}?q=x` });
  win.document.body.innerHTML = html;
  const run = new Function("document", "location", "innerHeight", "scrollY", `return ${SEARCH_PAGE_SCRIPT}`);
  const value = run(win.document, win.location, 2420, 0);
  win.close();
  return JSON.parse(JSON.stringify(value));
}

function readFixture(html = FIXTURE): XSearchRead {
  const read = parseSearchRead(runScript(html));
  if (!read) throw new Error("no read");
  return read;
}

const byId = (read: XSearchRead, id: string) => read.posts.find((p) => p.post.id === id)?.post;

describe("search page script on a real page", () => {
  const read = readFixture();

  test("every post in the DOM, none dropped", () => {
    expect(read.posts.length).toBe(38);
    expect(read.dropped).toEqual([]);
    expect(read.path).toBe("/search");
  });

  test("a reply: id, handle, name, text, counts, both times", () => {
    const post = byId(read, "2110257670737584465")!;
    expect(post.handle).toBe("CrazyKyotic");
    expect(post.name).toBe("Dr. Willum E.B");
    expect(post.text).toBe("Fine, the AI for Science niche is growing on me");
    expect(post.counts).toEqual({ replies: 0, reposts: 0, likes: 1, bookmarks: 0, views: 3, quotes: null });
    // The id carries milliseconds; the page shows whole seconds.
    expect(post.postedAt - Date.parse("2026-10-14T06:33:30.000Z")).toBe(52);
    expect(post.shownAt).toBe(Date.parse("2026-10-14T06:33:30.000Z"));
    expect(post.permalink).toBe("https://x.com/CrazyKyotic/status/2110257670737584465");
    expect(post.truncated).toBe(false);
  });

  test("a long post behind Show more is cut", () => {
    const post = byId(read, "2110255507709850003")!;
    expect(post.truncated).toBe(true);
    expect(post.article).toBe(false);
    expect(post.text).toContain("炸裂！今日 AI 圈高能速递");
    expect(post.text).not.toContain("Show more");
  });

  test("a quoted post is read as part of its quoting one", () => {
    const post = byId(read, "2110248686924272083")!;
    expect(post.text).toBe("把 AI 用到极限的大学生。AI for science 做特色，让 AI 证定理、写代码、搭工具，我负责判断对不对。");
    expect(post.quoted?.handle).toBe("libukai");
    expect(post.quoted?.id).toBe("2110015630363820046");
    expect(post.quoted?.text.startsWith("反正 Pro 500 的 Token 烧不完")).toBe(true);
    expect(read.posts.some((p) => p.post.id === "2110015630363820046")).toBe(false);
  });

  test("a link in the text is spelled out by the page; a card's is left to t.co", () => {
    const github = byId(read, "2110030581794820402")!;
    expect(github.links).toEqual([
      { tco: "https://t.co/sSalrKrZZP", url: "https://github.com/yashgurbani/amino-arcade", card: false },
    ]);
    expect(github.text).toContain("https://github.com/yashgurbani/amino-arcade for visualising");
    const yale = byId(read, "2110024702655606992")!;
    expect(yale.links).toEqual([{ tco: "https://t.co/RVliAXtviX", url: null, card: true }]);
  });

  test("an X Article counts as cut", () => {
    const post = byId(read, "2110226743797915911")!;
    expect(post.article).toBe(true);
    expect(post.truncated).toBe(true);
  });

  test("a page time a day off the id's drops the post", () => {
    const html = FIXTURE.replace('datetime="2026-10-14T06:33:30.000Z"', 'datetime="2026-10-11T06:33:30.000Z"');
    const off = readFixture(html);
    expect(off.posts.length).toBe(37);
    expect(off.dropped).toEqual([{ id: "2110257670737584465", reason: "time-mismatch" }]);
  });

  test("nothing in the page chrome reads as a halt", () => {
    expect(pageHalt(read, "search")).toBeNull();
    expect(noResults(read)).toBe(false);
  });
});

describe("halts", () => {
  const ok = { path: "/search", loginWall: false, chrome: "Search\nTop\nLatest\nPeople" };

  test("signed out: a login page, a sign-in wall, a page that is not the search", () => {
    expect(pageHalt({ ...ok, path: "/i/flow/login" }, "search")?.kind).toBe("signed-out");
    expect(pageHalt({ ...ok, loginWall: true }, "search")?.kind).toBe("signed-out");
    expect(pageHalt({ ...ok, path: "/home" }, "search")?.kind).toBe("signed-out");
    expect(pageHalt({ ...ok, path: "/home" }, "status")?.kind).toBe("signed-out");
  });

  test("a challenge by where it lands or what it says", () => {
    expect(pageHalt({ ...ok, path: "/account/access" }, "search")?.kind).toBe("challenge");
    expect(pageHalt({ ...ok, chrome: "Verify you are human" }, "search")?.kind).toBe("challenge");
  });

  test("a limit message outside the posts", () => {
    const h = pageHalt({ ...ok, chrome: "Search\nSomething went wrong. Try reloading.\nRetry" }, "search");
    expect(h?.kind).toBe("rate-limited");
    expect(h?.detail).toContain("Something went wrong");
    // X's generic error is worth one reload; a page that names the limit is not.
    expect(mayBeGenericError(h!, { chrome: "Search\nSomething went wrong. Try reloading.\nRetry" })).toBe(true);
    const named = pageHalt({ ...ok, chrome: "Search\nRate limit exceeded. Something went wrong." }, "search")!;
    expect(mayBeGenericError(named, { chrome: "Search\nRate limit exceeded. Something went wrong." })).toBe(false);
  });

  test("a permalink page is fine where it should be", () => {
    expect(pageHalt({ ...ok, path: "/jure/status/2110008862939156594" }, "status")).toBeNull();
  });

  test("a post that says the words is not a halt: only text outside posts is looked at", () => {
    const html = FIXTURE.replace("Fine, the AI for Science niche is growing on me", "rate limit exceeded, try again later");
    expect(pageHalt(readFixture(html), "search")).toBeNull();
  });
});

test("search URLs: the order, the window, no retweets", () => {
  const live = new URL(xSearchUrl({ query: '"AI for science"', order: "live", since: "2026-10-11", until: "2026-10-12" }));
  expect(live.searchParams.get("q")).toBe('"AI for science" since:2026-10-11 until:2026-10-12 -filter:retweets');
  expect(live.searchParams.get("f")).toBe("live");
  expect(new URL(xSearchUrl({ query: "protein design", order: "top" })).searchParams.has("f")).toBe(false);
});

test("counts off aria-labels", () => {
  expect(countOf("1,234 Likes. Like")).toBe(1234);
  expect(countOf("Bookmark")).toBe(0);
  expect(countOf(null)).toBeNull();
});
