// The research sub-agent (src/reading/papers/research-agent.ts): the definition the
// reading turn mounts, what its brief may say, and the four ways a run that
// established nothing is stopped from arriving as an answer.
//
// Driven through the real agent loop over a scripted fake stream, with a fake search
// and a fake fetch: no provider, no credentials, no API key, no network. Same pattern
// as tests/legion/subagent/subagent.test.ts and tests/reading/papers/search-tool.ts.
// Run: bun test.

import { expect, test } from "bun:test";
import { subagentTool } from "../../../src/legion/subagent/tool";
import {
  buildResearchAgent,
  RESEARCH_KIND,
  RESEARCH_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  RESEARCH_TURN_ROUNDS,
} from "../../../src/reading/papers/research-agent";
import type { PaperCandidate, PaperSearchResult } from "../../../src/reading/papers/paper-search";

// --- the literature the fakes return ---

// A long abstract, standing in for the pile of text a real candidate list carries.
// None of it may reach the caller.
const ABSTRACT =
  "We measured cortical neuron numbers across eleven primate species. " + "Filler. ".repeat(200);

function candidate(title: string): PaperCandidate {
  return {
    title,
    authors: ["S Herculano-Houzel", "R Lent"],
    year: 2025,
    libraries: ["openalex"],
    doi: "10.1073/pnas.0611396104",
    arxivId: null,
    pmid: null,
    openAlexId: "W2033231119",
    s2PaperId: "s2seed",
    venue: "PNAS",
    url: "https://doi.org/10.1073/pnas.0611396104",
    abstract: ABSTRACT,
    citedByCount: 429,
  };
}

const FOUND: PaperSearchResult = {
  candidates: [candidate("Cellular scaling rules for primate brains")],
  failures: [],
  asked: ["openalex"],
};

function agent(
  over: {
    search?: () => Promise<PaperSearchResult>;
    fetchFn?: (url: string) => Promise<Response>;
  } = {},
) {
  return buildResearchAgent({
    search: over.search ?? (async () => FOUND),
    fetchFn:
      over.fetchFn ??
      (async () => {
        throw new Error("no scripted fetch");
      }),
  });
}

// --- the definition ---

test("the reader-facing tool is one tool, safely named, with one task parameter", () => {
  const tool = subagentTool(agent());

  // docs/24: pi-ai rewrites tool names matching Claude Code's canonical set on the
  // OAuth channel, matched case-insensitively. Underscored lowercase cannot collide.
  expect(tool.name).toBe("research_literature");
  expect(tool.name).toBe(tool.name.toLowerCase());
  expect(Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties)).toEqual([
    "task",
  ]);
  expect(tool.description).toContain("handful of named papers");
  expect(tool.description).toContain("No candidate lists");
});

test("the three literature tools are the sub-agent's own set", () => {
  expect(agent().tools.map((t) => t.name).sort()).toEqual([
    "find_paper",
    "search_papers",
    "walk_citations",
  ]);
});

// ingest_url belongs to the reader's turn; the sub-agent cannot reach it, so a result
// telling this run to ingest a paper would point at a tool that is not mounted.
test("the sub-agent's tools never offer to ingest a paper", async () => {
  const search = agent().tools.find((t) => t.name === "search_papers")!;
  expect(await search.execute({ query: "cortical scaling" })).not.toContain("ingest_url");
});

test("the brief is capped well under the capability's default", () => {
  expect(agent().briefTokenCap).toBe(700);
  // Six turns (the capability's default) per run, and a pot big enough for a real
  // follow-up but not for nine calls.
  expect(agent().maxRounds).toBeUndefined();
  expect(RESEARCH_TURN_ROUNDS).toBe(10);
});

// The brief is the whole of what the reader ends up seeing from a search, so the
// prompt states its shape rather than leaving it to the model's taste.
test("the sub-agent's prompt asks for a handful of checkable papers, not a survey", () => {
  const p = RESEARCH_SYSTEM_PROMPT;
  expect(p).toContain("at most five entries");
  expect(p).toContain("Three to five papers");
  expect(p).toContain("Always give a link or a DOI");
  expect(p).toContain("why THIS paper answers THIS question");
  expect(p).toContain("no survey essay");
  // What is deliberately left out.
  expect(p).toContain("Leave out how you searched");
  expect(p).toContain("No abstract paragraphs");
  expect(p).toContain("Never translate a title");
  // The red line the rest of the codebase already carries, verbatim in substance.
  expect(p).toContain("reference material, not");
});

test("the companion is told to hand it over rather than answer from memory", () => {
  // The literature is a run now (docs/68): the turn delegates and ends, and the
  // prompt has to say both halves or the model answers from memory while it waits.
  expect(RESEARCH_PROMPT).toContain("delegate");
  expect(RESEARCH_PROMPT).toContain(RESEARCH_KIND);
  expect(RESEARCH_PROMPT).toContain("do not answer from memory");
  expect(RESEARCH_PROMPT).toContain("come back here later");
  expect(RESEARCH_PROMPT).toContain("older than itself");
  // The division of labour with the one literature tool left on the reader's turn.
  expect(RESEARCH_PROMPT).toContain("find_paper");
});

// What crosses back, the honest failures, the pot and cancellation run on the
// durable runtime: tests/legion/subagent/subagent-durable.test.ts.
