// The sub-agent runner and its parent-side tool (src/legion/subagent/run.ts,
// tool.ts), driven through the real agent loop over a scripted fake stream — so
// the settling, the tool execution, the round counting, the mid-turn budget
// refusal and the abort path are the production ones, with no provider, no
// credentials and no network. Same pattern as tests/memory/distill.test.ts.
// Run: bun test.

import { expect, test } from "bun:test";
import { Type, type Api, type Model } from "@earendil-works/pi-ai";
import { runHarnessTurn, type AgentTool, type StreamFn } from "../../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import { memoryAppData } from "../../support/memory-appdata";
import { StoppedError } from "../../../src/legion/execute/watchdog";
import { runSubagent } from "../../../src/legion/subagent/run";
import { subagentTool } from "../../../src/legion/subagent/tool";
import { createSubagentQuota } from "../../../src/legion/subagent/quota";
import { createTurnSettler, workerLane } from "../../../src/legion/subagent/turn";
import type {
  SubagentDefinition,
  SubagentProgress,
  SubagentTurnFn,
} from "../../../src/legion/subagent/types";
import type { Turn } from "../../support/scripted-turn";
import { scriptedSubagentRunner } from "../../support/scripted-runner";

// --- a scripted model, one entry per streamed turn ---


const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;

function sizedModel(contextWindow: number): Model<Api> {
  return { id: "m", name: "m", provider: "faux", contextWindow, maxTokens: 64_000 } as unknown as Model<Api>;
}

// A SubagentTurnFn backed by the real loop, in the worker's own lane.
function loopRunner(turns: Turn[], model: Model<Api> = MODEL) {
  return scriptedSubagentRunner(turns, { model, lane: (request) => workerLane(request.name) });
}

// The tool result a real lookup would produce: the pile of text that must never
// reach the caller.
const HAYSTACK = "abstract: ".repeat(500);

function searchTool(result: string | (() => never) = HAYSTACK): AgentTool {
  return {
    name: "search_papers",
    label: () => "Running the fake tool",
    effect: "read" as const,
    description: "search the literature",
    parameters: Type.Object({ query: Type.String() }),
    execute: async () => (typeof result === "string" ? result : result()),
  };
}

function definition(over: Partial<SubagentDefinition> = {}): SubagentDefinition {
  return {
    name: "research_literature",
    description: "Investigate what the literature says about something.",
    label: "Searching the literature",
    systemPrompt: "You are a literature scout.",
    tools: [searchTool()],
    ...over,
  };
}

// --- isolation ---

test("only the brief crosses back; the tool traffic does not", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "cortical scaling" }, id: "t1" }] },
    { text: "Three papers since 2024: Herculano-Houzel 2024, Liu 2025, Park 2025." },
  ]);
  const events: SubagentProgress[] = [];

  const result = await runSubagent(
    { definition: definition(), task: "find recent work on cortical scaling", onProgress: (p) => events.push(p) },
    { run: runner.run },
  );

  expect(result.outcome).toBe("answered");
  expect(result.usable).toBe(true);
  expect(result.brief).toBe("Three papers since 2024: Herculano-Houzel 2024, Liu 2025, Park 2025.");
  expect(result.brief).not.toContain("abstract:");
  expect(result.rounds).toBe(2);
  expect(result.roundsAllowed).toBe(6);
  expect(result.toolCalls).toBe(1);
  expect(result.toolSuccesses).toBe(1);

  // Nothing the run read, and nothing it invented, travels out through progress
  // either: a tool name the caller injected is all a progress event carries.
  const serialised = JSON.stringify(events);
  expect(serialised).not.toContain("abstract:");
  expect(serialised).not.toContain("cortical scaling");
  expect(events.map((e) => e.phase)).toEqual(["started", "round", "tool", "round", "done"]);
  expect(events.every((e) => e.label === "Searching the literature")).toBe(true);
  expect(events.find((e) => e.phase === "tool")?.tool).toBe("search_papers");
  expect(events[events.length - 1].outcome).toBe("answered");
});

test("the run starts from one user message: no caller history is replayed", async () => {
  const runner = loopRunner([{ text: "nothing found in the last five years." }]);

  await runSubagent(
    { definition: definition({ evidence: "optional" }), task: "find work on X" },
    { run: runner.run },
  );

  expect(runner.requests[0].task).toBe("find work on X");
  const sent = runner.contexts[0].messages;
  expect(sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ role: "user", content: "find work on X" });
  // The definition's prompt, plus the contract that tells the run its work is
  // discarded.
  expect(runner.requests[0].systemPrompt).toContain("You are a literature scout.");
  expect(runner.requests[0].systemPrompt).toContain("You are a sub-agent");
});

// --- honest failure ---

test("a run that spends its turn cap returns the cap, not an empty result", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { calls: [{ name: "search_papers", args: { query: "b" }, id: "t2" }] },
    { text: "never asked for" },
  ]);

  const result = await runSubagent(
    { definition: definition({ maxRounds: 2 }), task: "find everything" },
    { run: runner.run },
  );

  expect(result.outcome).toBe("out-of-turns");
  expect(result.usable).toBe(false);
  expect(result.rounds).toBe(2);
  expect(result.brief).toContain("all 2 of its turns");
  expect(result.brief).toContain("not a finding");
  expect(result.brief).not.toContain("never asked for");
  expect(runner.streamed()).toBe(2);
});

// The loop's other stated give-up: a round that outgrew the model's window. Set
// up exactly as tests/ai/agent.test.ts does — pi prices the first turn from its
// reported usage, so round two would go out with an output allowance of 1.
test("a run whose context outgrows the window says that, not that it found nothing", async () => {
  const runner = loopRunner(
    [
      { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }], usage: 197_000 },
      { text: "never asked for" },
    ],
    sizedModel(200_000),
  );

  const result = await runSubagent(
    { definition: definition({ systemPrompt: "张".repeat(60_000) }), task: "find everything" },
    { run: runner.run },
  );

  expect(result.outcome).toBe("out-of-context");
  expect(result.usable).toBe(false);
  expect(result.brief).toContain("no longer left the model room to answer");
  expect(runner.streamed()).toBe(1);
});

test("a fluent answer with every tool broken is not returned", async () => {
  const broken = searchTool(() => {
    throw new Error("network error: getaddrinfo ENOTFOUND");
  });
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { text: "The literature broadly agrees that cortical neuron counts scale with brain mass." },
  ]);

  const result = await runSubagent(
    { definition: definition({ tools: [broken] }), task: "find recent work" },
    { run: runner.run },
  );

  expect(result.outcome).toBe("no-evidence");
  expect(result.usable).toBe(false);
  expect(result.brief).not.toContain("broadly agrees");
  expect(result.brief).toContain("search_papers: network error: getaddrinfo ENOTFOUND");
  expect(result.toolFailures).toEqual([
    { name: "search_papers", reason: "network error: getaddrinfo ENOTFOUND", count: 1 },
  ]);
});

test("a lookup run that never called its tools is not an answer either", async () => {
  const runner = loopRunner([{ text: "I know this one already: neurons scale sublinearly." }]);

  const result = await runSubagent({ definition: definition(), task: "find recent work" }, { run: runner.run });

  expect(result.outcome).toBe("no-evidence");
  expect(result.brief).not.toContain("sublinearly");
  expect(result.brief).toContain("without calling any of its 1 tool");
});

test("a sub-agent whose job is not lookup may answer with no tools at all", async () => {
  const runner = loopRunner([{ text: "Rewritten: shorter and in the reader's language." }]);

  const result = await runSubagent(
    { definition: definition({ tools: [], evidence: "optional" }), task: "rewrite this" },
    { run: runner.run },
  );

  expect(result.outcome).toBe("answered");
  expect(result.usable).toBe(true);
  expect(result.brief).toBe("Rewritten: shorter and in the reader's language.");
});

test("a failed call is reported as a failure the caller can name", async () => {
  const runner = loopRunner([{ error: "401 invalid x-api-key" }]);

  const result = await runSubagent({ definition: definition(), task: "find work" }, { run: runner.run });

  expect(result.outcome).toBe("failed");
  expect(result.usable).toBe(false);
  expect(result.brief).toContain("401 invalid x-api-key");
  expect(result.brief).toContain("failed call, not an empty result");
  // Beside the sentence, the two fields a caller can log: the brief is written
  // for a reader and a caller recording the failure must not have to parse it.
  expect(result.failure).toEqual({ name: "Error", message: "401 invalid x-api-key" });
});

test("a call that never reached the provider keeps the thrown error's own type", async () => {
  // What the owner's store recorded for twelve hours: outcome "failed", and the
  // only category left after that is "unknown". The type of what was thrown is
  // the difference between a signed-out provider and a broken network, and it
  // does not survive being turned into a sentence.
  const stream: StreamFn = () => {
    throw new TypeError("Load failed");
  };
  const run: SubagentTurnFn = (request) => {
    const settler = createTurnSettler(request.signal, request.onRound);
    void runHarnessTurn({
      stream,
      fileSystem: createSessionFileSystem(memoryAppData()),
      model: MODEL,
      systemPrompt: request.systemPrompt,
      messages: [{ role: "user", content: request.task, timestamp: 0 }],
      tools: request.tools,
      maxRounds: request.maxRounds,
      ...settler.callbacks,
    });
    return settler.outcome.finally(() => settler.dispose());
  };

  const result = await runSubagent({ definition: definition(), task: "find work" }, { run });

  expect(result.outcome).toBe("failed");
  expect(result.failure).toEqual({ name: "TypeError", message: "Load failed" });
});

test("a turn function that throws is a failure the caller can name, not a rejection", async () => {
  const run: SubagentTurnFn = async () => {
    throw new RangeError("no default AI provider configured (Settings)");
  };

  const result = await runSubagent({ definition: definition(), task: "find work" }, { run });

  expect(result.outcome).toBe("failed");
  expect(result.failure).toEqual({
    name: "RangeError",
    message: "no default AI provider configured (Settings)",
  });
});

test("a run that ended in anything but a failed call carries no error of its own", async () => {
  // "refused", "out-of-turns", "out-of-context" and "no-evidence" all end with
  // the model or the loop having said something, and that sentence is not an
  // error — a caller logging one would be logging the model's words.
  const runner = loopRunner([{ calls: [{ name: "search_papers", args: { query: "x" } }] }]);
  const result = await runSubagent(
    { definition: definition({ maxRounds: 1 }), task: "find work" },
    { run: runner.run },
  );

  expect(result.outcome).toBe("out-of-turns");
  expect(result.failure).toBeUndefined();
});

test("one broken tool among several leaves a usable brief with the failure named", async () => {
  const flaky: AgentTool = {
    name: "walk_citations",
    label: () => "Running the fake tool",
    effect: "read" as const,
    description: "walk the citation graph",
    parameters: Type.Object({ paper: Type.String() }),
    execute: async () => {
      throw new Error("429 rate limited");
    },
  };
  const runner = loopRunner([
    {
      calls: [
        { name: "search_papers", args: { query: "a" }, id: "t1" },
        { name: "walk_citations", args: { paper: "a" }, id: "t2" },
      ],
    },
    { text: "Two papers: Liu 2025 and Park 2025." },
  ]);

  const result = await runSubagent(
    { definition: definition({ tools: [searchTool(), flaky] }), task: "find recent work" },
    { run: runner.run },
  );

  expect(result.outcome).toBe("answered");
  expect(result.usable).toBe(true);
  expect(result.brief).toContain("Two papers: Liu 2025 and Park 2025.");
  expect(result.brief).toContain("1 of its 2 tool calls failed");
  expect(result.brief).toContain("walk_citations: 429 rate limited");
});

// --- cancellation ---

test("the reader hanging up kills the run and produces no brief at all", async () => {
  const controller = new AbortController();
  const hangUp: AgentTool = {
    name: "search_papers",
    label: () => "Running the fake tool",
    effect: "read" as const,
    description: "search the literature",
    parameters: Type.Object({ query: Type.String() }),
    execute: async () => {
      controller.abort();
      return HAYSTACK;
    },
  };
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { text: "should never be asked for" },
  ]);

  const attempt = runSubagent(
    { definition: definition({ tools: [hangUp] }), task: "find work", signal: controller.signal },
    { run: runner.run },
  );

  await expect(attempt).rejects.toBeInstanceOf(StoppedError);
  expect(runner.streamed()).toBe(1);
});

test("a signal already aborted never reaches the model", async () => {
  const controller = new AbortController();
  controller.abort();
  const runner = loopRunner([{ text: "should never run" }]);

  await expect(
    runSubagent(
      { definition: definition(), task: "find work", signal: controller.signal },
      { run: runner.run },
    ),
  ).rejects.toBeInstanceOf(StoppedError);
  expect(runner.requests.length).toBe(0);
});

// --- the shared round budget ---

test("a spent round budget stops the next run before it is sent", async () => {
  const quota = createSubagentQuota(1);
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { calls: [{ name: "search_papers", args: { query: "b" }, id: "t2" }] },
  ]);

  const first = await runSubagent({ definition: definition(), task: "find work" }, { run: runner.run, quota });
  // Granted one turn of its requested six, and it spent it.
  expect(first.roundsAllowed).toBe(1);
  expect(first.outcome).toBe("out-of-turns");
  expect(quota.remaining()).toBe(0);

  const second = await runSubagent({ definition: definition(), task: "find more" }, { run: runner.run, quota });
  expect(second.outcome).toBe("out-of-budget");
  expect(second.brief).toContain("did not run at all");
  expect(second.brief).toContain("not a finding");
  // The second run never reached the model.
  expect(runner.requests.length).toBe(1);
});

test("a cheap run returns its unspent turns to the caller's pot", async () => {
  const quota = createSubagentQuota(8);
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { text: "One paper: Liu 2025." },
  ]);

  const result = await runSubagent({ definition: definition(), task: "find work" }, { run: runner.run, quota });

  expect(result.rounds).toBe(2);
  expect(quota.remaining()).toBe(6);
});

// --- the parent-side tool ---

test("mounted as a tool, a usable brief is the tool result", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { text: "One paper: Liu 2025." },
  ]);
  const tool = subagentTool(definition(), { run: runner.run });

  expect(tool.name).toBe("research_literature");
  expect(tool.description).toContain("Investigate what the literature says");
  expect(tool.description).toContain("You will not see what it did");
  expect(await tool.execute({ task: "find recent work" })).toBe("One paper: Liu 2025.");
});

// Same discipline as src/reading/papers/search-tool.ts: a result the model reads as
// an answer is how "stopped early" becomes "the literature is silent".
test("mounted as a tool, a run that established nothing throws its own words", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "a" }, id: "t1" }] },
    { calls: [{ name: "search_papers", args: { query: "b" }, id: "t2" }] },
  ]);
  const tool = subagentTool(definition({ maxRounds: 2 }), { run: runner.run });

  await expect(tool.execute({ task: "find recent work" })).rejects.toThrow("all 2 of its turns");
});

test("a tool with no task is rejected before anything is sent", async () => {
  const runner = loopRunner([{ text: "never" }]);
  const tool = subagentTool(definition(), { run: runner.run });

  await expect(tool.execute({ task: "  " })).rejects.toThrow("needs a task");
  expect(runner.requests.length).toBe(0);
});

// pi-ai rewrites tool names matching Claude Code's canonical set on the OAuth
// channel (docs/24), so the shape is refused where the tool is built.
test("a sub-agent name that could be rewritten by the provider is refused", () => {
  expect(() => subagentTool(definition({ name: "WebSearch" }), { run: loopRunner([]).run })).toThrow(
    "not a safe tool name",
  );
});

// A sub-agent is a worker lane on the harness (docs/55). The name is the one
// thing the runner has to hand the turn for that: everything else about the
// lane follows from it.
test("the run is a worker lane named after its definition", async () => {
  const runner = loopRunner([
    { calls: [{ name: "search_papers", args: { query: "q" }, id: "t1" }] },
    { text: "One paper." },
  ]);

  const result = await runSubagent({ definition: definition(), task: "find work" }, { run: runner.run });

  expect(result.outcome).toBe("answered");
  expect(runner.requests[0]?.name).toBe("research_literature");
  expect(workerLane("research_literature")).toEqual({
    name: "worker:research_literature",
    sessions: "worker",
  });
});
