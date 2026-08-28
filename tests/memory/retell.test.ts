// Retell distillation (src/memory/observations/retell.ts): the pass that runs when
// the reader leaves a retell. Same harness as tests/memory/distill.test.ts —
// the sub-agent turn is the real agent loop over a scripted stream, so the real
// observation tools and the real failure mapping run against a fake fs with no
// provider, network or token spend. Run: bun test.

import { expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { runAgentLoop, type StreamFn } from "../../src/ai/agent";
import { createTurnSettler } from "../../src/ai/subagent/turn";
import type { SubagentTurnFn, SubagentTurnRequest } from "../../src/ai/subagent/types";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import { runDistillPass } from "../../src/memory/observations/distill";
import {
  buildRetellDistillSystemPrompt,
  buildRetellDistillUserMessage,
  runRetellDistillPass,
  selectNewMessages,
  type RetellDistillInput,
  type RetellPassInput,
} from "../../src/memory/observations/retell";
import { ObservationFileStore } from "../../src/memory/observations/store";
import { JULY_17, JULY_20, makeFakeFs } from "./fakefs";

type ToolReq = { name: string; args: Record<string, any>; id: string };
type Turn = { text?: string; calls?: ToolReq[] } | { error: string };

function turnEvents(turn: Turn): AssistantMessageEvent[] {
  if ("error" in turn) {
    const errMsg = fauxAssistantMessage("", { stopReason: "error", errorMessage: turn.error });
    return [{ type: "error", reason: "error", error: errMsg }];
  }
  const blocks = [
    ...(turn.text ? [fauxText(turn.text)] : []),
    ...(turn.calls ?? []).map((c) => fauxToolCall(c.name, c.args, { id: c.id })),
  ];
  const hasCalls = (turn.calls ?? []).length > 0;
  const message: AssistantMessage = fauxAssistantMessage(blocks.length ? blocks : "", {
    stopReason: hasCalls ? "toolUse" : "stop",
  });
  return [{ type: "done", reason: hasCalls ? "toolUse" : "stop", message }];
}

// A SubagentTurnFn over the real loop, recording what each run was asked for.
function scriptedRunner(turns: Turn[]) {
  const requests: SubagentTurnRequest[] = [];
  let round = 0;
  const stream: StreamFn = () => {
    const events = turnEvents(turns[round++] ?? { text: "done" });
    const s = createAssistantMessageEventStream();
    void (async () => {
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
  return { run, requests };
}

function makeStore() {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore("t", fs, () => JULY_17);
  return { store, adapter: new FileObservationAdapter(store) };
}

function passInput(overrides: Partial<RetellPassInput> = {}): RetellPassInput {
  return {
    topicName: "minds",
    retellName: "A Brief History of Intelligence",
    materials: ["A Brief History of Intelligence"],
    threadId: "retell-1",
    messages: [
      { role: "ai", text: "Chapter 22. What is the argument resting on?", ts: 100 },
      { role: "user", text: "he gets there from the lesion studies", ts: 200 },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<RetellDistillInput> = {}): RetellDistillInput {
  return {
    topicName: "minds",
    retellName: "A Brief History of Intelligence",
    materials: ["A Brief History of Intelligence", "Surfing Uncertainty"],
    threadId: "retell-1",
    messages: [
      { role: "ai", text: "What is chapter 22 resting on?", ts: 100 },
      { role: "user", text: "the lesion studies", ts: 200 },
    ],
    earlier: 0,
    indexText: "",
    dates: { first: "2026-07-17", last: "2026-07-17" },
    ...overrides,
  };
}

// --- the message cursor ---

test("selectNewMessages drops empty rows and takes only what is past the cursor", () => {
  const messages = [
    { role: "ai" as const, text: "first question", ts: 1 },
    { role: "ai" as const, text: "", ts: 2 }, // a decision card row
    { role: "user" as const, text: "my answer", ts: 3 },
    { role: "ai" as const, text: "next question", ts: 4 },
  ];
  expect(selectNewMessages(messages, 0)).toEqual({
    fresh: [messages[0], messages[2], messages[3]],
    total: 3,
  });
  expect(selectNewMessages(messages, 2)).toEqual({ fresh: [messages[3]], total: 3 });
  // A cursor past the end (a message file that shrank) takes nothing rather than
  // throwing the whole transcript at the model again.
  expect(selectNewMessages(messages, 9)).toEqual({ fresh: [], total: 3 });
});

// --- the pass ---

test("a finished pass writes observations and stores the message cursor", async () => {
  const { store, adapter } = makeStore();
  const result = await runRetellDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              type: "can-explain",
              summary: "Can give chapter 22 of A Brief History of Intelligence",
              body: "2026-07-17 gave the lesion-study argument himself in the retell.",
              messageIds: ["retell-1:200"],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  });

  expect(result).toMatchObject({ ran: true, ok: true, created: 1, distilled: 2 });
  expect((await store.list())[0].type).toBe("can-explain");
  expect(await store.getMeta()).toEqual({
    lastDistilledAt: JULY_17,
    lastAnnotationDistillAt: null,
    distilledMessages: { "retell-1": 2 },
  });
});

test("re-entering and leaving with nothing new distils nothing", async () => {
  const { store, adapter } = makeStore();
  await runRetellDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });
  const runner = scriptedRunner([{ text: "done" }]);
  const second = await runRetellDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_20,
    run: runner.run,
  });

  expect(second).toEqual({ ran: false, skipped: "no-new-messages" });
  expect(runner.requests.length).toBe(0); // the model was never asked
});

test("a second pass sends only the new stretch, and says what came before it", async () => {
  const { store, adapter } = makeStore();
  await runRetellDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });

  const runner = scriptedRunner([{ text: "done" }]);
  const second = await runRetellDistillPass(
    passInput({
      messages: [
        ...passInput().messages,
        { role: "ai", text: "And chapter 23?", ts: 300 },
        { role: "user", text: "that one I can only give the conclusion of", ts: 400 },
      ],
    }),
    { store, adapter, now: () => JULY_20, run: runner.run },
  );

  expect(second).toMatchObject({ ran: true, ok: true, distilled: 2 });
  const task = runner.requests[0].task;
  expect(task).toContain("[retell-1:400] reader: that one I can only give the conclusion of");
  expect(task).not.toContain("lesion studies"); // already folded in
  expect(task).toContain("first 2 message(s)");
  expect((await store.getMeta()).distilledMessages).toEqual({ "retell-1": 4 });
});

test("a stretch the reader said nothing in is not distilled", async () => {
  const { store, adapter } = makeStore();
  const runner = scriptedRunner([{ text: "done" }]);
  const result = await runRetellDistillPass(
    passInput({ messages: [{ role: "ai", text: "Which chapter shall we take?", ts: 100 }] }),
    { store, adapter, now: () => JULY_17, run: runner.run },
  );

  expect(result).toEqual({ ran: false, skipped: "reader-silent" });
  expect(runner.requests.length).toBe(0);
  // Nothing was folded in, so the next exit sees this message again.
  expect((await store.getMeta()).distilledMessages).toBeUndefined();
});

test("a pass that did not finish leaves the cursor where it was", async () => {
  const { store, adapter } = makeStore();
  const result = await runRetellDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ error: "connection reset" }]),
  });

  expect(result).toMatchObject({ ran: true, ok: false, outcome: "failed" });
  // The next exit redoes this stretch; the alternative is a retell that is
  // never observed and nothing left to say so.
  expect((await store.getMeta()).distilledMessages).toBeUndefined();
});

test("the two passes do not overwrite each other's bookkeeping in meta.json", async () => {
  const { store, adapter } = makeStore();
  await runRetellDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });
  // A reading conversation on the same topic hangs up afterwards.
  await runDistillPass(
    {
      topicName: "minds",
      bookId: "book-1",
      bookName: "history.pdf",
      threadId: "thread-9",
      annotationId: "ann-1",
      page: 3,
      markedText: "",
      messages: [{ role: "user", text: "why?", ts: 10 }],
      annotations: [{ id: "a1", page: 3, text: "prediction", createdAt: 700 }],
    },
    { store, adapter, now: () => JULY_20, ...scriptedRunner([{ text: "done" }]) },
  );

  expect(await store.getMeta()).toEqual({
    lastDistilledAt: JULY_20,
    lastAnnotationDistillAt: null,
    // The retell's cursor survived the reading pass, and vice versa.
    distilledMessages: { "retell-1": 2, "thread-9": 1 },
    distilledMarks: { "book-1": 700 },
  });
});

// --- the prompt ---

test("the system prompt leads with reconciliation against the current index", () => {
  const prompt = buildRetellDistillSystemPrompt(
    input({
      indexText:
        "- [stuck-point] Stuck on how active inference relates to volition (updated 2026-07-01, id m-11111111)",
    }),
  );
  // The index is carried whole, every pass: the cursor bounds the input, never
  // what may be rewritten.
  expect(prompt).toContain("id m-11111111");
  expect(prompt).toContain("Start by reconciling, not by writing.");
  expect(prompt).toContain("Crossing types is");
  expect(prompt).toContain("Never leave two observations standing for the two ends of one story");
  expect(prompt).toContain("timeline");
  expect(prompt).toContain("retell below happened on 2026-07-17");
});

test("the system prompt writes down the examiner's bias and the three things to keep", () => {
  const prompt = buildRetellDistillSystemPrompt(input());
  expect(prompt).toContain("You were the examiner here");
  expect(prompt).toContain("cannot-explain however warm the");
  expect(prompt).toContain("can-explain / cannot-explain");
  expect(prompt).toContain("Where the reader corrected you");
  expect(prompt).toContain("holds across books");
  // And what it must not turn into.
  expect(prompt).toContain("What the retell settled on keeping");
  expect(prompt).toContain("never a retelling");
});

test("the user message carries the retell, its materials, and the message ids", () => {
  const msg = buildRetellDistillUserMessage(input());
  expect(msg).toContain("Topic: minds");
  expect(msg).toContain("Retell: A Brief History of Intelligence");
  expect(msg).toContain("Materials: A Brief History of Intelligence, Surfing Uncertainty");
  expect(msg).toContain("[retell-1:200] reader: the lesion studies");
  expect(msg).toContain("[retell-1:100] you: What is chapter 22 resting on?");
  // A first pass has nothing behind it to mention.
  expect(msg).not.toContain("earlier pass");
});
