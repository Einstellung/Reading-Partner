// The arXiv plugin's search slot (docs/88): a topic search's words with a
// submittedDate window (never a sortBy, docs/pitfall/72), against a scripted
// Atom response. Run: bun test.

import { expect, test } from "bun:test";
import { arxivSubmittedRange, arxivTopicSearchUrl } from "../../../../src/info/sources/plugins/arxiv-client";
import { arxivPlugin } from "../../../../src/info/sources/plugins/arxiv";
import type { PluginDeps } from "../../../../src/info/sources/plugin";
import { textResponse } from "../../../support/fetch";
import { ATTENTION_ATOM } from "./arxiv-fixtures";

function searchQuery(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("search_query") ?? "");
}

function deps(fetchFn: PluginDeps["fetchFn"], extra: Partial<PluginDeps> = {}): PluginDeps {
  return { fetchFn, now: () => Date.UTC(2026, 9, 14), today: () => "2026-10-14", ...extra };
}

test("a window is a closed submittedDate range of whole days", () => {
  expect(arxivSubmittedRange({ since: "2026-09-14", until: "2026-10-14" })).toBe(
    "submittedDate:[202609140000 TO 202610142359]",
  );
  // Open ends get bounds no submission falls outside.
  expect(arxivSubmittedRange({ since: "2026-10-13" })).toBe("submittedDate:[202610130000 TO 210001010000]");
  expect(arxivSubmittedRange({ until: "2026-10-13" })).toBe("submittedDate:[199101010000 TO 202610132359]");
  // `since` takes over from `sinceYear`; `sinceYear` alone keeps its old range.
  expect(arxivSubmittedRange({ sinceYear: 2025, since: "2026-10-01" })).toBe("submittedDate:[202610010000 TO 210001010000]");
  expect(arxivSubmittedRange({ sinceYear: 2025 })).toBe("submittedDate:[202501010000 TO 210001010000]");
  expect(arxivSubmittedRange({})).toBeNull();
});

test("a malformed day or an inverted window throws instead of widening the search", () => {
  expect(() => arxivSubmittedRange({ since: "2026-9-1" })).toThrow(/YYYY-MM-DD/);
  expect(() => arxivSubmittedRange({ until: "2026-13-45" })).toThrow(/YYYY-MM-DD/);
  expect(() => arxivSubmittedRange({ since: "2026-10-14", until: "2026-10-01" })).toThrow(/before it starts/);
});

test("the topic URL ANDs the words with the window and never sorts", () => {
  const url = arxivTopicSearchUrl("protein structure diffusion", { since: "2026-09-14", until: "2026-10-14", limit: 50 });
  expect(searchQuery(url)).toBe(
    "all:protein AND all:structure AND all:diffusion AND submittedDate:[202609140000 TO 202610142359]",
  );
  expect(url).not.toContain("sortBy");
  expect(new URL(url).searchParams.get("max_results")).toBe("50");
});

test("search() asks once with the window and maps entries to items with authors", async () => {
  const urls: string[] = [];
  const items = await arxivPlugin.search!(
    "attention transformer",
    { since: "2026-09-14", until: "2026-10-14" },
    deps(async (url) => {
      urls.push(url);
      return textResponse(ATTENTION_ATOM);
    }),
  );
  expect(urls).toHaveLength(1);
  expect(searchQuery(urls[0])).toContain("submittedDate:[202609140000 TO 202610142359]");
  // The plugin's default limit, when neither the call nor the deps set one.
  expect(new URL(urls[0]).searchParams.get("max_results")).toBe("50");
  expect(items).toHaveLength(1);
  const [item] = items;
  expect(item.source).toBe("arxiv");
  expect(item.sourceName).toBe("arXiv");
  expect(item.sourceKey).toBe("1706.03762");
  expect(item.url).toBe("https://arxiv.org/abs/1706.03762");
  expect(item.title).toBe("Attention Is All You Need");
  expect(item.authors?.length).toBeGreaterThan(1);
  expect(item.authors?.[0]).toBe("Ashish Vaswani");
});

test("search() takes the call's limit over the deps' and throws on a failed request", async () => {
  const urls: string[] = [];
  await arxivPlugin.search!("robot grasping", { limit: 7 }, deps(async (url) => {
    urls.push(url);
    return textResponse("<feed></feed>");
  }, { limit: 30 }));
  expect(new URL(urls[0]).searchParams.get("max_results")).toBe("7");

  await expect(
    arxivPlugin.search!("robot grasping", {}, deps(async () => textResponse("bad", 400))),
  ).rejects.toThrow();
});
