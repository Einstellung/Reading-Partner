// Distillation flow tests (src/memory/observations/distill.ts) with a mocked AI turn: the
// sub-agent turn is backed by runAgentLoop over a scripted fake stream (same
// pattern as tests/ai/subagent.test.ts), so the real observation tools, the real
// honest-failure mapping and the real abort path run against the fake store with
// no provider, network, or token spend. Run: bun test.

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
import { StoppedError } from "../../src/ai/watchdog";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import {
  buildDistillAgent,
  buildDistillSystemPrompt,
  buildDistillUserMessage,
  formatSilentMarks,
  buildMarksDistillSystemPrompt,
  buildMarksDistillUserMessage,
  classifyDistillFailure,
  countNewReaderMessages,
  datingRule,
  distillCoverage,
  distillFailurePayload,
  distillWritePayload,
  evidenceDates,
  formatEvidenceSpan,
  runDistillPass,
  runDistillation,
  runMarksDistillPass,
  runMarksDistillation,
  selectSilentMarks,
  DISTILL_BRIEF_TOKENS,
  type DistillAnnotation,
  type DistillInput,
  type DistillMessage,
  type DistillPassInput,
} from "../../src/memory/observations/distill";
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

// A SubagentTurnFn backed by the real loop over a scripted model, recording what
// each run was asked for. `beforeRound` fires as each round is asked for
// (0-based), which is where a test cancelling an in-flight pass raises its signal.
function loopRunner(turns: Turn[], beforeRound?: (round: number) => void) {
  const requests: SubagentTurnRequest[] = [];
  let round = 0;
  const stream: StreamFn = () => {
    beforeRound?.(round);
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
  return { run, requests, streamed: () => round };
}

function scriptedRunner(turns: Turn[]): { run: SubagentTurnFn } {
  return { run: loopRunner(turns).run };
}

function makeInput(overrides: Partial<DistillInput> = {}): DistillInput {
  return {
    topicName: "attention",
    bookName: "survey.pdf",
    threadId: "thread-1",
    annotationId: "ann-1",
    page: 12,
    markedText: "the marked sentence",
    messages: [
      { role: "user", text: "why is this quadratic?", ts: 100 },
      { role: "ai", text: "because every token attends to every token", ts: 200 },
    ],
    indexText: "",
    dates: { first: "2026-07-17", last: "2026-07-17" },
    ...overrides,
  };
}

// A pass that wrote nothing, or wrote nothing the gate turned away.
const NO_RELATIONS = { new: 0, "predicted-by": 0, contradicts: 0, "same-as": 0 } as const;
const NO_REJECTIONS = {
  "bad-index": 0,
  "unresolved-anchor": 0,
  "unresolved-mention": 0,
} as const;

function makeStore() {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore("t", fs, () => JULY_17);
  return { store, adapter: new FileObservationAdapter(store) };
}

test("distillation creates observations through the real tools and counts them", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput(),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "stuck-point",
              summary: "Stuck on quadratic attention cost",
              body: "Asked on 2026-07-17 why attention is O(n^2).",
              annotationIds: ["ann-1"],
              // The model cites a transcript line, never an id it assembled.
              messageIndices: [1],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  );

  expect(result).toEqual({
    created: 1,
    updated: 0,
    deleted: 0,
    relations: { ...NO_RELATIONS, new: 1 },
    rejected: NO_REJECTIONS,
    ok: true,
    outcome: "answered",
  });
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].type).toBe("stuck-point");
  expect(entries[0].anchors).toEqual({ annotationIds: ["ann-1"], messageIds: ["thread-1:100"] });
  // The index carries it for the next conversation's snapshot.
  expect(await store.readIndexText()).toContain("Stuck on quadratic attention cost");
});

// End to end through the real agent loop: what the pass mounts, not what the
// tool can do in isolation (tests/memory/observation-tools.test.ts has that).
test("a pass refuses an anchorless create and stores the aside's own thread id", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput({
      // A unit transcript: the lesson thread with a pageless aside folded in.
      messages: [
        { role: "user", text: "what is a key?", ts: JULY_17, threadId: "thread-1" },
        { role: "user", text: "and a query?", ts: JULY_17 + 1000, threadId: "aside-2" },
      ],
    }),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "stuck-point",
              summary: "Stuck on the key/query split",
              body: "Asked on 2026-07-17.",
            },
          },
        ],
      },
      {
        calls: [
          {
            name: "observation_update",
            id: "c2",
            args: {
              action: "create",
              relation: "new",
              type: "stuck-point",
              summary: "Stuck on the key/query split",
              body: "Asked on 2026-07-17.",
              messageIndices: [2],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  );

  expect(result).toMatchObject({ created: 1, ok: true });
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  // The aside's own id, not the unit's: the unit is named for the parent.
  expect(entries[0].anchors.messageIds).toEqual([`aside-2:${JULY_17 + 1000}`]);
});

// The evolution the reader's own progress is: the old observation stays exactly
// as it was and a new one says what is true now, naming it by id (docs/48 — an
// observation's text is never rewritten). What was simply wrong is deleted.
test("distillation writes the evolution as a new observation and deletes what was wrong", async () => {
  const { store, adapter } = makeStore();
  const stuck = await adapter.retain({
    type: "stuck-point",
    summary: "Stuck on quadratic attention cost",
    body: "Asked on 2026-07-10 why attention is O(n^2).",
  });
  const wrong = await adapter.retain({
    type: "belief",
    summary: "Thinks softmax is optional",
    body: "Voiced on 2026-07-10.",
  });

  const result = await runDistillation(
    makeInput({ indexText: await store.readIndexText() }),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "understood-concept",
              summary: "Worked out why attention is quadratic",
              body: `Resolved on 2026-07-17 what ${stuck.id} was stuck on.`,
              messageIndices: [1],
            },
          },
          { name: "observation_update", id: "c2", args: { action: "delete", id: wrong.id } },
        ],
      },
      { text: "done" },
    ]),
  );

  expect(result).toEqual({
    created: 1,
    updated: 0,
    deleted: 1,
    relations: { ...NO_RELATIONS, new: 1 },
    rejected: NO_REJECTIONS,
    ok: true,
    outcome: "answered",
  });
  const entries = await store.list();
  expect(entries).toHaveLength(2);
  const before = entries.find((e) => e.id === stuck.id)!;
  expect(before.summary).toBe("Stuck on quadratic attention cost"); // untouched
  expect(before.type).toBe("stuck-point");
  const after = entries.find((e) => e.id !== stuck.id)!;
  expect(after.body).toContain(stuck.id); // the two are linked by the mention
});

// --- the relation a pass declares (docs/48) ---

const HELD = [
  {
    id: "s-1111111111111111",
    kind: "profile",
    text: "Wants the derivation, not the picture",
    lastSupported: "2026-08-30",
  },
  {
    id: "s-2222222222222222",
    kind: "concern",
    text: "Is watching what the residual stream carries",
    lastSupported: "2026-08-20",
  },
];

function edgeRecorder() {
  const edges: string[] = [];
  return {
    edges,
    statementEdges: {
      async addEvidence(id: string, observationIds: readonly string[]) {
        edges.push(`evidence ${id} ${observationIds.join(",")}`);
      },
      async addContradiction(id: string, observationId: string) {
        edges.push(`contradiction ${id} ${observationId}`);
      },
    },
  };
}

test("predicted-by hangs the new observation on the statement that row number named", async () => {
  const { store, adapter } = makeStore();
  const recorder = edgeRecorder();
  const result = await runDistillation(
    makeInput({ statements: HELD }),
    adapter,
    {
      ...scriptedRunner([
        {
          calls: [
            {
              name: "observation_update",
              id: "c1",
              args: {
                action: "create",
                relation: "predicted-by",
                statement: 2,
                type: "belief",
                summary: "Asked again what the residual stream carries",
                body: "Voiced on 2026-07-17.",
                messageIndices: [1],
              },
            },
          ],
        },
        { text: "done" },
      ]),
      statementEdges: recorder.statementEdges,
    },
  );
  const [entry] = await store.list();
  expect(recorder.edges).toEqual([`evidence s-2222222222222222 ${entry.id}`]);
  expect(result.relations).toEqual({ ...NO_RELATIONS, "predicted-by": 1 });
});

test("contradicts records the observation against that statement, and the text stays", async () => {
  const { store, adapter } = makeStore();
  const recorder = edgeRecorder();
  const result = await runDistillation(
    makeInput({ statements: HELD }),
    adapter,
    {
      ...scriptedRunner([
        {
          calls: [
            {
              name: "observation_update",
              id: "c1",
              args: {
                action: "create",
                relation: "contradicts",
                statement: 1,
                type: "correction",
                summary: "Asked for the picture and skipped the derivation",
                body: "On 2026-07-17.",
                messageIndices: [1],
              },
            },
          ],
        },
        { text: "done" },
      ]),
      statementEdges: recorder.statementEdges,
    },
  );
  const [entry] = await store.list();
  expect(recorder.edges).toEqual([`contradiction s-1111111111111111 ${entry.id}`]);
  expect(result.relations).toEqual({ ...NO_RELATIONS, contradicts: 1 });
});

test("same-as grows an observation's evidence and writes no second one", async () => {
  const { store, adapter } = makeStore();
  const stuck = await adapter.retain({
    type: "stuck-point",
    summary: "Stuck on quadratic attention cost",
    body: "Asked on 2026-07-10 why attention is O(n^2).",
    anchors: { annotationIds: ["ann-0"], messageIds: [] },
  });
  const result = await runDistillation(
    makeInput({ indexText: await store.readIndexText() }),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: { action: "same-as", observation: 1, messageIndices: [1, 2] },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result.relations).toEqual({ ...NO_RELATIONS, "same-as": 1 });
  expect(result.updated).toBe(1);
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].body).toBe(stuck.body);
  expect(entries[0].anchors).toEqual({
    annotationIds: ["ann-0"],
    messageIds: ["thread-1:100", "thread-1:200"],
  });
});

test("the gate refuses a mark this pass never printed, and counts it", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput(),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "belief",
              summary: "Suspects the survey overstates the result",
              body: "Voiced on 2026-07-17.",
              // ann-1 is the thread's own mark; ann-9 was never in front of it.
              annotationIds: ["ann-1", "ann-9"],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result.rejected).toEqual({ ...NO_REJECTIONS, "unresolved-anchor": 1 });
  expect(result.created).toBe(0);
  expect(await store.list()).toEqual([]);
});

test("the gate refuses a body naming an observation that is not there, and counts it", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput(),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "understood-concept",
              summary: "Worked out why attention is quadratic",
              body: "Resolved on 2026-07-17 what m-1234567812345678 was stuck on.",
              annotationIds: ["ann-1"],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result.rejected).toEqual({ ...NO_REJECTIONS, "unresolved-mention": 1 });
  expect(await store.list()).toEqual([]);
});

test("a no-op distillation (nothing worth keeping) writes nothing", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(makeInput(), adapter, scriptedRunner([{ text: "done" }]));
  // ok, with no tool call at all: the point of evidence "optional" (see below).
  expect(result).toEqual({
    created: 0,
    updated: 0,
    deleted: 0,
    relations: NO_RELATIONS,
    rejected: NO_REJECTIONS,
    ok: true,
    outcome: "answered",
  });
  expect(await store.list()).toEqual([]);
});

test("invalid tool args become a tool error the loop survives, not a write", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput(),
    adapter,
    scriptedRunner([
      // Missing body → the tool throws → fed back as a tool-result error.
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: { action: "create", relation: "new", type: "stuck-point", summary: "s" },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result).toEqual({
    created: 0,
    updated: 0,
    deleted: 0,
    relations: NO_RELATIONS,
    rejected: NO_REJECTIONS,
    ok: true,
    outcome: "answered",
  });
  expect(await store.list()).toEqual([]);
});

// --- the sub-agent definition ---

test("the distiller mounts tools but does not require evidence", () => {
  const definition = buildDistillAgent(makeInput(), []);
  // "required" (the default once tools are mounted) would turn every correct pass
  // over a thin conversation — the ones the prompt tells the model to make no tool
  // call in — into a failed pass, and the timestamps would never advance.
  expect(definition.evidence).toBe("optional");
  expect(definition.briefTokenCap).toBe(DISTILL_BRIEF_TOKENS);
  // The prompt the capability sends is the curation prompt, with the brief
  // contract appended by the runner.
  expect(definition.systemPrompt).toContain("never rewritten");
});

// --- a pass that does not finish ---

test("a failed call is a failed pass, with the writes it did make counted", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput(),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "belief",
              summary: "Suspects the survey overstates the result",
              body: "Voiced on 2026-07-17.",
              messageIndices: [1],
            },
          },
        ],
      },
      { error: "connection reset" },
    ]),
  );

  expect(result.ok).toBe(false);
  expect(result.outcome).toBe("failed");
  // Recorded honestly: the sentence names the sub-agent and says what happened,
  // instead of the pass being swallowed by a warn nobody can act on.
  expect(result.failure).toContain("observation_distiller");
  expect(result.failure).toContain("connection reset");
  // The write it managed before the call died is on disk, and counted.
  expect(result.created).toBe(1);
  expect(await store.list()).toHaveLength(1);
});

test("a pass that never writes a final message is not a finished pass", async () => {
  const { adapter } = makeStore();
  const result = await runDistillation(makeInput(), adapter, scriptedRunner([{ text: "" }]));
  expect(result.ok).toBe(false);
  expect(result.outcome).toBe("refused");
});

// --- the timestamp discipline (runDistillPass) ---

function passInput(overrides: Partial<DistillPassInput> = {}): DistillPassInput {
  return {
    topicName: "attention",
    bookId: "book-1",
    bookName: "survey.pdf",
    threadId: "thread-1",
    annotationId: "ann-1",
    page: 12,
    markedText: "the marked sentence",
    messages: [
      { role: "user", text: "why is this quadratic?", ts: 100 },
      { role: "ai", text: "because every token attends to every token", ts: 200 },
    ],
    annotations: [
      { id: "a1", page: 3, text: "softmax", createdAt: 700 },
      { id: "a2", page: 9, text: "kv cache", createdAt: 900 },
    ],
    ...overrides,
  };
}

test("a finished pass advances both cursors", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });

  expect(result).toMatchObject({ ran: true, ok: true });
  expect(await store.getMeta()).toEqual({
    lastDistilledAt: JULY_17,
    lastAnnotationDistillAt: null,
    distilledMessages: { "thread-1": 2 },
    distilledMarks: { "book-1": 900 }, // the newest mark this pass was shown
  });
});

test("a second pass over the same transcript does not run", async () => {
  const { store, adapter } = makeStore();
  await runDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });
  const runner = loopRunner([{ text: "done" }]);
  const again = await runDistillPass(passInput(), {
    store,
    adapter,
    run: runner.run,
    now: () => JULY_20,
  });

  expect(again).toEqual({ ran: false, skipped: "no-new-messages" });
  expect(runner.requests.length).toBe(0);
  // Cursors did not move on a pass that never ran.
  expect((await store.getMeta()).lastDistilledAt).toBe(JULY_17);
});

test("the cursor is on disk, so a restart does not re-distill", async () => {
  const { fs } = makeFakeFs();
  const first = new ObservationFileStore("t", fs, () => JULY_17);
  await runDistillPass(passInput(), {
    store: first,
    adapter: new FileObservationAdapter(first),
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });
  // A fresh store over the same files is what a relaunch has.
  const reopened = new ObservationFileStore("t", fs, () => JULY_20);
  const runner = loopRunner([{ text: "done" }]);
  const again = await runDistillPass(passInput(), {
    store: reopened,
    adapter: new FileObservationAdapter(reopened),
    run: runner.run,
    now: () => JULY_20,
  });

  expect(again).toEqual({ ran: false, skipped: "no-new-messages" });
  expect(runner.requests.length).toBe(0);
});

test("a new reader message after a pass is distilled again", async () => {
  const { store, adapter } = makeStore();
  await runDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });
  const longer = passInput({
    messages: [
      { role: "user", text: "why is this quadratic?", ts: 100 },
      { role: "ai", text: "because every token attends to every token", ts: 200 },
      { role: "user", text: "so what does flash attention change?", ts: 300 },
    ],
  });
  const again = await runDistillPass(longer, {
    store,
    adapter,
    now: () => JULY_20,
    ...scriptedRunner([{ text: "done" }]),
  });

  expect(again).toMatchObject({ ran: true, ok: true });
  expect((await store.getMeta()).distilledMessages).toEqual({ "thread-1": 3 });
});

test("a thread the reader never spoke in is not distilled", async () => {
  const { store, adapter } = makeStore();
  const runner = loopRunner([{ text: "done" }]);
  const result = await runDistillPass(
    passInput({ messages: [{ role: "ai", text: "here is the passage", ts: 100 }] }),
    { store, adapter, run: runner.run, now: () => JULY_17 },
  );

  expect(result).toEqual({ ran: false, skipped: "reader-silent" });
  expect(runner.requests.length).toBe(0);
});

test("minNewMessages holds the trim fallback back", async () => {
  const { store, adapter } = makeStore();
  const runner = loopRunner([{ text: "done" }]);
  const result = await runDistillPass(passInput({ minNewMessages: 20 }), {
    store,
    adapter,
    run: runner.run,
    now: () => JULY_17,
  });

  expect(result).toEqual({ ran: false, skipped: "no-new-messages" });
  expect(runner.requests.length).toBe(0);
});

// --- a transcript merged from several threads (docs/03: asides) ---
//
// A lesson and the aside pulled out of it are one pass, and the cursors it moves
// are one per thread over that thread's own messages. A single cursor over the
// merged list is a number whose meaning changes the moment one of the threads
// goes away, and both directions of that lose something.

const LESSON = [
  { role: "user" as const, text: "teach me chapter 3", ts: 100 },
  { role: "ai" as const, text: "chapter 3 is about attention", ts: 200 },
];
const SIDE = [
  { role: "user" as const, text: "what does routing mean there?", ts: 300 },
  { role: "ai" as const, text: "each head picks what to read", ts: 400 },
];

function foldedInput(overrides: Partial<DistillPassInput> = {}): DistillPassInput {
  return passInput({
    threadId: "lesson",
    annotationId: "",
    page: null,
    markedText: "",
    messages: [...LESSON, ...SIDE],
    parts: [
      { threadId: "lesson", messages: LESSON },
      { threadId: "aside", messages: SIDE },
    ],
    ...overrides,
  });
}

test("a folded pass moves a cursor per thread, each over its own messages", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillPass(foldedInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });

  expect(result).toMatchObject({ ran: true, ok: true });
  expect((await store.getMeta()).distilledMessages).toEqual({ lesson: 2, aside: 2 });
});

// The lesson goes on after the aside is deleted. A cursor stamped at the merged
// length would sit past the end of the lesson's own messages, and
// countNewReaderMessages clamps that to "nothing new" — so everything the reader
// asked afterwards would never be distilled, and never would be.
test("deleting a folded aside does not strand the lesson's cursor past its messages", async () => {
  const { store, adapter } = makeStore();
  await runDistillPass(foldedInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });

  const carriedOn = [
    ...LESSON,
    { role: "user" as const, text: "and what breaks without it?", ts: 500 },
    { role: "ai" as const, text: "the model reads positionally", ts: 600 },
  ];
  const again = await runDistillPass(
    passInput({ threadId: "lesson", annotationId: "", page: null, markedText: "", messages: carriedOn }),
    { store, adapter, now: () => JULY_20, ...scriptedRunner([{ text: "done" }]) },
  );

  expect(again).toMatchObject({ ran: true, ok: true });
  expect((await store.getMeta()).distilledMessages).toEqual({ lesson: 4, aside: 2 });
});

// The other direction: sync deletes the lesson elsewhere and the aside is left
// behind, so it becomes a unit of its own. Its own cursor was moved by the
// folded pass, so there is nothing left to distil and nothing is written twice.
test("an aside orphaned after a folded pass does not distil itself again", async () => {
  const { store, adapter } = makeStore();
  await runDistillPass(foldedInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });

  const runner = loopRunner([{ text: "done" }]);
  const alone = await runDistillPass(
    passInput({ threadId: "aside", annotationId: "", page: null, markedText: "", messages: SIDE }),
    { store, adapter, run: runner.run, now: () => JULY_20 },
  );

  expect(alone).toEqual({ ran: false, skipped: "no-new-messages" });
  expect(runner.requests.length).toBe(0);
});

test("a book's mark cursor is its own, so a sibling book's pass never buries it", async () => {
  const { store, adapter } = makeStore();
  await runDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ text: "done" }]),
  });
  // The other book of the same topic, marked earlier and never distilled.
  const other = await runMarksDistillPass(
    {
      topicName: "attention",
      bookId: "book-2",
      bookName: "primer.pdf",
      annotations: [{ id: "b1", page: 2, text: "positional encoding", createdAt: 500 }],
    },
    { store, adapter, now: () => JULY_20, ...scriptedRunner([{ text: "done" }]) },
  );

  expect(other).toMatchObject({ ran: true, ok: true });
  expect((await store.getMeta()).distilledMarks).toEqual({ "book-1": 900, "book-2": 500 });
});

test("a failed pass leaves both cursors where they were", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillPass(passInput(), {
    store,
    adapter,
    now: () => JULY_17,
    ...scriptedRunner([{ error: "connection reset" }]),
  });

  expect(result).toMatchObject({ ran: true, ok: false });
  // Nothing moved, so the next trigger distils this transcript and these marks
  // again — the alternative is a conversation that is never observed and
  // nothing left to say so.
  expect(await store.getMeta()).toEqual({
    lastDistilledAt: null,
    lastAnnotationDistillAt: null,
  });
});

// --- cancellation ---

test("an aborted pass stops, and does not advance the stamps", async () => {
  const { store, adapter } = makeStore();
  const controller = new AbortController();
  const runner = loopRunner(
    [
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "reading-position",
              summary: "Reading the attention chapter",
              body: "On page 12 on 2026-07-17.",
              annotationIds: ["ann-1"],
            },
          },
        ],
      },
      { text: "should never be asked for" },
    ],
    // Hung up between the write and the round that would have finished the pass.
    (round) => {
      if (round === 1) controller.abort();
    },
  );

  const attempt = runDistillPass(passInput(), {
    store,
    adapter,
    run: runner.run,
    signal: controller.signal,
    now: () => JULY_17,
  });

  await expect(attempt).rejects.toBeInstanceOf(StoppedError);
  // The loop stopped there: a run that carried on would have asked for a third.
  expect(runner.streamed()).toBe(2);
  expect(await store.list()).toHaveLength(1); // the write it made stays on disk
  expect(await store.getMeta()).toEqual({
    lastDistilledAt: null,
    lastAnnotationDistillAt: null,
  });
});

test("a signal already aborted never reaches the model", async () => {
  const { adapter } = makeStore();
  const controller = new AbortController();
  controller.abort();
  const runner = loopRunner([{ text: "done" }]);

  await expect(
    runDistillation(makeInput(), adapter, { run: runner.run, signal: controller.signal }),
  ).rejects.toBeInstanceOf(StoppedError);
  expect(runner.requests.length).toBe(0);
});

test("system prompt carries the curation rules, the date, and the numbered index", () => {
  const prompt = buildDistillSystemPrompt(makeInput({ indexText: "- [belief] x (updated 2026-07-01, id m-11111111)" }));
  expect(prompt).toContain("conversation below happened on 2026-07-17");
  expect(prompt).toContain("never rewritten");
  expect(prompt).toContain("cannot be re-derived");
  // The index line keeps its id — a body names other observations by id — and
  // gains the number "same-as" points at.
  expect(prompt).toContain("[1] - [belief] x (updated 2026-07-01, id m-11111111)");
  // With nothing held about the reader yet, the two statement relations have no
  // target and are not offered.
  expect(prompt).toContain('Every observation you create is relation "new"');
  expect(prompt).not.toContain("predicted-by");
});

test("the statements a pass may point at are printed numbered, superseded ones left out", () => {
  const prompt = buildDistillSystemPrompt(
    makeInput({
      indexText: "- [belief] x (updated 2026-07-01, id m-11111111)",
      statements: [
        {
          id: "s-1111111111111111",
          kind: "profile",
          text: "Wants the derivation, not the picture",
          lastSupported: "2026-08-30",
        },
        {
          id: "s-2222222222222222",
          kind: "concern",
          text: "An old reading of the same evidence",
          lastSupported: "2026-06-01",
          supersededBy: "s-1111111111111111",
        },
      ],
    }),
  );
  expect(prompt).toContain("[1] (profile, last supported 2026-08-30) Wants the derivation");
  expect(prompt).not.toContain("An old reading");
  // The id is not printed: the number is the only handle, so there is none to
  // copy wrongly.
  expect(prompt).not.toContain("s-1111111111111111");
  expect(prompt).toContain('relation "predicted-by"');
  expect(prompt).toContain('"contradicts"');
});

test("user message carries metadata, the marked passage, and a numbered transcript", () => {
  const msg = buildDistillUserMessage(
    makeInput({
      messages: [
        { role: "user", text: "why is this quadratic?", ts: JULY_17 },
        { role: "ai", text: "because every token attends to every token", ts: JULY_17 },
      ],
    }),
  );
  expect(msg).toContain("Topic: attention");
  expect(msg).toContain("annotation ann-1 (page 12)");
  expect(msg).toContain('Marked passage: "the marked sentence"');
  // A line number and the line's own day, never an id for the model to copy.
  expect(msg).toContain("[1] 2026-07-17 reader: why is this quadratic?");
  expect(msg).toContain("[2] 2026-07-17 you: because every token attends to every token");
  expect(msg).not.toContain("thread-1:");
});

function mark(overrides: Partial<DistillAnnotation> = {}): DistillAnnotation {
  return { id: "a", page: 1, text: "t", comment: undefined, createdAt: 0, ...overrides };
}

test("selectSilentMarks keeps only marks after the cursor, newest first", () => {
  const anns = [
    mark({ id: "old", createdAt: 100, text: "old" }),
    mark({ id: "new", createdAt: 300, text: "new" }),
    mark({ id: "mid", createdAt: 200, text: "mid" }),
  ];
  const { marks, capped } = selectSilentMarks(anns, 150);
  expect(marks.map((m) => m.id)).toEqual(["new", "mid"]); // "old" is before the cursor
  expect(capped).toBe(false);
});

test("selectSilentMarks with a null cursor takes everything, and drops empty marks", () => {
  const anns = [
    mark({ id: "a", createdAt: 1, text: "has text" }),
    mark({ id: "b", createdAt: 2, text: "", comment: "  " }), // no text, no note → dropped
    mark({ id: "c", createdAt: 3, text: "", comment: "a note" }), // note only → kept
  ];
  const { marks } = selectSilentMarks(anns, null);
  expect(marks.map((m) => m.id)).toEqual(["c", "a"]);
});

// The cap and the cursor are one mechanism: the cursor is a single timestamp,
// so the batch has to be the oldest end of the backlog or the marks left over
// are older than the cursor the pass writes and no later pass ever selects them
// again. 45 marks, a cap of 40, and the 5 that did not fit have to be exactly
// what the next pass picks up.
test("selectSilentMarks caps at the oldest N and leaves the rest for the next pass", () => {
  const anns = Array.from({ length: 45 }, (_, i) => mark({ id: `m${i}`, createdAt: i, text: `t${i}` }));
  const { marks, capped, cursor } = selectSilentMarks(anns, null, 40);
  expect(marks).toHaveLength(40);
  expect(capped).toBe(true);
  expect(marks[0].id).toBe("m39"); // newest of the batch, first
  expect(marks[39].id).toBe("m0"); // and the batch starts at the oldest mark there is
  expect(cursor).toBe(39); // the newest mark this pass looked at, not the newest there is

  const next = selectSilentMarks(anns, cursor, 40);
  expect(next.marks.map((m) => m.id)).toEqual(["m44", "m43", "m42", "m41", "m40"]);
  expect(next.capped).toBe(false);
});

// Two marks made in the same millisecond, on the cap's boundary. A batch cut
// between them puts the newer one behind a cursor equal to its own createdAt,
// and `a.createdAt > since` never selects it again: 40 of 41 marks looked at,
// the 41st written off. So the batch is taken through the whole tie instead —
// what each pass actually sees, not what the store recorded.
test("a tie on the cap boundary is taken whole, not cut through", () => {
  const anns = [
    ...Array.from({ length: 39 }, (_, i) => mark({ id: `m${i}`, createdAt: i, text: `t${i}` })),
    mark({ id: "tieA", createdAt: 39, text: "tie a" }),
    mark({ id: "tieB", createdAt: 39, text: "tie b" }),
  ];
  const first = selectSilentMarks(anns, null, 40);
  const second = selectSilentMarks(anns, first.cursor, 40);

  const seen = [...first.marks, ...second.marks].map((m) => m.id);
  expect(seen).toContain("tieA");
  expect(seen).toHaveLength(41);
  expect(new Set(seen).size).toBe(41); // and none of them twice
  // Nothing was left over, so the prompt must not tell the model more follows.
  expect(first.capped).toBe(false);
});

// The same tie with a mark above it: the batch still ends between milliseconds,
// and what did not fit is exactly what the next pass picks up, once.
test("a boundary tie still leaves the marks above it for the next pass", () => {
  const anns = [
    ...Array.from({ length: 39 }, (_, i) => mark({ id: `m${i}`, createdAt: i, text: `t${i}` })),
    mark({ id: "tieA", createdAt: 39, text: "tie a" }),
    mark({ id: "tieB", createdAt: 39, text: "tie b" }),
    mark({ id: "newest", createdAt: 40, text: "newest" }),
  ];
  const first = selectSilentMarks(anns, null, 40);
  expect(first.capped).toBe(true);
  expect(first.cursor).toBe(39);
  expect(first.marks.map((m) => m.id)).toContain("tieA");
  expect(first.marks.map((m) => m.id)).toContain("tieB");
  expect(first.marks.map((m) => m.id)).not.toContain("newest");

  const second = selectSilentMarks(anns, first.cursor, 40);
  expect(second.marks.map((m) => m.id)).toEqual(["newest"]);
  expect(selectSilentMarks(anns, second.cursor, 40).marks).toEqual([]);
});

test("an uncapped selection is every fresh mark, newest first, and the cursor is the newest", () => {
  const anns = Array.from({ length: 3 }, (_, i) => mark({ id: `m${i}`, createdAt: i, text: `t${i}` }));
  const { marks, capped, cursor } = selectSilentMarks(anns, null, 40);
  expect(marks.map((m) => m.id)).toEqual(["m2", "m1", "m0"]);
  expect(capped).toBe(false);
  expect(cursor).toBe(2);
  expect(selectSilentMarks(anns, cursor, 40).marks).toEqual([]);
  expect(selectSilentMarks([], null, 40).cursor).toBeNull();
});

test("formatSilentMarks renders a pattern block with ids, pages, and the cap note", () => {
  const block = formatSilentMarks(
    [mark({ id: "x1", page: 7, text: "recursion", comment: "confusing" })],
    true,
  );
  expect(block).toContain("since the last distillation");
  expect(block).toContain("PATTERN");
  expect(block).toContain("the rest follow in a later pass"); // capped
  expect(block).toContain('[x1] p7: "recursion" — note: confusing');
});

test("formatSilentMarks is empty when there are no marks", () => {
  expect(formatSilentMarks([], false)).toBe("");
});

test("silent marks reach the prompts only when present", () => {
  const withMarks = makeInput({
    silentMarks: [mark({ id: "x1", page: 7, text: "recursion" })],
  });
  expect(buildDistillSystemPrompt(withMarks)).toContain("Silent marks");
  expect(buildDistillUserMessage(withMarks)).toContain('[x1] p7: "recursion"');

  const noMarks = makeInput();
  expect(buildDistillSystemPrompt(noMarks)).not.toContain("Silent marks");
  expect(buildDistillUserMessage(noMarks)).not.toContain("since the last distillation");
});


// --- marks with no conversation ---

test("countNewReaderMessages counts only what the reader said after the cursor", () => {
  const msgs: DistillMessage[] = [
    { role: "user", text: "a", ts: 1 },
    { role: "ai", text: "b", ts: 2 },
    { role: "user", text: "c", ts: 3 },
    { role: "ai", text: "d", ts: 4 },
    { role: "user", text: "   ", ts: 5 }, // an empty row is not something said
  ];
  expect(countNewReaderMessages(msgs, 0)).toBe(2);
  expect(countNewReaderMessages(msgs, 2)).toBe(1);
  expect(countNewReaderMessages(msgs, 5)).toBe(0);
  // A cursor past the end (a thread that shrank) is clamped, not negative.
  expect(countNewReaderMessages(msgs, 99)).toBe(0);
});

test("a book with only marks is distilled on its own, and moves its cursor", async () => {
  const { store, adapter } = makeStore();
  const result = await runMarksDistillPass(
    {
      topicName: "investing",
      bookId: "book-7",
      bookName: "margin-of-safety.pdf",
      annotations: [
        mark({ id: "m1", page: 20, text: "owner earnings", createdAt: 100 }),
        mark({ id: "m2", page: 140, text: "margin of safety", createdAt: 400 }),
      ],
    },
    { store, adapter, now: () => JULY_17, ...scriptedRunner([{ text: "done" }]) },
  );

  expect(result).toMatchObject({ ran: true, ok: true });
  expect(await store.getMeta()).toEqual({
    lastDistilledAt: JULY_17,
    lastAnnotationDistillAt: null,
    distilledMarks: { "book-7": 400 },
  });
});

// A reader who marked up a whole book before the first pass ran: 45 marks, a cap
// of 40. The pass writes one timestamp as the book's cursor, and every mark not
// newer than it is never selected again — so the cursor it writes has to be the
// newest mark this pass actually put in front of the model, and the five it did
// not have to be what the next pass reads. Against the old cap (newest 40,
// cursor = the newest of all) the second pass here sees nothing and m0..m4 are
// gone from the app's view of the book for good.
test("a backlog bigger than the cap is drained across passes, not stepped over", async () => {
  const { store, adapter } = makeStore();
  const annotations = Array.from({ length: 45 }, (_, i) =>
    mark({ id: `m${i}`, page: i + 1, text: `passage ${i}`, createdAt: 100 + i }),
  );
  const input = {
    topicName: "investing",
    bookId: "book-7",
    bookName: "margin-of-safety.pdf",
    annotations,
  };

  const first = loopRunner([{ text: "done" }]);
  expect(
    await runMarksDistillPass(input, { store, adapter, run: first.run, now: () => JULY_17 }),
  ).toMatchObject({ ran: true, ok: true });
  // The oldest 40 went to the model, and the cursor is the newest of those.
  expect(first.requests[0].task).toContain("[m0]");
  expect(first.requests[0].task).toContain("[m39]");
  expect(first.requests[0].task).not.toContain("[m40]");
  expect((await store.getMeta()).distilledMarks).toEqual({ "book-7": 139 });

  const second = loopRunner([{ text: "done" }]);
  expect(
    await runMarksDistillPass(input, { store, adapter, run: second.run, now: () => JULY_20 }),
  ).toMatchObject({ ran: true, ok: true });
  // The five the cap left behind, and nothing the first pass already read.
  expect(second.requests[0].task).toContain("[m44]");
  expect(second.requests[0].task).toContain("[m40]");
  expect(second.requests[0].task).not.toContain("[m39]");
  expect((await store.getMeta()).distilledMarks).toEqual({ "book-7": 144 });

  // And now there is nothing left: every one of the 45 has been looked at.
  const third = loopRunner([{ text: "done" }]);
  expect(
    await runMarksDistillPass(input, { store, adapter, run: third.run, now: () => JULY_20 }),
  ).toEqual({ ran: false, skipped: "no-new-marks" });
});

test("a marks pass below its threshold does not reach the model", async () => {
  const { store, adapter } = makeStore();
  const runner = loopRunner([{ text: "done" }]);
  const result = await runMarksDistillPass(
    {
      topicName: "investing",
      bookId: "book-7",
      bookName: "margin-of-safety.pdf",
      annotations: [mark({ id: "m1", page: 20, text: "owner earnings", createdAt: 100 })],
      minNewMarks: 5,
    },
    { store, adapter, run: runner.run, now: () => JULY_17 },
  );

  expect(result).toEqual({ ran: false, skipped: "no-new-marks" });
  expect(runner.requests.length).toBe(0);
});

test("a failed marks pass leaves the book's cursor where it was", async () => {
  const { store, adapter } = makeStore();
  const result = await runMarksDistillPass(
    {
      topicName: "investing",
      bookId: "book-7",
      bookName: "margin-of-safety.pdf",
      annotations: [mark({ id: "m1", page: 20, text: "owner earnings", createdAt: 100 })],
    },
    { store, adapter, now: () => JULY_17, ...scriptedRunner([{ error: "connection reset" }]) },
  );

  expect(result).toMatchObject({ ran: true, ok: false });
  expect((await store.getMeta()).distilledMarks).toBeUndefined();
});

test("the marks prompt says there was no conversation and refuses comprehension claims", () => {
  const input = {
    topicName: "investing",
    bookName: "margin-of-safety.pdf",
    marks: [mark({ id: "m1", page: 20, text: "owner earnings", comment: "why not FCF?" })],
    capped: false,
    indexText: "- [belief] x (updated 2026-07-01, id m-11111111)",
    dates: { first: "2026-07-17", last: "2026-07-17" },
  };
  const prompt = buildMarksDistillSystemPrompt(input);
  // It never claims a transcript it does not have.
  expect(prompt).toContain("conversation to read");
  expect(prompt).not.toContain("Transcript");
  // What marks are, and are not, evidence of.
  expect(prompt).toContain("distribution");
  expect(prompt).toContain("Do not record understood-concept");
  expect(prompt).toContain("Aggregate.");
  // The reader having got further is the reading-position observation happening
  // again, not a second one.
  expect(prompt).toContain('"same-as"');
  expect(prompt).toContain("stretch of marks below happened on 2026-07-17");
  expect(prompt).toContain("id m-11111111");

  const msg = buildMarksDistillUserMessage(input);
  expect(msg).toContain("margin-of-safety.pdf");
  expect(msg).toContain("there is no transcript");
  expect(msg).toContain('[m1] p20: "owner earnings" — note: why not FCF?');
});

// --- when the evidence happened (the pass is not the conversation) ---

// Local noon, so the assertions hold in any zone the tests run in.
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0).getTime();

test("evidenceDates spans the timestamps and ignores the unusable ones", () => {
  expect(evidenceDates([noon(2026, 8, 4), noon(2026, 8, 1), noon(2026, 8, 3)])).toEqual({
    first: "2026-08-01",
    last: "2026-08-04",
  });
  expect(evidenceDates([noon(2026, 8, 4)])).toEqual({ first: "2026-08-04", last: "2026-08-04" });
  // Rows written before messages carried a stamp must not date a pass to 1970.
  expect(evidenceDates([0, Number.NaN, noon(2026, 8, 4)])).toEqual({
    first: "2026-08-04",
    last: "2026-08-04",
  });
  expect(evidenceDates([])).toBeNull();
  expect(evidenceDates([0, 0])).toBeNull();
});

test("formatEvidenceSpan collapses one day and spells out a range", () => {
  expect(formatEvidenceSpan({ first: "2026-08-04", last: "2026-08-04" })).toBe("2026-08-04");
  expect(formatEvidenceSpan({ first: "2026-08-01", last: "2026-08-04" })).toBe(
    "2026-08-01 to 2026-08-04",
  );
});

test("the dating rule names the last covered day and never the day the pass runs", () => {
  const spanned = datingRule("conversation", { first: "2026-08-01", last: "2026-08-04" }).join("\n");
  expect(spanned).toContain("2026-08-01 to 2026-08-04");
  // An observation states what is true of the reader now, so it takes the newest
  // day the evidence reaches.
  expect(spanned).toContain("dated 2026-08-04");
  expect(spanned).not.toContain("today is");

  // Nothing datable: the pass says so instead of falling back on its own clock.
  const undated = datingRule("conversation", null).join("\n");
  expect(undated).toContain("only dates this conversation gives you");
  expect(undated).toContain("not date anything by the day");
});

test("a pass dates the prompt by the messages, not by the day it runs", async () => {
  const { store, adapter } = makeStore();
  const runner = loopRunner([{ text: "done" }]);
  // The arrears sweep reaching a thread three days after the conversation.
  const spoke = noon(2026, 7, 17);
  await runDistillPass(
    {
      topicName: "attention",
      bookId: "book-1",
      bookName: "survey.pdf",
      threadId: "thread-1",
      annotationId: "ann-1",
      page: 12,
      markedText: "",
      messages: [
        { role: "user", text: "why is this quadratic?", ts: spoke },
        { role: "ai", text: "every token attends to every token", ts: spoke + 60_000 },
      ],
    },
    { store, adapter, now: () => JULY_20, run: runner.run },
  );

  const sent = runner.requests[0];
  expect(sent.systemPrompt).toContain("2026-07-17");
  expect(sent.systemPrompt).not.toContain("2026-07-20");
  expect(sent.task).toContain("Conversation date: 2026-07-17");
});

test("a marks pass dates the prompt by the marks, not by the day it runs", async () => {
  const { store, adapter } = makeStore();
  const runner = loopRunner([{ text: "done" }]);
  await runMarksDistillPass(
    {
      topicName: "investing",
      bookId: "book-2",
      bookName: "margin-of-safety.pdf",
      annotations: [
        mark({ id: "m1", page: 20, text: "owner earnings", createdAt: noon(2026, 7, 14) }),
        mark({ id: "m2", page: 24, text: "float", createdAt: noon(2026, 7, 16) }),
      ],
    },
    { store, adapter, now: () => JULY_20, run: runner.run },
  );

  const sent = runner.requests[0];
  expect(sent.task).toContain("Marks made: 2026-07-14 to 2026-07-16");
  expect(sent.systemPrompt).not.toContain("2026-07-20");
});

// --- what a failed pass records ---

test("distillCoverage reports the stretch a failed pass leaves behind", () => {
  const stamps = [noon(2026, 8, 1), noon(2026, 8, 4)];
  expect(distillCoverage(stamps, 6)).toEqual({
    from: 6,
    to: 8,
    fromTs: stamps[0],
    toTs: stamps[1],
  });
  expect(distillCoverage([], 6)).toEqual({ from: 6, to: 6, fromTs: null, toTs: null });
});

test("a failed pass carries the message range it did not fold in", async () => {
  const { store, adapter } = makeStore();
  const spoke = noon(2026, 7, 17);
  const messages: DistillMessage[] = [
    { role: "user", text: "first", ts: spoke },
    { role: "ai", text: "answer", ts: spoke + 1000 },
    { role: "user", text: "second", ts: spoke + 2000 },
  ];
  await store.setMeta({
    lastDistilledAt: null,
    lastAnnotationDistillAt: null,
    distilledMessages: { "thread-1": 1 },
  });
  const result = await runDistillPass(
    {
      topicName: "attention",
      bookId: "book-1",
      bookName: "survey.pdf",
      threadId: "thread-1",
      annotationId: "ann-1",
      page: null,
      markedText: "",
      messages,
    },
    { store, adapter, now: () => JULY_20, ...scriptedRunner([{ error: "connection reset" }]) },
  );

  expect(result).toMatchObject({ ran: true, ok: false });
  if (!result.ran) throw new Error("expected the pass to have run");
  // From the cursor to the end of the thread: exactly what the next pass redoes.
  expect(result.coverage).toEqual({
    from: 1,
    to: 3,
    fromTs: spoke + 1000,
    toTs: spoke + 2000,
  });
});

test("classifyDistillFailure sorts an outcome, then an error's own words", () => {
  expect(classifyDistillFailure({ outcome: "out-of-turns" })).toBe("turn-cap");
  expect(classifyDistillFailure({ outcome: "out-of-budget" })).toBe("turn-cap");
  expect(classifyDistillFailure({ outcome: "out-of-context" })).toBe("context");
  expect(classifyDistillFailure({ outcome: "refused" })).toBe("refused");
  expect(classifyDistillFailure({ outcome: "no-evidence" })).toBe("no-evidence");

  const failed = (message: string) =>
    classifyDistillFailure({ outcome: "failed", error: new Error(message) });
  expect(failed("no default AI provider configured (Settings)")).toBe("no-provider");
  expect(failed("fetch failed: ECONNRESET")).toBe("network");
  expect(failed("request timed out after 60s")).toBe("network");
  expect(failed("429 rate limit exceeded")).toBe("rate-limit");
  expect(failed("401 unauthorized: invalid api key")).toBe("auth");
  expect(failed("prompt is too long for the context window")).toBe("context");
  expect(failed("failed to write memory-x/m-11111111.md: os error 2")).toBe("storage");
  expect(failed("unexpected token in JSON at position 4")).toBe("parse");
  expect(failed("something nobody has seen before")).toBe("unknown");
  // A thrown non-Error still classifies rather than throwing again.
  expect(classifyDistillFailure({ outcome: "failed", error: "network unreachable" })).toBe("network");
  expect(classifyDistillFailure({ outcome: "failed", error: { weird: true } })).toBe("unknown");
});

test("the write payload carries the relation spread and the refusals, and no text", () => {
  const payload = distillWritePayload({
    relations: { new: 2, "predicted-by": 1, contradicts: 1, "same-as": 3 },
    rejected: { "bad-index": 1, "unresolved-anchor": 0, "unresolved-mention": 2 },
  });
  expect(payload).toEqual({
    relNew: 2,
    relPredictedBy: 1,
    relContradicts: 1,
    relSameAs: 3,
    refusedBadIndex: 1,
    refusedAnchor: 0,
    refusedMention: 2,
  });
  // Numbers only: no id, no summary, nothing a log reader could quote back.
  expect(Object.values(payload).every((v) => typeof v === "number")).toBe(true);
});

test("the failure payload answers where, why and over what — and quotes nothing", () => {
  const payload = distillFailurePayload({
    stage: "run",
    outcome: "failed",
    error: undefined,
    coverage: { from: 1, to: 3, fromTs: 111, toTs: 222 },
    counts: { created: 1, updated: 0, deleted: 0 },
  });
  expect(payload).toEqual({
    stage: "run",
    reason: "unknown",
    outcome: "failed",
    from: 1,
    to: 3,
    fromTs: 111,
    toTs: 222,
    created: 1,
    updated: 0,
    deleted: 0,
  });

  // A pass that never reached a run has no outcome, no coverage and no counts,
  // and says so with nulls rather than with zeros somebody would read as facts.
  const setup = distillFailurePayload({
    stage: "setup",
    error: new Error("no default AI provider configured (Settings)"),
  });
  expect(setup).toEqual({
    stage: "setup",
    reason: "no-provider",
    outcome: null,
    from: null,
    to: null,
    fromTs: null,
    toTs: null,
    created: null,
    updated: null,
    deleted: null,
  });

  // Nothing the model or the reader wrote may reach the log.
  const quoted = distillFailurePayload({
    stage: "run",
    outcome: "refused",
    error: new Error("the reader said the lesion studies were the point"),
  });
  expect(JSON.stringify(quoted)).not.toContain("lesion");
});

// --- what the pass dates its observations by ---
//
// The store's clock in these tests is 2026-07-17. The sweep comes back to a
// thread every half hour for as long as it is owed, so that is routinely not the
// day the reader was here: 38 of 110 placeable observations on one real store
// carry a date their own evidence does not support, the worst off by 17 days.

test("a pass dates what it writes by the transcript, not by the day it runs", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput({
      messages: [
        { role: "user", text: "why is this quadratic?", ts: noon(2026, 7, 2) },
        { role: "ai", text: "every token attends to every token", ts: noon(2026, 7, 2) },
        { role: "user", text: "so the KV cache is the fix?", ts: noon(2026, 7, 5) },
      ],
      dates: { first: "2026-07-02", last: "2026-07-05" },
    }),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "stuck-point",
              summary: "Stuck on quadratic attention cost",
              body: "Asked over two evenings.",
              messageIndices: [1, 3],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result.created).toBe(1);
  const [entry] = await store.list();
  expect(entry.created).toBe("2026-07-02");
  expect(entry.updated).toBe("2026-07-05");
});

test("the marks pass dates what it writes by when the marks were made", async () => {
  const { store, adapter } = makeStore();
  const marks: DistillAnnotation[] = [
    { id: "ann-1", page: 12, text: "softmax over the scores", createdAt: noon(2026, 6, 20) },
    { id: "ann-2", page: 31, text: "the residual stream", createdAt: noon(2026, 6, 29) },
  ];
  const result = await runMarksDistillation(
    {
      topicName: "attention",
      bookName: "survey.pdf",
      marks,
      capped: false,
      indexText: "",
      dates: { first: "2026-06-20", last: "2026-06-29" },
    },
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "observation_update",
            id: "c1",
            args: {
              action: "create",
              relation: "new",
              type: "belief",
              summary: "Marks cluster on what the residual stream carries",
              body: "From marks with no conversation behind them.",
              annotationIds: ["ann-1", "ann-2"],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result.created).toBe(1);
  const [entry] = await store.list();
  expect(entry.created).toBe("2026-06-20");
  expect(entry.updated).toBe("2026-06-29");
});
