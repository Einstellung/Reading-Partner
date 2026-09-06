// The pi-Agent entry (src/legion/execute/agent-turn.ts), driven by a scripted
// stream so no provider, no credentials and no network are involved. What is
// checked here is everything the Agent is NOT trusted with: the evidence rule,
// the brief cap, the turn gate, the mid-run budget reduction, and the two
// queues that make "the AI is talking and the user cuts in" possible.

import { expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  Type,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import type { AgentTool, StreamFn } from "../../../src/ai/agent";
import type { ProviderId } from "../../../src/ai/providers";
import { estimateTextTokens, OUTPUT_FLOOR, PI_CONTEXT_SAFETY_TOKENS } from "../../../src/budget";
import { startAgentTurn, type AgentTurn, type AgentTurnRequest } from "../../../src/legion/execute/agent-turn";
import { createSubagentLedger } from "../../../src/legion/subagent/ledger";

type ToolReq = { name: string; args: Record<string, any>; id?: string };
type Turn = { text?: string; calls?: ToolReq[]; error?: string };

function turnEvents(turn: Turn): AssistantMessageEvent[] {
  const events: AssistantMessageEvent[] = [];
  if (turn.text) {
    events.push({
      type: "text_delta",
      contentIndex: 0,
      delta: turn.text,
      partial: fauxAssistantMessage(turn.text),
    });
  }
  if (turn.error) {
    const message = fauxAssistantMessage("", { stopReason: "error", errorMessage: turn.error });
    events.push({ type: "error", reason: "error", error: message });
    return events;
  }
  const blocks = [
    ...(turn.text ? [fauxText(turn.text)] : []),
    ...(turn.calls ?? []).map((c) => fauxToolCall(c.name, c.args, { id: c.id })),
  ];
  const hasCalls = (turn.calls ?? []).length > 0;
  const message: AssistantMessage = fauxAssistantMessage(blocks.length ? blocks : "", {
    stopReason: hasCalls ? "toolUse" : "stop",
  });
  events.push({ type: "done", reason: hasCalls ? "toolUse" : "stop", message });
  return events;
}

// Replays `turns`, one per model round, recording the Context each round was
// handed — which is the context AFTER the budget transform, so a stubbed round
// shows up here. `hook` fires while the round's stream is still open, which is
// how a steer lands mid-turn rather than between turns.
function scriptStream(
  turns: Turn[],
  hook?: (round: number) => void,
): { fn: StreamFn; contexts: Context[]; rounds: () => number } {
  let round = 0;
  const contexts: Context[] = [];
  const fn: StreamFn = (_model, context) => {
    const i = round++;
    contexts.push(context);
    const stream = createAssistantMessageEventStream();
    const events = turnEvents(turns[i] ?? { text: "no scripted turn" });
    void (async () => {
      hook?.(i);
      for (const ev of events) {
        await Promise.resolve();
        stream.push(ev);
      }
      stream.end();
    })();
    return stream;
  };
  return { fn, contexts, rounds: () => round };
}

function sizedModel(contextWindow: number): Model<Api> {
  return { id: "m", name: "m", contextWindow, maxTokens: 64_000 } as unknown as Model<Api>;
}

const ROOMY = sizedModel(1_000_000);

function tool(name: string, run: () => string | Promise<string>): AgentTool {
  return {
    name,
    description: `the ${name} tool`,
    parameters: Type.Object({ value: Type.String() }),
    execute: async () => run(),
  };
}

function turnFor(
  stream: StreamFn,
  over: Partial<AgentTurnRequest> = {},
  model: Model<Api> = ROOMY,
): AgentTurn {
  return startAgentTurn({
    name: "probe",
    systemPrompt: "Do the thing.",
    messages: [{ role: "user", text: "go" }],
    tools: [],
    model: { providerId: "anthropic" as ProviderId, modelId: "m" },
    resolve: async () => ({ model, stream }),
    ...over,
  });
}

const CALL = (id: string): ToolReq[] => [{ name: "look", args: { value: "a" }, id }];

test("a run whose tool worked answers, and the brief is the model's own text", async () => {
  const script = scriptStream([{ calls: CALL("c1") }, { text: "Kepler, 1609, in the Astronomia nova." }]);
  const brief = await turnFor(script.fn, { tools: [tool("look", () => "the passage")] }).result;

  expect(brief.outcome).toBe("answered");
  expect(brief.usable).toBe(true);
  expect(brief.brief).toContain("Astronomia nova");
  expect(brief.toolCalls).toBe(1);
  expect(brief.toolSuccesses).toBe(1);
  expect(brief.rounds).toBe(2);
});

test("a fluent answer with every tool broken behind it is not returned", async () => {
  const script = scriptStream([
    { calls: CALL("c1") },
    { text: "Kepler said it in 1609, as everyone knows." },
  ]);
  const brief = await turnFor(script.fn, {
    tools: [
      tool("look", () => {
        throw new Error("no network");
      }),
    ],
  }).result;

  expect(brief.outcome).toBe("no-evidence");
  expect(brief.usable).toBe(false);
  expect(brief.brief).not.toContain("Kepler");
  expect(brief.brief).toContain("not a finding");
  expect(brief.toolFailures).toEqual([{ name: "look", reason: "no network", count: 1 }]);
});

test("evidence: \"optional\" lets a tool-less run answer", async () => {
  const script = scriptStream([{ text: "nothing worth recording" }]);
  const brief = await turnFor(script.fn, { evidence: "optional" }).result;

  expect(brief.outcome).toBe("answered");
  expect(brief.brief).toBe("nothing worth recording");
});

test("a brief longer than its token cap is cut, and says so", async () => {
  const long = "finding ".repeat(400);
  const script = scriptStream([{ text: long }]);
  const brief = await turnFor(script.fn, { evidence: "optional", briefTokenCap: 40 }).result;

  expect(brief.clipped).toBe(true);
  expect(brief.brief).toContain("cut off");
  expect(brief.brief.length).toBeLessThan(long.length);
});

test("the turn cap stops a run that keeps calling tools without answering", async () => {
  const script = scriptStream([{ calls: CALL("c1") }, { calls: CALL("c2") }, { calls: CALL("c3") }]);
  const brief = await turnFor(script.fn, {
    maxRounds: 2,
    tools: [tool("look", () => "still looking")],
  }).result;

  expect(script.rounds()).toBe(2);
  expect(brief.outcome).toBe("out-of-turns");
  expect(brief.usable).toBe(false);
  expect(brief.rounds).toBe(2);
  expect(brief.roundsAllowed).toBe(2);
});

test("a ledger with nothing left sends no request at all", async () => {
  const script = scriptStream([{ text: "never asked" }]);
  const ledger = createSubagentLedger(0);
  const brief = await turnFor(script.fn, { ledger, evidence: "optional" }).result;

  expect(script.rounds()).toBe(0);
  expect(brief.outcome).toBe("out-of-budget");
  expect(brief.roundsAllowed).toBe(0);
});

test("the ledger grants fewer turns than the run asked for, and gets the rest back", async () => {
  const script = scriptStream([{ calls: CALL("c1") }, { calls: CALL("c2") }]);
  const ledger = createSubagentLedger(1);
  const brief = await turnFor(script.fn, {
    maxRounds: 6,
    ledger,
    tools: [tool("look", () => "still looking")],
  }).result;

  expect(brief.roundsAllowed).toBe(1);
  expect(brief.outcome).toBe("out-of-turns");
  expect(ledger.remaining()).toBe(0);
});

// The mid-run reduction. Eight rounds of a large tool result put the ninth over
// the window; stubbing all but the last four brings it back under, and the
// round that goes out carries the stubs in place of the bodies.
test("a round that outgrew the window gives up its earliest tool results", async () => {
  const payload = "the passage ".repeat(700);
  const perResult = estimateTextTokens(payload);
  const model = sizedModel(PI_CONTEXT_SAFETY_TOKENS + OUTPUT_FLOOR.chat + perResult * 6);
  const script = scriptStream([
    ...Array.from({ length: 8 }, (_, i) => ({ calls: CALL(`c${i}`) })),
    { text: "here is what I found" },
  ]);

  const brief = await turnFor(
    script.fn,
    { maxRounds: 9, tools: [tool("look", () => payload)] },
    model,
  ).result;

  expect(brief.outcome).toBe("answered");
  const sent = script.contexts[script.contexts.length - 1].messages;
  const stubs = sent.filter(
    (m) => m.role === "toolResult" && JSON.stringify(m.content).includes("dropped to fit"),
  );
  expect(stubs.length).toBeGreaterThan(0);
  // Only the earliest go: the model keeps what it just fetched.
  const whole = sent.filter(
    (m) => m.role === "toolResult" && JSON.stringify(m.content).includes("the passage the passage"),
  );
  expect(whole.length).toBe(4);
});

test("a round that does not fit even after the reduction stops the run", async () => {
  const payload = "the passage ".repeat(2000);
  const model = sizedModel(PI_CONTEXT_SAFETY_TOKENS + OUTPUT_FLOOR.chat + 200);
  const script = scriptStream([{ calls: CALL("c1") }, { text: "unreachable" }]);

  const brief = await turnFor(script.fn, { tools: [tool("look", () => payload)] }, model).result;

  expect(script.rounds()).toBe(1);
  expect(brief.outcome).toBe("out-of-context");
  expect(brief.usable).toBe(false);
});

test("steer() cuts into the run and reaches the next round's context", async () => {
  let turn: AgentTurn | undefined;
  const script = scriptStream([{ calls: CALL("c1") }, { text: "stopping there" }], (round) => {
    if (round === 0) turn!.steer("actually, stop");
  });
  turn = turnFor(script.fn, { tools: [tool("look", () => "the passage")] });
  await turn.result;

  expect(script.rounds()).toBe(2);
  const second = script.contexts[1].messages;
  expect(JSON.stringify(second)).toContain("actually, stop");
  // After the tool result of the round it interrupted, so the model sees the
  // work it already did.
  expect(second[second.length - 1].role).toBe("user");
  expect(second[second.length - 2].role).toBe("toolResult");
});

test("followUp() waits until the run would otherwise stop", async () => {
  let turn: AgentTurn | undefined;
  const script = scriptStream(
    [{ calls: CALL("c1") }, { text: "finished the first job" }, { text: "and the follow-up" }],
    (round) => {
      if (round === 0) turn!.followUp("also summarize");
    },
  );
  turn = turnFor(script.fn, { tools: [tool("look", () => "the passage")], maxRounds: 4 });
  await turn.result;

  expect(script.rounds()).toBe(3);
  // Not in round 1 — that round is the tool-result continuation, which is the
  // run finishing what it started.
  expect(JSON.stringify(script.contexts[1].messages)).not.toContain("also summarize");
  expect(JSON.stringify(script.contexts[2].messages)).toContain("also summarize");
});

test("the queues default to one-at-a-time, so one interruption is answered before the next", async () => {
  let turn: AgentTurn | undefined;
  const script = scriptStream(
    [{ calls: CALL("c1") }, { text: "one" }, { text: "two" }],
    (round) => {
      if (round !== 0) return;
      turn!.steer("first");
      turn!.steer("second");
    },
  );
  turn = turnFor(script.fn, { tools: [tool("look", () => "the passage")], maxRounds: 4 });
  await turn.result;

  const second = JSON.stringify(script.contexts[1].messages);
  expect(second).toContain("first");
  expect(second).not.toContain("second");
});
