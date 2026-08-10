// Distillation flow tests (src/observation/distill.ts) with a mocked AI turn: the
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
import { FileObservationAdapter } from "../../src/observation/adapter";
import {
  buildDistillAgent,
  buildDistillSystemPrompt,
  buildDistillUserMessage,
  formatSilentMarks,
  buildMarksDistillSystemPrompt,
  buildMarksDistillUserMessage,
  countNewReaderMessages,
  runDistillPass,
  runDistillation,
  runMarksDistillPass,
  selectSilentMarks,
  DISTILL_BRIEF_TOKENS,
  type DistillAnnotation,
  type DistillInput,
  type DistillMessage,
  type DistillPassInput,
} from "../../src/observation/distill";
import { ObservationFileStore } from "../../src/observation/store";
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
    today: "2026-07-17",
    ...overrides,
  };
}

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
              type: "stuck-point",
              summary: "Stuck on quadratic attention cost",
              body: "Asked on 2026-07-17 why attention is O(n^2).",
              annotationIds: ["ann-1"],
              messageIds: ["thread-1:100"],
            },
          },
        ],
      },
      { text: "done" },
    ]),
  );

  expect(result).toEqual({ created: 1, updated: 0, deleted: 0, ok: true, outcome: "answered" });
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].type).toBe("stuck-point");
  expect(entries[0].anchors).toEqual({ annotationIds: ["ann-1"], messageIds: ["thread-1:100"] });
  // The index carries it for the next conversation's snapshot.
  expect(await store.readIndexText()).toContain("Stuck on quadratic attention cost");
});

test("distillation updates (evolution) and deletes existing observations", async () => {
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
              action: "update",
              id: stuck.id,
              type: "understood-concept",
              summary: "Was stuck on quadratic attention cost, resolved on 2026-07-17",
              body: "Was stuck (2026-07-10) on why attention is O(n^2); resolved on 2026-07-17.",
            },
          },
          { name: "observation_update", id: "c2", args: { action: "delete", id: wrong.id } },
        ],
      },
      { text: "done" },
    ]),
  );

  expect(result).toEqual({ created: 0, updated: 1, deleted: 1, ok: true, outcome: "answered" });
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].id).toBe(stuck.id); // evolution rewrote, never re-created
  expect(entries[0].summary).toContain("resolved on 2026-07-17");
  expect(entries[0].created).toBe("2026-07-17"); // created preserved from retain date
});

test("a no-op distillation (nothing worth keeping) writes nothing", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(makeInput(), adapter, scriptedRunner([{ text: "done" }]));
  // ok, with no tool call at all: the point of evidence "optional" (see below).
  expect(result).toEqual({ created: 0, updated: 0, deleted: 0, ok: true, outcome: "answered" });
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
            args: { action: "create", type: "stuck-point", summary: "s" },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result).toEqual({ created: 0, updated: 0, deleted: 0, ok: true, outcome: "answered" });
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
  expect(definition.systemPrompt).toContain("Update, don't duplicate");
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
              type: "belief",
              summary: "Suspects the survey overstates the result",
              body: "Voiced on 2026-07-17.",
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
              type: "reading-position",
              summary: "Reading the attention chapter",
              body: "On page 12 on 2026-07-17.",
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

test("system prompt carries the curation rules, the date, and the index", () => {
  const prompt = buildDistillSystemPrompt(makeInput({ indexText: "- [belief] x (updated 2026-07-01, id m-11111111)" }));
  expect(prompt).toContain("Update, don't duplicate");
  expect(prompt).toContain("today is 2026-07-17");
  expect(prompt).toContain("evolution");
  expect(prompt).toContain("id m-11111111");
  expect(prompt).toContain("cannot be re-derived");
});

test("user message carries metadata, the marked passage, and message ids", () => {
  const msg = buildDistillUserMessage(makeInput());
  expect(msg).toContain("Topic: attention");
  expect(msg).toContain("annotation ann-1 (page 12)");
  expect(msg).toContain('Marked passage: "the marked sentence"');
  expect(msg).toContain("[thread-1:100] reader: why is this quadratic?");
  expect(msg).toContain("[thread-1:200] you: because every token attends to every token");
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

test("selectSilentMarks caps the list at the most recent N", () => {
  const anns = Array.from({ length: 45 }, (_, i) => mark({ id: `m${i}`, createdAt: i, text: `t${i}` }));
  const { marks, capped } = selectSilentMarks(anns, null, 40);
  expect(marks).toHaveLength(40);
  expect(capped).toBe(true);
  expect(marks[0].id).toBe("m44"); // newest first
});

test("formatSilentMarks renders a pattern block with ids, pages, and the cap note", () => {
  const block = formatSilentMarks(
    [mark({ id: "x1", page: 7, text: "recursion", comment: "confusing" })],
    true,
  );
  expect(block).toContain("since the last distillation");
  expect(block).toContain("PATTERN");
  expect(block).toContain("there were more"); // capped
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
    today: "2026-07-17",
  };
  const prompt = buildMarksDistillSystemPrompt(input);
  // It never claims a transcript it does not have.
  expect(prompt).toContain("conversation to read");
  expect(prompt).not.toContain("Transcript");
  // What marks are, and are not, evidence of.
  expect(prompt).toContain("distribution");
  expect(prompt).toContain("Do not record understood-concept");
  expect(prompt).toContain("Aggregate.");
  expect(prompt).toContain("Update, don't duplicate");
  expect(prompt).toContain("today is 2026-07-17");
  expect(prompt).toContain("id m-11111111");

  const msg = buildMarksDistillUserMessage(input);
  expect(msg).toContain("margin-of-safety.pdf");
  expect(msg).toContain("there is no transcript");
  expect(msg).toContain('[m1] p20: "owner earnings" — note: why not FCF?');
});
