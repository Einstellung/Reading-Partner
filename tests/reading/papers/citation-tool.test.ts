// Tests for the find_paper / walk_citations chat tools. The tool layer's job is
// argument validation and turning a miss into the right kind of answer — an empty
// result the model can read, or an error it cannot mistake for an absence of
// research. Fake fetch only. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildCitationTools,
  FIND_PAPER_PROMPT,
} from "../../../src/reading/papers/citation-tool";
import type { AgentTool } from "../../../src/ai/agent";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const S2_SEED = {
  paperId: "s2seed",
  title: "Cellular scaling rules for primate brains",
  year: 2007,
  citationCount: 429,
  externalIds: { DOI: "10.1073/pnas.0611396104" },
};

const OA_SEED = {
  id: "https://openalex.org/W2033231119",
  display_name: "Cellular scaling rules for primate brains",
  publication_year: 2007,
  cited_by_count: 423,
  doi: "https://doi.org/10.1073/pnas.0611396104",
};

function tools(handlers: Record<string, () => Response>, canIngest = true) {
  const seen: string[] = [];
  const fetchFn = async (url: string): Promise<Response> => {
    seen.push(url);
    for (const [needle, make] of Object.entries(handlers)) {
      if (url.includes(needle)) return make();
    }
    throw new Error(`unexpected url ${url}`);
  };
  const built = buildCitationTools({ fetchFn, canIngest });
  const byName = (n: string): AgentTool => built.find((t) => t.name === n)!;
  return { seen, find: byName("find_paper"), walk: byName("walk_citations"), all: built };
}

test("the tool names are lowercase and underscored", () => {
  // Anything matching Claude Code's canonical set is renamed by pi-ai on the OAuth
  // channel, so a tool called Read or WebSearch would go out as a different tool.
  expect(tools({}).all.map((t) => t.name)).toEqual(["find_paper", "walk_citations"]);
});

test("find_paper returns the record with the ids a walk needs", async () => {
  const { find } = tools({
    "api.openalex.org": () => json(OA_SEED),
    "api.semanticscholar.org": () => json(S2_SEED),
  });
  const text = await find.execute({ paper: "10.1073/pnas.0611396104" });
  expect(text).toContain("Cellular scaling rules for primate brains");
  expect(text).toContain("doi:10.1073/pnas.0611396104");
  expect(text).toContain("walk_citations");
  // The line that tells the model why the forward direction is the interesting one.
  expect(text).toContain("recent research");
});

test("find_paper needs something to look up", async () => {
  const { find } = tools({});
  await expect(find.execute({ paper: "   " })).rejects.toThrow(/needs a title/);
});

test("find_paper turns a total library outage into an error, not a missing paper", async () => {
  const { find } = tools({
    "api.openalex.org": () => new Response("nope", { status: 500 }),
    "api.semanticscholar.org": () => new Response("nope", { status: 503 }),
  });
  await expect(find.execute({ paper: "10.1073/pnas.0611396104" })).rejects.toThrow(
    /No library answered/,
  );
});

test("walk_citations rejects a direction it cannot walk", async () => {
  const { walk } = tools({});
  await expect(walk.execute({ paper: "10.1/x", direction: "sideways" })).rejects.toThrow(
    /"citations" or "references"/,
  );
  await expect(walk.execute({ paper: "10.1/x" })).rejects.toThrow(/"citations" or "references"/);
});

// An unidentified seed must not come back as a walk that found nothing: the reader
// would hear "no one has followed this up" about a paper that was never looked at.
test("walk_citations fails loudly when the seed itself could not be identified", async () => {
  const { walk } = tools({
    "api.openalex.org": () => json({ results: [] }),
    "api.semanticscholar.org": () => json({ data: [] }),
  });
  await expect(
    walk.execute({ paper: "A paper nobody has heard of", direction: "citations" }),
  ).rejects.toThrow(/Could not identify the seed paper/);
});

test("walk_citations resolves the seed, then walks forward from it", async () => {
  const { walk, seen } = tools({
    "filter=cites": () =>
      json({
        meta: { count: 44 },
        results: [
          {
            id: "https://openalex.org/W3000",
            display_name: "Unraveling mechanisms of human brain evolution",
            publication_year: 2024,
            cited_by_count: 45,
          },
        ],
      }),
    "api.openalex.org": () => json(OA_SEED),
    "api.semanticscholar.org": () => json(S2_SEED),
  });
  const text = await walk.execute({
    paper: "10.1073/pnas.0611396104",
    direction: "citations",
    since_year: 2024,
    limit: 5,
  });
  expect(text).toContain("papers citing");
  expect(text).toContain("Unraveling mechanisms of human brain evolution");
  expect(text).toContain("Source: OpenAlex");
  expect(seen.some((u) => u.includes("cites:W2033231119"))).toBe(true);
  expect(seen.some((u) => u.includes("from_publication_date:2024-01-01"))).toBe(true);
});

test("a seed matched only by title says so above the results", async () => {
  const { walk } = tools({
    "filter=cites": () => json({ meta: { count: 1 }, results: [] }),
    "/citations": () =>
      json({ data: [{ citingPaper: { paperId: "c1", title: "A citing paper", year: 2025 } }] }),
    "api.openalex.org": () => json({ results: [] }),
    "api.semanticscholar.org": () => json({ data: [S2_SEED] }),
  });
  const text = await walk.execute({
    paper: "Herculano-Houzel, S. Cellular scaling rules for primate brains. PNAS (2007).",
    direction: "citations",
  });
  expect(text).toContain("Seed matched by title, not by identifier");
});

test("without add_source the results never promise to fetch a paper", async () => {
  const { find } = tools(
    { "api.openalex.org": () => json(OA_SEED), "api.semanticscholar.org": () => json(S2_SEED) },
    false,
  );
  expect(await find.execute({ paper: "10.1073/pnas.0611396104" })).not.toContain("add_source");
});

// find_paper is the one literature tool left on the reader's own turn, and the
// endnote path is only reachable if the prompt says the notes name real papers.
test("the prompt line points at the citations in the book the reader is holding", () => {
  expect(FIND_PAPER_PROMPT).toContain("find_paper");
  expect(FIND_PAPER_PROMPT).toContain("endnote");
  expect(FIND_PAPER_PROMPT).toContain("Never invent a paper");
});
