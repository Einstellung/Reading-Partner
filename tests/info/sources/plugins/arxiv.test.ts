// The arXiv index provider (src/info/sources/plugins/arxiv.ts): query schema,
// the one-line description, URL construction (a submittedDate range, never a
// sortBy — docs/pitfall/72), and discover() against a scripted Atom response,
// standalone and through the engine's index path. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { collectSource } from "../../../../src/info/sources/engine";
import type { SourceDescriptor } from "../../../../src/info/sources/descriptor";
import { arxivIndexUrl, arxivPlugin } from "../../../../src/info/sources/plugins/arxiv";
import {
  registerSourcePlugin,
  resetSourcePluginsForTests,
} from "../../../../src/info/sources/plugin";
import type { FetchFn } from "../../../../src/platform/app/host";
import { textResponse } from "../../../support/fetch";

afterEach(() => resetSourcePluginsForTests());

const TODAY = "2026-09-13";
// 2026-09-13T12:00:00Z, so the engine's UTC `today` is TODAY.
const NOW = Date.UTC(2026, 8, 13, 12);

function searchQuery(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("search_query") ?? "");
}

// --- validateQuery ---

test("validateQuery accepts categories, terms, or both, with an optional day count", () => {
  expect(arxivPlugin.validateQuery({ categories: ["cs.RO", "cs.AI"] })).toBeNull();
  expect(arxivPlugin.validateQuery({ terms: ["manipulation"] })).toBeNull();
  expect(arxivPlugin.validateQuery({ categories: ["q-bio.NC", "math-ph"], terms: ["grasping"], days: 7 })).toBeNull();
  // A single string stands for a one-element list.
  expect(arxivPlugin.validateQuery({ categories: "cs.RO" })).toBeNull();
});

test("validateQuery rejects an empty query, a malformed category and a bad day count", () => {
  expect(arxivPlugin.validateQuery({})).toMatch(/categories or terms/);
  expect(arxivPlugin.validateQuery({ categories: [] })).toMatch(/categories or terms/);
  expect(arxivPlugin.validateQuery({ categories: ["cs.robotics"] })).toMatch(/cs\.robotics/);
  expect(arxivPlugin.validateQuery({ categories: ["CS.RO"] })).toMatch(/CS\.RO/);
  expect(arxivPlugin.validateQuery({ categories: ["cs.RO"], days: 0 })).toMatch(/days/);
  expect(arxivPlugin.validateQuery({ categories: ["cs.RO"], days: "2" })).toMatch(/days/);
  expect(arxivPlugin.validateQuery({ categories: ["cs.RO"], days: 90 })).toMatch(/at most 30/);
  // Terms that clean down to nothing (stopwords, two-letter words) leave no
  // all: clause to search on.
  expect(arxivPlugin.validateQuery({ terms: ["the", "of"] })).toMatch(/searchable/);
});

// --- describeQuery ---

test("describeQuery reads as one line", () => {
  expect(arxivPlugin.describeQuery({ categories: ["cs.RO", "cs.AI"], terms: ["manipulation"] })).toBe(
    "arXiv cs.RO, cs.AI · all:manipulation · last 2 days",
  );
  expect(arxivPlugin.describeQuery({ categories: ["cs.RO"], days: 1 })).toBe("arXiv cs.RO · last 1 day");
  expect(arxivPlugin.describeQuery({ terms: ["Robot Manipulation"], days: 7 })).toBe(
    "arXiv · all:robot, all:manipulation · last 7 days",
  );
});

// --- URL ---

test("arxivIndexUrl ORs categories, ANDs terms and bounds by a submittedDate range, without sortBy", () => {
  const url = arxivIndexUrl({ categories: ["cs.RO", "cs.AI"], terms: ["manipulation"] }, TODAY, 50);
  expect(url.startsWith("https://export.arxiv.org/api/query?")).toBe(true);
  expect(url).not.toContain("sortBy");
  expect(url).not.toContain("sortOrder");
  expect(url).toContain("max_results=50");
  expect(searchQuery(url)).toBe(
    "(cat:cs.RO OR cat:cs.AI) AND all:manipulation AND submittedDate:[202609110000 TO 202609132359]",
  );
});

test("arxivIndexUrl handles one category without parentheses and honours days", () => {
  expect(searchQuery(arxivIndexUrl({ categories: ["cs.RO"], days: 7 }, TODAY, 10))).toBe(
    "cat:cs.RO AND submittedDate:[202609060000 TO 202609132359]",
  );
  // The window crosses a month boundary on the calendar, not by subtracting digits.
  expect(searchQuery(arxivIndexUrl({ terms: ["grasping"], days: 3 }, "2026-10-02", 5))).toBe(
    "all:grasping AND submittedDate:[202609290000 TO 202610022359]",
  );
});

// --- discover ---

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
  <entry>
    <id>http://arxiv.org/abs/2609.01234v1</id>
    <published>2026-09-12T17:59:01Z</published>
    <title>Dexterous Manipulation from
  Play</title>
    <summary>  We learn a policy from unstructured play data &amp; deploy it.
      ${"Long abstract. ".repeat(40)}</summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <author><name>Grace Hopper</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2609.05678v2</id>
    <published>2026-09-11T03:10:00Z</published>
    <title>A Single-Author Note</title>
    <summary>Short.</summary>
    <author><name>Solo Writer</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2609.09999v1</id>
    <title>No Category Given</title>
    <summary>Bare entry.</summary>
  </entry>
</feed>`;

const desc: SourceDescriptor = {
  id: "arxiv-ro",
  name: "arXiv robotics",
  line: "robotics",
  enabled: true,
  discovery: { kind: "index", provider: "arxiv", query: { categories: ["cs.RO", "cs.AI"], terms: ["manipulation"] } },
  fulltext: { mode: "none" },
};

// A fetch that serves the fixture and records what it was asked for.
function scripted(body = ATOM, status = 200): { fetchFn: FetchFn; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    return textResponse(body, status);
  };
  return { fetchFn, urls };
}

test("discover maps Atom entries to summary-only items with category and author-count tags", async () => {
  const { fetchFn, urls } = scripted();
  const items = await arxivPlugin.discover(desc, desc.discovery.kind === "index" ? desc.discovery.query : {}, {
    fetchFn,
    now: () => NOW,
    today: () => TODAY,
    limit: 25,
  });
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("max_results=25");
  expect(urls[0]).not.toContain("sortBy");
  expect(searchQuery(urls[0])).toContain("submittedDate:[202609110000 TO 202609132359]");

  expect(items.map((i) => i.sourceKey)).toEqual(["2609.01234", "2609.05678", "2609.09999"]);
  const [first, second, third] = items;
  expect(first.id).toMatch(/^arxiv-ro-/);
  expect(first.source).toBe("arxiv-ro");
  expect(first.sourceName).toBe("arXiv robotics");
  expect(first.title).toBe("Dexterous Manipulation from Play");
  expect(first.url).toBe("https://arxiv.org/abs/2609.01234");
  expect(first.publishedAt).toBe("2026-09-12T17:59:01Z");
  expect(first.summaryOnly).toBe(true);
  expect(first.textContent).toContain("We learn a policy from unstructured play data & deploy it.");
  expect(first.textContent!.length).toBeGreaterThan(400);
  expect(first.summary).toHaveLength(400);
  expect(first.textContent!.startsWith(first.summary!)).toBe(true);
  expect(first.signals).toEqual({ tags: ["cs.RO", "3 authors"] });

  expect(second.signals).toEqual({ tags: ["cs.AI", "1 author"] });
  expect(second.summary).toBe("Short.");

  expect(third.publishedAt).toBe("");
  expect(third.signals).toBeUndefined();
});

test("discover throws on a non-OK status so collectAll can record it", async () => {
  const { fetchFn } = scripted("nope", 404);
  await expect(
    arxivPlugin.discover(desc, { categories: ["cs.RO"] }, { fetchFn, now: () => NOW, today: () => TODAY }),
  ).rejects.toThrow(/404/);
});

test("discover honours an already-aborted signal before fetching", async () => {
  const { fetchFn, urls } = scripted();
  const ctl = new AbortController();
  ctl.abort();
  await expect(
    arxivPlugin.discover(desc, { categories: ["cs.RO"] }, {
      fetchFn,
      signal: ctl.signal,
      now: () => NOW,
      today: () => TODAY,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(urls).toHaveLength(0);
});

test("the engine runs an arXiv index descriptor through the registered provider", async () => {
  registerSourcePlugin(arxivPlugin);
  const { fetchFn, urls } = scripted();
  const items = await collectSource(desc, { fetchFn, now: () => NOW });
  expect(urls).toHaveLength(1);
  // The engine hands the provider its UTC day and the provider's default limit.
  expect(urls[0]).toContain("max_results=50");
  expect(searchQuery(urls[0])).toBe(
    "(cat:cs.RO OR cat:cs.AI) AND all:manipulation AND submittedDate:[202609110000 TO 202609132359]",
  );
  expect(items).toHaveLength(3);
  expect(items[0].source).toBe("arxiv-ro");
  expect(items[0].sourceName).toBe("arXiv robotics");
  expect(items[0].signals?.tags).toEqual(["cs.RO", "3 authors"]);
});

test("the engine rejects an arXiv descriptor whose query the provider refuses", async () => {
  registerSourcePlugin(arxivPlugin);
  const { fetchFn, urls } = scripted();
  const bad: SourceDescriptor = { ...desc, discovery: { kind: "index", provider: "arxiv", query: {} } };
  await expect(collectSource(bad, { fetchFn, now: () => NOW })).rejects.toThrow(/categories or terms/);
  expect(urls).toHaveLength(0);
});
