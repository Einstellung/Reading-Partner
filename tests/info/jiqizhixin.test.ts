// jiqizhixin adapter (src/info/jiqizhixin.ts): list/article parsing and the
// fetch orchestration with an injected FetchFn. Run: bun test.

import { expect, test } from "bun:test";
import {
  collectJiqizhixin,
  parseJqxArticle,
  parseJqxList,
} from "../../src/info/jiqizhixin";

const LIST = JSON.stringify({
  articles: [
    {
      id: 1,
      title: "A new world model result",
      slug: "2026-07-20-23",
      publishedAt: "2026-07-20T08:00:00Z",
      tagList: ["world models"],
      content: "<p>Short <b>summary</b> text.</p>",
    },
    { id: 2, title: "No slug entry" },
    {
      id: 3,
      title: "Vendor launch",
      slug: "2026-07-20-24",
      published_at: "2026-07-20T09:00:00Z",
      content: "PR blurb",
    },
  ],
  totalCount: 3,
  hasNextPage: true,
});

const ARTICLE = JSON.stringify({
  title: "A new world model result (full)",
  published_at: "2026-07-20T08:00:00Z",
  content: "<h1>Body</h1><p>The method reaches 42% on the benchmark.</p>",
});

test("parseJqxList keeps rows with a slug and text-decodes the summary", () => {
  const rows = parseJqxList(LIST);
  expect(rows.length).toBe(2);
  expect(rows[0].slug).toBe("2026-07-20-23");
  expect(rows[0].url).toBe("https://www.jiqizhixin.com/articles/2026-07-20-23");
  expect(rows[0].summary).toBe("Short summary text.");
  expect(rows[1].publishedAt).toBe("2026-07-20T09:00:00Z");
});

test("parseJqxList tolerates garbage", () => {
  expect(parseJqxList("not json")).toEqual([]);
  expect(parseJqxList("{}")).toEqual([]);
});

test("parseJqxArticle pulls the body and strips to text on demand", () => {
  const a = parseJqxArticle(ARTICLE);
  expect(a.contentHtml).toContain("The method reaches 42%");
  expect(a.title).toBe("A new world model result (full)");
});

test("collectJiqizhixin fetches list then each article body", async () => {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    const body = url.includes("/articles.json") ? LIST : ARTICLE;
    return new Response(body, { status: 200 });
  };
  const items = await collectJiqizhixin({ fetchFn });
  expect(items.length).toBe(2);
  expect(items[0].source).toBe("jiqizhixin");
  expect(items[0].id).toMatch(/^jiqizhixin-/);
  expect(items[0].textContent).toContain("The method reaches 42%");
  // 1 list call + 2 article calls.
  expect(calls.length).toBe(3);
});

test("collectJiqizhixin keeps an item whose body fetch fails", async () => {
  const fetchFn = async (url: string) => {
    if (url.includes("/articles.json")) return new Response(LIST, { status: 200 });
    return new Response("nope", { status: 500 });
  };
  const items = await collectJiqizhixin({ fetchFn });
  expect(items.length).toBe(2);
  expect(items[0].textContent).toBeUndefined();
  expect(items[0].summary).toBe("Short summary text.");
});
