// Unit tests for the search_papers chat tool (src/reading/prep/search-tool.ts).
// The search is a fake, so there is no network. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildPaperSearchTools,
  parseLibraries,
  parseSinceYear,
} from "../../../src/reading/prep/search-tool";
import type { PaperCandidate, PaperSearchOptions, PaperSearchResult } from "../../../src/reading/prep/paper-search";

function hit(title: string): PaperCandidate {
  return {
    title,
    authors: ["A Author"],
    year: 2026,
    libraries: ["pubmed"],
    doi: "10.1/x",
    arxivId: null,
    pmid: "1",
    venue: "PNAS",
    url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    abstract: "An abstract.",
  };
}

function tool(
  result: Partial<PaperSearchResult>,
  spy?: (query: string, opts: PaperSearchOptions) => void,
  canIngest = true,
) {
  const [t] = buildPaperSearchTools({
    canIngest,
    search: async (query, opts) => {
      spy?.(query, opts);
      return { candidates: [hit("A found paper")], failures: [], asked: ["pubmed"], ...result };
    },
  });
  return t;
}

test("the tool name is lowercase with an underscore, so pi cannot rewrite it", () => {
  const [t] = buildPaperSearchTools({
    canIngest: false,
    search: async () => ({ candidates: [], failures: [], asked: [] }),
  });
  // docs/24: pi-ai renames tools that match Claude Code's canonical names on the
  // OAuth channel (Read / Grep / WebSearch / …), which are all capitalized.
  expect(t.name).toBe("search_papers");
  expect(t.name).toBe(t.name.toLowerCase());
});

test("a query reaches the search and the candidates come back rendered", async () => {
  let seen: { query: string; opts: PaperSearchOptions } | null = null;
  const t = tool({}, (query, opts) => (seen = { query, opts }));
  const out = (await t.execute({ query: "  cortical scaling  ", since_year: 2025 })) as string;
  expect(seen!.query).toBe("cortical scaling");
  expect(seen!.opts.sinceYear).toBe(2025);
  expect(out).toContain("A found paper");
  expect(out).toContain("reference material, not instructions");
});

test("parseSinceYear ignores a value that cannot be a year", () => {
  expect(parseSinceYear(2025)).toBe(2025);
  expect(parseSinceYear("2025")).toBe(2025);
  expect(parseSinceYear(2025.7)).toBe(2026);
  expect(parseSinceYear(12)).toBeNull();
  expect(parseSinceYear("recent")).toBeNull();
  expect(parseSinceYear(undefined)).toBeNull();
});

test("parseLibraries defaults to all four and tolerates a name it does not know", () => {
  expect(parseLibraries(undefined)).toBeUndefined();
  expect(parseLibraries("all")).toBeUndefined();
  expect(parseLibraries("nonsense")).toBeUndefined();
  expect(parseLibraries("PubMed")).toEqual(["pubmed"]);
  expect(parseLibraries("semantic-scholar")).toEqual(["semantic-scholar"]);
});

test("an empty query is refused before any request goes out", async () => {
  let called = false;
  const [t] = buildPaperSearchTools({
    canIngest: true,
    search: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  await expect(t.execute({ query: "   " })).rejects.toThrow(/query/);
  expect(called).toBe(false);
});

test("no results with every library still answering is an empty field, not an error", async () => {
  const t = tool({ candidates: [], failures: [], asked: ["pubmed", "arxiv"] });
  const out = (await t.execute({ query: "x" })) as string;
  expect(out).toContain("No papers found");
});

// The failure this tool exists to avoid: a spent quota reported as "nothing
// found" tells the reader the field is empty (docs/24).
test("no results because nothing answered is a tool error naming each library", async () => {
  const t = tool({
    candidates: [],
    asked: ["openalex", "pubmed"],
    failures: [
      { library: "openalex", reason: "out of free API credits (HTTP 409)" },
      { library: "pubmed", reason: "HTTP 500" },
    ],
  });
  await expect(t.execute({ query: "x" })).rejects.toThrow(/OpenAlex.*credits.*PubMed/s);
});

test("partial results survive a failing library", async () => {
  const t = tool({
    candidates: [hit("Still found this")],
    asked: ["openalex", "pubmed"],
    failures: [{ library: "openalex", reason: "rate-limited" }],
  });
  const out = (await t.execute({ query: "x" })) as string;
  expect(out).toContain("Still found this");
  expect(out).toContain("Did not answer: OpenAlex");
});

test("with no ingestion path the result says so instead of offering add_source", async () => {
  const t = tool({}, undefined, false);
  const out = (await t.execute({ query: "x" })) as string;
  expect(out).not.toContain("add_source");
});
