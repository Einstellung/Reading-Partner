// The sub-agent tool on the durable runtime (docs/soul/87, 第三阶段): the
// literature-search sub-agent as a child conversation of a reading turn, on
// the faux provider and the bun:sqlite stand-in. What crosses back, the six
// honest failures, the shared pot, the parent's stop reaching the child, and a
// restart in the middle of the child's run.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { AgentDoc, type ConversationId } from "@earendil-works/pi-durable";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubagentDoc } from "../../../src/legion/durable/child";
import { openDurable, type DurableRuntime } from "../../../src/legion/durable/harness";
import { recoverBeforeResume } from "../../../src/legion/durable/recover";
import { startTurn, stopTurn } from "../../../src/legion/durable/turn";
import type { AgentTool } from "../../../src/legion/execute/contract";
import { createSubagentQuota, type SubagentQuota } from "../../../src/legion/subagent/quota";
import { subagentTool } from "../../../src/legion/subagent/tool";
import type { SubagentDefinition } from "../../../src/legion/subagent/types";
import type { PaperCandidate, PaperSearchResult } from "../../../src/reading/papers/paper-search";
import { buildResearchAgent, RESEARCH_SYSTEM_PROMPT } from "../../../src/reading/papers/research-agent";
import { deferred, messageLine, ORIGIN, KEY, testHost, ThreadFile } from "../durable/support/runtime";

const FILLER = "Filler. ".repeat(200);

function candidate(title: string): PaperCandidate {
  return {
    title,
    authors: ["S Herculano-Houzel"],
    year: 2025,
    libraries: ["openalex"],
    doi: "10.1073/pnas.0611396104",
    arxivId: null,
    pmid: null,
    openAlexId: "W1",
    s2PaperId: "s2",
    venue: "PNAS",
    url: "https://doi.org/10.1073/pnas.0611396104",
    abstract: `We measured cortical neuron numbers. ${FILLER}`,
    citedByCount: 429,
  };
}
const FOUND: PaperSearchResult = { candidates: [candidate("Cellular scaling rules")], failures: [], asked: ["openalex"] };

const FAUX = { providerId: "faux" as never, modelId: "faux-1" };
const TINY = { providerId: "faux" as never, modelId: "faux-tiny" };

function agent(over: { search?: () => Promise<PaperSearchResult>; definition?: Partial<SubagentDefinition> } = {}) {
  return {
    ...buildResearchAgent({
      search: over.search ?? (async () => FOUND),
      fetchFn: async () => {
        throw new Error("no scripted fetch");
      },
    }),
    model: FAUX,
    ...over.definition,
  };
}

type Request = { system: string; lines: string[] };

interface Opened {
  runtime: DurableRuntime;
  file: ThreadFile;
  requests: Request[];
}

const tool = (name: string, args: Record<string, string>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const say = (text: string) => fauxAssistantMessage(fauxText(text));

async function open(root: string, responses: FauxResponseStep[], desk: () => AgentTool[]): Promise<Opened> {
  mkdirSync(root, { recursive: true });
  const faux = fauxProvider({
    tokensPerSecond: 5000,
    tokenSize: { min: 1, max: 2 },
    models: [
      { id: "faux-1", contextWindow: 200_000, maxTokens: 4096 },
      { id: "faux-tiny", contextWindow: 300, maxTokens: 64 },
    ],
  });
  const opened: Opened = { runtime: undefined as never, file: new ThreadFile(join(root, "thread.jsonl")), requests: [] };
  const record = (context: PiContext) =>
    opened.requests.push({
      system: JSON.stringify([context.systemPrompt, context.messages.filter((m) => m.role === "system")]),
      lines: context.messages.filter((m) => m.role !== "system").map(messageLine),
    });
  faux.setResponses(
    responses.map((step) =>
      typeof step === "function"
        ? (context, options, state, model) => {
            record(context);
            return step(context, options, state, model);
          }
        : (context) => {
            record(context);
            return step;
          },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  opened.runtime = await openDurable({
    host: testHost(root),
    models,
    catalog: desk(),
    resolvers: { book: async () => desk() },
    landers: { book: async (_origin, turn) => opened.file.land(turn) },
    readHistory: async (_origin, { excludeTs }) => opened.file.history(excludeTs),
    sectionKeys: ["soul"],
  });
  return opened;
}

function ask(t: Opened, text: string, ts = 1000) {
  t.file.append({ role: "user", ts, text });
  return startTurn(
    t.runtime,
    {
      key: KEY,
      origin: ORIGIN,
      content: text,
      sections: { soul: "You are a reading partner." },
      tools: ["research_literature"],
      model: { provider: "faux", modelId: "faux-1" },
      excludeTs: ts,
    },
    ctx,
  );
}

const callsOf = (row: unknown) => ((row as { tools?: { name: string; isError: boolean }[] } | undefined)?.tools ?? []);

const root = () => mkdtempSync(join(tmpdir(), "subagent-durable-"));

async function children(runtime: DurableRuntime): Promise<ConversationId[]> {
  const page = await runtime.storage.scanConversations({}, 100, undefined, ctx);
  const ids: ConversationId[] = [];
  for (const record of page.items) {
    if ((await runtime.harness.snapshot(SubagentDoc, record.id, ctx))?.name) ids.push(record.id);
  }
  return ids;
}

/** The tool result the parent's second request carried. */
function toolResultLine(t: Opened): string {
  const second = t.requests[t.requests.length - 1]!;
  return second.lines.find((l) => l.startsWith("toolResult:")) ?? "";
}

test("the sub-agent runs as a child of the reading turn and only its brief crosses back", async () => {
  const brief = "Cellular scaling rules (Herculano-Houzel, 2025) — https://doi.org/10.1073/pnas.0611396104";
  const t = await open(
    root(),
    [
      tool("research_literature", { task: "recent work on cortical scaling" }),
      tool("search_papers", { query: "cortical neuron scaling" }),
      say(brief),
      say("It went off and came back with one paper."),
    ],
    () => [subagentTool(agent())],
  );
  const turn = await ask(t, "What does the research say?");
  expect((await turn.settled)?.landed).toBe(true);

  const [parent1, child1, child2, parent2] = t.requests;
  // The child has the sub-agent's own prompt and tools (issue 307), none of the parent's.
  expect(child1!.system).toContain(RESEARCH_SYSTEM_PROMPT.slice(0, 60));
  expect(child1!.system).not.toContain("You are a reading partner.");
  expect(child1!.lines).toEqual(["user:recent work on cortical scaling"]);
  expect(child2!.lines.some((l) => l.includes("Filler."))).toBe(true);
  expect(parent1!.system).toContain("You are a reading partner.");
  // The parent sees one tool result: the brief, none of the candidate text.
  expect(parent2!.lines.join("\n")).toContain(brief);
  expect(parent2!.lines.join("\n")).not.toContain("Filler.");
  expect(parent2!.lines).toHaveLength(3);

  const rows = t.file.rows();
  expect(rows.map((r) => r.text)).toEqual(["What does the research say?", "It went off and came back with one paper."]);
  expect(callsOf(rows[1]).map((c) => [c.name, c.isError])).toEqual([["research_literature", false]]);
  const kids = await children(t.runtime);
  expect(kids).toHaveLength(1);
  const configured = await t.runtime.harness.snapshot(AgentDoc, kids[0]!, ctx);
  expect([...((configured?.tools as string[] | undefined) ?? [])].sort()).toEqual(["find_paper", "search_papers", "walk_citations"]);
  expect((await t.runtime.harness.inspect(ctx)).tasks).toHaveLength(0);
  await t.runtime.close(ctx);
});

// --- the six honest failures, each thrown into the parent as an error result ---

async function failure(responses: FauxResponseStep[], over: Parameters<typeof agent>[0] = {}, quota?: SubagentQuota) {
  const t = await open(
    root(),
    [tool("research_literature", { task: "what does the recent work say" }), ...responses, say("Relayed.")],
    () => [subagentTool(agent(over), quota ? { quota } : {})],
  );
  await (await ask(t, "Look it up")).settled;
  const line = toolResultLine(t);
  const isError = callsOf(t.file.rows()[1])[0]?.isError;
  await t.runtime.close(ctx);
  return { line, isError, requests: t.requests.length };
}

test("out of turns: a run that spent its cap is not a finding", async () => {
  const r = await failure(
    [tool("search_papers", { query: "a" }), tool("search_papers", { query: "b" })],
    { definition: { maxRounds: 2 } },
  );
  expect(r.isError).toBe(true);
  expect(r.line).toContain("all 2 of its turns");
  expect(r.line).toContain("not a finding");
});

test("no evidence: every library down is a failed tool call, never 'nothing was found'", async () => {
  const r = await failure([tool("search_papers", { query: "a" }), say("There is no recent work.")], {
    search: async () => {
      throw new Error("No literature database answered: OpenAlex (409 out of credit)");
    },
  });
  expect(r.isError).toBe(true);
  expect(r.line).toContain("409 out of credit");
  expect(r.line).not.toContain("no recent work");
});

test("no evidence: an answer written without consulting a library is not returned", async () => {
  const r = await failure([say("I know this one: sublinear.")]);
  expect(r.isError).toBe(true);
  expect(r.line).toContain("without calling any of its 3 tools");
  expect(r.line).not.toContain("sublinear");
});

test("out of budget: a spent pot stops the call before anything is sent", async () => {
  const r = await failure([], {}, createSubagentQuota(0));
  expect(r.isError).toBe(true);
  expect(r.line).toContain("Nothing was looked up");
  expect(r.requests).toBe(2);
});

test("out of context: a run whose first round cannot fit says so", async () => {
  const r = await failure([], { definition: { model: TINY } });
  expect(r.isError).toBe(true);
  expect(r.line).toContain("no longer left the model room to answer");
  expect(r.requests).toBe(2);
});

test("failed: a provider error is a failed run with its message, not an empty answer", async () => {
  const r = await failure([fauxAssistantMessage([], { stopReason: "error", errorMessage: "overloaded_error" })]);
  expect(r.isError).toBe(true);
  expect(r.line).toContain("overloaded_error");
});

test("refused: a run that ends without a brief says it wrote none", async () => {
  const r = await failure([tool("search_papers", { query: "a" }), say("")]);
  expect(r.isError).toBe(true);
  expect(r.line).toContain("without writing a brief");
});

test("the turn's pot is shared across calls and settles what a run did not spend", async () => {
  const quota = createSubagentQuota(10);
  const t = await open(
    root(),
    [
      tool("research_literature", { task: "first" }),
      tool("search_papers", { query: "a" }),
      say("Brief one."),
      say("Done."),
    ],
    () => [subagentTool(agent(), { quota })],
  );
  await (await ask(t, "Look it up")).settled;
  // Six reserved, two spent, four back in the pot.
  expect(quota.remaining()).toBe(8);
  await t.runtime.close(ctx);
});

// --- the parent's stop and a restart ---

test("stopping the reading turn aborts the child mid-search and leaves no live task", async () => {
  const searching = deferred();
  const t = await open(
    root(),
    [tool("research_literature", { task: "recent work" }), tool("search_papers", { query: "a" }), say("never")],
    () => [
      subagentTool(
        agent({
          search: async () => {
            searching.resolve();
            return new Promise<PaperSearchResult>(() => {});
          },
        }),
      ),
    ],
  );
  const turn = await ask(t, "Look it up");
  await searching.promise;
  const [kid] = await children(t.runtime);
  await stopTurn(t.runtime, turn.conversation, ctx);
  await turn.settled;
  const entries = (await t.runtime.storage.scanEntries({ conversationId: kid! }, 100, undefined, ctx)).items;
  expect(entries.some((e) => e.kind === "pi.tool-result")).toBe(true);
  expect((await t.runtime.harness.inspect(ctx)).tasks).toHaveLength(0);
  expect((await t.runtime.harness.inspect(ctx)).submissions).toHaveLength(0);
  expect(t.requests).toHaveLength(2);
  await t.runtime.close(ctx);
});

test("a restart in the middle of the child's search finds the same child and finishes the turn once", async () => {
  const dir = root();
  const searching = deferred();
  let searches = 0;
  const hang = agent({
    search: async () => {
      searches++;
      searching.resolve();
      return new Promise<PaperSearchResult>(() => {});
    },
  });
  const first = await open(
    dir,
    [tool("research_literature", { task: "recent work" }), tool("search_papers", { query: "a" })],
    () => [subagentTool(hang)],
  );
  const killed = await ask(first, "Look it up");
  killed.settled.catch(() => {});
  await searching.promise;
  const [kid] = await children(first.runtime);
  // Closing lets go of the hanging search (it waits on the call's context) and
  // leaves the parent's call and the child's run unsettled in the database.
  await first.runtime.close(ctx);
  expect(searches).toBe(1);

  const second = await open(dir, [say("Brief after the restart."), say("Here is what came back.")], () => [
    subagentTool(agent({ search: async () => (searches++, FOUND) })),
  ]);
  const recovered = await recoverBeforeResume(second.runtime, ctx);
  expect(recovered.map((r) => r.outcome)).toEqual(["in-tool"]);
  const deadline = Date.now() + 5000;
  while (second.file.rows().length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));

  // The safe search ran again inside the same child; the parent's call found it.
  expect(searches).toBe(2);
  expect(await children(second.runtime)).toEqual([kid!]);
  expect(second.requests[0]!.lines).toEqual([
    "user:recent work",
    "assistant:[search_papers]",
    expect.stringContaining("toolResult:"),
  ]);
  expect(second.requests[1]!.lines.join("\n")).toContain("Brief after the restart.");
  const rows = second.file.rows();
  expect(rows.map((r) => r.text)).toEqual(["Look it up", "Here is what came back."]);
  await second.runtime.close(ctx);
});
