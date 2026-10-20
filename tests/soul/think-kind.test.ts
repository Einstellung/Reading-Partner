// The think kind and how its answer comes back (docs/companion/136 delegate,
// 回来, 落盒, 文本检查点): src/soul/think/kind.ts, the verbatim branch of
// src/soul/bell.ts, and the briefing conversation's appender
// (src/reading/turn/info-bell.ts).
// Run: scripts/t.sh tests/soul/think-kind.test.ts

import { Type } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tierForKind } from "../../src/ai/model-tier";
import { createBoxStore } from "../../src/box";
import { createBellStore } from "../../src/legion/bell";
import type { AgentTool } from "../../src/legion/durable/contract";
import { createRunStore } from "../../src/legion/run/store";
import type { Run } from "../../src/legion/run";
import { delegableWorkerKinds, workerFor, type WorkerContext } from "../../src/legion/runner/worker";
import { buildDelegateTools } from "../../src/soul/delegate";
import { withoutBriefNote, type SubagentTurnRequest } from "../../src/legion/subagent";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { rebuildThreadStoreForTests, type ThreadMessage } from "../../src/platform/app/threads";
import {
  answerBell,
  declareVerbatim,
  isVerbatim,
  onVerbatimLanding,
  registerReplyAppend,
  registerTurnDelivery,
  type ReplyAppend,
  type VerbatimLanding,
} from "../../src/soul";
import {
  THINK_KIND,
  THINK_PROMPT,
  callKinds,
  registerThinkDesk,
  registerThinkWorker,
  thinkWorker,
} from "../../src/soul/think";
import { appendInfoReply } from "../../src/reading/turn/info-bell";
import { infoBookId } from "../../src/info/briefer/call";
import { briefingThreadId } from "../../src/info/briefer/anchors";
import { installAppData } from "../support/appdata-fake";
import { mapDisk } from "../support/map-disk";

const DATE = "2026-10-14";
const PLACE = { place: "briefing" as const, date: DATE };
const settings: Settings = { ...DEFAULT_SETTINGS, defaultProviderId: "anthropic", defaultModelId: "claude-sonnet-4-5" };

const undo: (() => void)[] = [];
beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
  for (const name of ["door", "book", "briefing", "meals"] as const) {
    registerTurnDelivery(name, async () => null)();
    registerReplyAppend(name, async () => false)();
  }
});
afterEach(() => undo.splice(0).forEach((off) => off()));

function tool(name: string, effect: "read" | "write"): AgentTool {
  return { name, description: name, parameters: Type.Object({}), label: () => name, effect, execute: async () => "ok" };
}

test("think runs on the talk tier", () => {
  expect(tierForKind("think")).toBe("talk");
});

test("think registers as a local agent kind whose output is delivered as it is", () => {
  undo.push(registerThinkWorker());
  const reg = workerFor(THINK_KIND)!;
  expect(reg).toMatchObject({ kind: THINK_KIND, tier: "local", agent: true, delegable: false });
  expect(isVerbatim(THINK_KIND)).toBe(true);
});

test("only a voice call can hand work to think: an ordinary soul turn's delegate does not offer it", async () => {
  undo.push(registerThinkWorker());
  expect(delegableWorkerKinds()).not.toContain(THINK_KIND);
  const [ordinary] = buildDelegateTools({ writeBrief: async () => "legion/briefs/b.md", delegate: async () => ({ ok: false, reason: "x" }) });
  expect(JSON.stringify(ordinary!.parameters)).not.toContain(THINK_KIND);
  await expect(ordinary!.execute({ kind: THINK_KIND, task: "q" })).rejects.toThrow(`Nothing here runs the kind "${THINK_KIND}"`);
  // A call's catalogue has it, first, with the ordinary kinds after it.
  expect(callKinds()[0]).toBe(THINK_KIND);
  expect(callKinds().slice(1)).toEqual(delegableWorkerKinds());
});

test("a think run gets the reads of the desk it is delivered to, the talk model, and writes its answer as the output", async () => {
  undo.push(registerThinkDesk("briefing", async () => [tool("read_page", "read"), tool("add_source", "write")]));
  let seen: SubagentTurnRequest | null = null;
  const outputs = new Map<string, string>();
  const model = { providerId: "anthropic" as const, modelId: "claude-sonnet-4-5", reasoning: "medium" as const };
  const run = thinkWorker({
    model: async () => model,
    readBrief: async () => "Why did the yen fall?",
    writeOutput: async (runId, text) => {
      outputs.set(runId, text);
      return `legion/outputs/${runId}.md`;
    },
    // No lookup at all: reasoning is enough for a think run.
    turn: async (request) => {
      seen = request;
      return { kind: "answer", text: "Rates did it. The gap widened." };
    },
  });
  const ctx = {
    run: { id: "r-1", kind: THINK_KIND, deliverTo: JSON.stringify(PLACE) } as unknown as Run,
    report: async () => {},
    reportTool: async () => {},
    delegate: async () => ({ ok: false as const, reason: "no" }),
  } satisfies WorkerContext;
  const outcome = await run("legion/briefs/b-1.md", ctx).done;
  expect(outcome).toMatchObject({ output: "legion/outputs/r-1.md" });
  expect(outputs.get("r-1")).toBe("Rates did it. The gap widened.");
  expect(seen!.tools.map((t) => t.name)).toEqual(["read_page"]);
  expect(seen!.model).toEqual(model);
  expect(seen!.systemPrompt).toBe(THINK_PROMPT);
  expect(seen!.task).toBe("Why did the yen fall?");
});

test("a place with no desk registered gives a think run no tools", async () => {
  let names: string[] = ["unset"];
  const run = thinkWorker({
    model: async () => ({ providerId: "anthropic", modelId: "m" }),
    readBrief: async () => "q",
    writeOutput: async (id) => `legion/outputs/${id}.md`,
    turn: async (request) => {
      names = request.tools.map((t) => t.name);
      return { kind: "answer", text: "A." };
    },
  });
  const ctx = {
    // The meals conversation: no domain registers a think desk there (the door has one, reading/turn/door-think.ts).
    run: { id: "r-2", kind: THINK_KIND, deliverTo: JSON.stringify({ place: "meals" }) } as unknown as Run,
    report: async () => {},
    reportTool: async () => {},
    delegate: async () => ({ ok: false as const, reason: "no" }),
  } satisfies WorkerContext;
  await run("b", ctx).done;
  expect(names).toEqual([]);
});

function scene() {
  const bells = createBellStore(mapDisk());
  const runs = createRunStore(mapDisk());
  const box = createBoxStore(mapDisk());
  const appended: ReplyAppend[] = [];
  const turns: unknown[] = [];
  const landings: VerbatimLanding[] = [];
  undo.push(declareVerbatim(THINK_KIND));
  undo.push(registerReplyAppend("briefing", async (input) => (appended.push(input), true)));
  undo.push(registerTurnDelivery("briefing", async (input) => (turns.push(input), { status: "answered", reply: "x", watching: true })));
  undo.push(registerTurnDelivery("door", async (input) => (turns.push(input), { status: "answered", reply: "x", watching: false })));
  undo.push(onVerbatimLanding((l) => landings.push(l)));
  const OUTPUT = "Rates did it. The gap between the two widened, and the yen went with it.";
  const readFile = async (path: string) => {
    if (path === "legion/outputs/r-1.md") return OUTPUT;
    if (path === "legion/outputs/r-noted.md") {
      return `${OUTPUT}\n\nSub-agent note: 1 of its 2 tool calls failed (web_search: timeout), so this may be incomplete.`;
    }
    if (path === "legion/briefs/b-1.md") return "Why did the yen fall?";
    throw new Error(`no file ${path}`);
  };
  const answer = () => answerBell({ settings, bells, runs, box, readFile, now: () => 1000 });
  return { bells, runs, box, appended, turns, landings, OUTPUT, answer };
}

test("a think run that came back is appended and boxed as it is, with no turn, even with the reader looking", async () => {
  const s = scene();
  await s.bells.ring("run-done", {
    runId: "r-1",
    kind: THINK_KIND,
    brief: "legion/briefs/b-1.md",
    output: "legion/outputs/r-1.md",
    deliverTo: JSON.stringify(PLACE),
    delegator: { kind: "soul" },
  });
  expect(await s.answer()).toBe(1);
  expect(s.turns).toEqual([]);
  expect(s.appended).toEqual([{ origin: PLACE, text: s.OUTPUT, runId: "r-1", at: 1000 }]);
  const items = await s.box.list();
  expect(items).toHaveLength(1);
  // The three copies are one text: the output file, the item's body, the reply.
  expect(items[0]).toMatchObject({
    boxId: "r-1",
    runId: "r-1",
    source: "run",
    kind: THINK_KIND,
    body: s.OUTPUT,
    cover: "Rates did it.",
    origin: PLACE,
    needsDecision: false,
    state: "in-box",
  });
  expect(s.landings).toEqual([
    { status: "done", runId: "r-1", kind: THINK_KIND, text: s.OUTPUT, cover: "Rates did it.", boxItemId: items[0]!.id },
  ]);
  expect(await s.bells.read()).toEqual([]);
});

test("the runner's note on failed lookups is not delivered: not in the conversation, not in the box", async () => {
  const s = scene();
  await s.bells.ring("run-done", {
    runId: "r-1",
    kind: THINK_KIND,
    brief: "legion/briefs/b-1.md",
    output: "legion/outputs/r-noted.md",
    deliverTo: JSON.stringify(PLACE),
    delegator: { kind: "soul" },
  });
  expect(await s.answer()).toBe(1);
  expect(s.appended[0]!.text).toBe(s.OUTPUT);
  expect((await s.box.list())[0]!.body).toBe(s.OUTPUT);
  expect(s.landings[0]).toMatchObject({ status: "done", text: s.OUTPUT });
});

test("withoutBriefNote takes off only the runner's note on the end", () => {
  expect(withoutBriefNote("A.\n\nSub-agent note: the brief was cut off.")).toBe("A.");
  expect(withoutBriefNote("A.\n\nB.")).toBe("A.\n\nB.");
  expect(withoutBriefNote("Sub-agent note: alone")).toBe("Sub-agent note: alone");
});

test("a think run that failed leaves one item to decide about and nothing in the conversation", async () => {
  const s = scene();
  await s.bells.ring("run-failed", {
    runId: "r-1",
    kind: THINK_KIND,
    reason: "No default AI provider configured.",
    deliverTo: JSON.stringify(PLACE),
    delegator: { kind: "soul" },
  });
  expect(await s.answer()).toBe(1);
  expect(s.turns).toEqual([]);
  expect(s.appended).toEqual([]);
  const items = await s.box.list();
  expect(items[0]).toMatchObject({ needsDecision: true, cover: "No default AI provider configured.", origin: PLACE });
  expect(s.landings[0]).toMatchObject({ status: "failed", reason: "No default AI provider configured." });
});

test("a conversation that will not take the reply leaves the bell queued and nothing boxed", async () => {
  const s = scene();
  undo.push(
    registerReplyAppend("briefing", async () => {
      throw new Error("disk full");
    }),
  );
  await s.bells.ring("run-done", {
    runId: "r-1",
    kind: THINK_KIND,
    brief: "legion/briefs/b-1.md",
    output: "legion/outputs/r-1.md",
    deliverTo: JSON.stringify(PLACE),
    delegator: { kind: "soul" },
  });
  expect(await s.answer()).toBe(0);
  expect(await s.box.list()).toEqual([]);
  expect(await s.bells.read()).toHaveLength(1);
  expect(s.landings).toEqual([]);
});

test("a kind not declared verbatim is still answered with a turn", async () => {
  const s = scene();
  await s.bells.ring("run-done", {
    runId: "r-1",
    kind: "research-literature",
    brief: "legion/briefs/b-1.md",
    output: "legion/outputs/r-1.md",
    deliverTo: JSON.stringify(PLACE),
    delegator: { kind: "soul" },
  });
  await s.answer();
  expect(s.turns).toHaveLength(1);
  expect(s.appended).toEqual([]);
});

test("the briefing appender writes the soul's reply into the day's briefing thread, stamped with the run", async () => {
  const written: { key: string; threadId: string; message: ThreadMessage }[] = [];
  const opened: string[] = [];
  const ok = await appendInfoReply(
    { origin: PLACE, text: "Rates did it.", runId: "r-1", at: 1000 },
    {
      openThread: async (key, threadId) => {
        opened.push(`${key}/${threadId}`);
      },
      append: (key, threadId, message) => written.push({ key, threadId, message }),
      flush: async () => {},
    },
  );
  expect(ok).toBe(true);
  expect(opened).toEqual([`${infoBookId(DATE)}/${briefingThreadId(DATE)}`]);
  expect(written[0]).toMatchObject({
    key: infoBookId(DATE),
    threadId: briefingThreadId(DATE),
    message: { role: "ai", text: "Rates did it.", ts: 1000, origin: { runId: "r-1" } },
  });
  expect(await appendInfoReply({ origin: { place: "door", date: DATE }, text: "x", runId: "r", at: 1 })).toBe(false);
});
