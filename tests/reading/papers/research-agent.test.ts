// The research sub-agent (src/reading/papers/research-agent.ts): the definition the
// reading turn mounts, what its brief may say, and the four ways a run that
// established nothing is stopped from arriving as an answer.
//
// Driven through the real agent loop over a scripted fake stream, with a fake search
// and a fake fetch: no provider, no credentials, no API key, no network. Same pattern
// as tests/ai/subagent.test.ts and tests/reading/papers/search-tool.ts.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";
import { runAgentLoop, type StreamFn } from "../../../src/ai/agent";
import { StoppedError } from "../../../src/ai/watchdog";
import { createSubagentLedger } from "../../../src/ai/subagent/ledger";
import { subagentTool } from "../../../src/ai/subagent/tool";
import { createTurnSettler } from "../../../src/ai/subagent/turn";
import type { SubagentProgress, SubagentTurnFn, SubagentTurnRequest } from "../../../src/ai/subagent/types";
import {
  buildResearchAgent,
  researchStatusLabel,
  RESEARCH_LABEL,
  RESEARCH_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  RESEARCH_TOOL_NAME,
  RESEARCH_TURN_ROUNDS,
} from "../../../src/reading/papers/research-agent";
import type { PaperCandidate, PaperSearchResult } from "../../../src/reading/papers/paper-search";

// --- a scripted model, one entry per streamed turn ---

type ToolReq = { name: string; args: Record<string, any>; id?: string };
type Turn = { text?: string; calls?: ToolReq[] };

function turnEvents(turn: Turn): AssistantMessageEvent[] {
  const blocks = [
    ...(turn.text ? [fauxText(turn.text)] : []),
    ...(turn.calls ?? []).map((c) => fauxToolCall(c.name, c.args, { id: c.id })),
  ];
  const hasCalls = (turn.calls ?? []).length > 0;
  const message: AssistantMessage = fauxAssistantMessage(blocks.length ? blocks : "", {
    stopReason: hasCalls ? "toolUse" : "stop",
  });
  const events: AssistantMessageEvent[] = [];
  if (turn.text) {
    events.push({ type: "text_delta", contentIndex: 0, delta: turn.text, partial: message });
  }
  events.push({ type: "done", reason: hasCalls ? "toolUse" : "stop", message });
  return events;
}

// A SubagentTurnFn backed by the real loop, recording what it was asked for.
function loopRunner(turns: Turn[]) {
  const requests: SubagentTurnRequest[] = [];
  let round = 0;
  const stream: StreamFn = () => {
    const i = round++;
    const s = createAssistantMessageEventStream();
    const events = turnEvents(turns[i] ?? { text: "no scripted turn" });
    (async () => {
      for (const ev of events) {
        await Promise.resolve();
        s.push(ev);
      }
      s.end();
    })();
    return s;
  };
  const run: SubagentTurnFn = (request) => {
    requests.push(request);
    const settler = createTurnSettler(request.signal, request.onRound);
    void runAgentLoop({
      stream,
      model: {} as Model<Api>,
      systemPrompt: request.systemPrompt,
      messages: [{ role: "user", content: request.task, timestamp: 0 }],
      tools: request.tools,
      signal: request.signal,
      maxRounds: request.maxRounds,
      purpose: request.purpose,
      ...settler.callbacks,
    });
    return settler.outcome.finally(() => settler.dispose());
  };
  return { run, requests, streamed: () => round };
}

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
  const tool = subagentTool(agent(), { run: loopRunner([]).run });

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

// add_source belongs to the reader's turn; the sub-agent cannot reach it, so a result
// telling this run to ingest a paper would point at a tool that is not mounted.
test("the sub-agent's tools never offer to ingest a paper", async () => {
  const search = agent().tools.find((t) => t.name === "search_papers")!;
  expect(await search.execute({ query: "cortical scaling" })).not.toContain("add_source");
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

test("the companion is told to reach for it instead of answering from memory", () => {
  expect(RESEARCH_PROMPT).toContain(RESEARCH_TOOL_NAME);
  expect(RESEARCH_PROMPT).toContain("rather than answering from memory");
  expect(RESEARCH_PROMPT).toContain("older than itself");
  // The division of labour with the one literature tool left on the reader's turn.
  expect(RESEARCH_PROMPT).toContain("find_paper");
});

// --- what crosses back ---

test("the reader's turn gets the brief and none of the candidate text", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "cortical neuron scaling" }, id: "t1" }] },
    {
      text:
        "Cellular scaling rules for primate brains (Herculano-Houzel et al., 2025, PNAS) — " +
        "https://doi.org/10.1073/pnas.0611396104\nCounts neurons directly, which is the " +
        "measurement the chapter's claim rests on.",
    },
  ]);
  const tool = subagentTool(agent(), { run: runner.run });

  const result = (await tool.execute({ task: "what does the recent work say about cortical scaling" })) as string;

  expect(result).toContain("Cellular scaling rules for primate brains");
  expect(result).toContain("https://doi.org/10.1073/pnas.0611396104");
  expect(result).not.toContain("Filler.");
  expect(result).not.toContain("We measured cortical neuron numbers");
});

// --- an unusable brief cannot arrive as an answer ---

test("a run that spent its turns throws instead of returning an answer", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { calls: [{ name: "search_papers", args: { query: "b" }, id: "t2" }] },
    { text: "The literature broadly agrees that neuron counts scale sublinearly." },
  ]);
  const tool = subagentTool({ ...agent(), maxRounds: 2 }, { run: runner.run });

  const attempt = tool.execute({ task: "what does the recent work say" });
  await expect(attempt).rejects.toThrow("all 2 of its turns");
  await expect(attempt).rejects.toThrow("not a finding");
  // The model's fluent paragraph is not in the thrown text either.
  await expect(attempt).rejects.not.toThrow("broadly agrees");
});

test("every library down is a failed tool call, never 'nothing was found'", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { text: "There is no recent work on cortical scaling." },
  ]);
  const tool = subagentTool(
    agent({
      search: async () => {
        throw new Error("No literature database answered: OpenAlex (409 out of credit)");
      },
    }),
    { run: runner.run },
  );

  const attempt = tool.execute({ task: "what does the recent work say" });
  await expect(attempt).rejects.toThrow("409 out of credit");
  await expect(attempt).rejects.toThrow("not a finding");
  await expect(attempt).rejects.not.toThrow("no recent work");
});

test("an answer written without consulting a library is not returned", async () => {
  const runner = loopRunner([{ text: "I know this one: neuron counts scale sublinearly." }]);
  const tool = subagentTool(agent(), { run: runner.run });

  const attempt = tool.execute({ task: "what does the recent work say" });
  await expect(attempt).rejects.toThrow("without calling any of its 3 tools");
  await expect(attempt).rejects.not.toThrow("sublinearly");
});

// --- the shared pot ---

test("the turn's pot is shared, and a third call is refused before it is sent", async () => {
  const ledger = createSubagentLedger(RESEARCH_TURN_ROUNDS);
  // Each run answers with no tool ever succeeding, so each spends one turn and is
  // unusable — which is beside the point here: what is under test is the pot.
  const runner = loopRunner([{ text: "one" }, { text: "two" }, { text: "three" }]);
  const tool = subagentTool(agent(), { run: runner.run, ledger });

  await expect(tool.execute({ task: "first question" })).rejects.toThrow("without calling any");
  await expect(tool.execute({ task: "second question" })).rejects.toThrow("without calling any");
  expect(runner.requests.length).toBe(2);
  // Six reserved, one spent, five returned: the second run still got its six.
  expect(runner.requests.map((r) => r.maxRounds)).toEqual([6, 6]);
});

test("a pot already spent stops the next call at the door", async () => {
  const ledger = createSubagentLedger(1);
  const runner = loopRunner([{ text: "one" }]);
  const tool = subagentTool(agent(), { run: runner.run, ledger });

  await expect(tool.execute({ task: "first" })).rejects.toThrow();
  await expect(tool.execute({ task: "second" })).rejects.toThrow("did not run at all");
  await expect(tool.execute({ task: "second" })).rejects.toThrow("Nothing was looked up");
  expect(runner.requests.length).toBe(1);
});

// --- cancellation ---

test("the reader hanging up mid-search kills the run and produces no brief", async () => {
  const controller = new AbortController();
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { text: "never asked for" },
  ]);
  const tool = subagentTool(
    agent({
      // The hangup lands while a library request is in flight, which is where a real
      // search spends its time.
      search: async () => {
        controller.abort();
        return FOUND;
      },
    }),
    { run: runner.run, signal: controller.signal },
  );

  await expect(tool.execute({ task: "what does the recent work say" })).rejects.toBeInstanceOf(
    StoppedError,
  );
  expect(runner.streamed()).toBe(1);
});

test("a signal already aborted never reaches the model", async () => {
  const controller = new AbortController();
  controller.abort();
  const runner = loopRunner([{ text: "never" }]);
  const tool = subagentTool(agent(), { run: runner.run, signal: controller.signal });

  await expect(tool.execute({ task: "anything" })).rejects.toBeInstanceOf(StoppedError);
  expect(runner.requests.length).toBe(0);
});

// --- the one line the reader sees ---

test("the status line is the label, gaining a round count once the run is under way", () => {
  const at = (over: Partial<SubagentProgress>): SubagentProgress => ({
    phase: "round",
    label: RESEARCH_LABEL,
    round: 1,
    roundsAllowed: 6,
    ...over,
  });

  expect(researchStatusLabel(at({ phase: "started", round: 0 }))).toBe("Searching the literature");
  expect(researchStatusLabel(at({ round: 1 }))).toBe("Searching the literature");
  expect(researchStatusLabel(at({ round: 2 }))).toBe("Searching the literature (2/6)");
  // No flicker back to the bare label when a tool starts inside round 2.
  expect(researchStatusLabel(at({ phase: "tool", round: 2, tool: "search_papers" }))).toBe(
    "Searching the literature (2/6)",
  );
  // A tool name the run reached for is never shown, and neither is a query.
  expect(researchStatusLabel(at({ phase: "tool", round: 4, tool: "walk_citations" }))).not.toContain(
    "walk_citations",
  );
});
