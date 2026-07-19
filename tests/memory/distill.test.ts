// Distillation flow tests (src/memory/distill.ts) with a mocked AI turn: the
// runner is backed by runAgentLoop over a scripted fake stream (same pattern
// as tests/ai/agent.test.ts), so the real memory tools run against the fake
// store with no provider, network, or token spend. Run: bun test.

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
import { FileMemoryAdapter } from "../../src/memory/adapter";
import {
  buildDistillSystemPrompt,
  buildDistillUserMessage,
  formatSilentMarks,
  runDistillation,
  selectSilentMarks,
  type DistillAnnotation,
  type DistillInput,
  type DistillRunner,
} from "../../src/memory/distill";
import { MemoryFileStore } from "../../src/memory/store";
import { JULY_17, makeFakeFs } from "./fakefs";

type ToolReq = { name: string; args: Record<string, any>; id: string };
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
  return [{ type: "done", reason: hasCalls ? "toolUse" : "stop", message }];
}

function scriptStream(turns: Turn[]): StreamFn {
  let round = 0;
  return () => {
    const events = turnEvents(turns[round++] ?? { text: "done" });
    const stream = createAssistantMessageEventStream();
    void (async () => {
      for (const ev of events) {
        await Promise.resolve();
        stream.push(ev);
      }
      stream.end();
    })();
    return stream;
  };
}

// A DistillRunner backed by the real agent loop over a scripted model.
function scriptedRunner(turns: Turn[]): DistillRunner {
  return ({ systemPrompt, userText, tools }) =>
    new Promise<void>((resolve, reject) => {
      void runAgentLoop({
        stream: scriptStream(turns),
        model: {} as Model<Api>,
        systemPrompt,
        messages: [{ role: "user", content: userText, timestamp: 0 }],
        tools,
        maxRounds: 8,
        onDelta: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onDone: () => resolve(),
        onError: (m) => reject(new Error(m)),
      });
    });
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
  const store = new MemoryFileStore("t", fs, () => JULY_17);
  return { store, adapter: new FileMemoryAdapter(store) };
}

test("distillation creates memories through the real tools and counts them", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(
    makeInput(),
    adapter,
    scriptedRunner([
      {
        calls: [
          {
            name: "memory_update",
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

  expect(result).toEqual({ created: 1, updated: 0, deleted: 0 });
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].type).toBe("stuck-point");
  expect(entries[0].anchors).toEqual({ annotationIds: ["ann-1"], messageIds: ["thread-1:100"] });
  // The index carries it for the next conversation's snapshot.
  expect(await store.readIndexText()).toContain("Stuck on quadratic attention cost");
});

test("distillation updates (evolution) and deletes existing memories", async () => {
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
            name: "memory_update",
            id: "c1",
            args: {
              action: "update",
              id: stuck.id,
              type: "understood-concept",
              summary: "Was stuck on quadratic attention cost, resolved on 2026-07-17",
              body: "Was stuck (2026-07-10) on why attention is O(n^2); resolved on 2026-07-17.",
            },
          },
          { name: "memory_update", id: "c2", args: { action: "delete", id: wrong.id } },
        ],
      },
      { text: "done" },
    ]),
  );

  expect(result).toEqual({ created: 0, updated: 1, deleted: 1 });
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].id).toBe(stuck.id); // evolution rewrote, never re-created
  expect(entries[0].summary).toContain("resolved on 2026-07-17");
  expect(entries[0].created).toBe("2026-07-17"); // created preserved from retain date
});

test("a no-op distillation (nothing worth keeping) writes nothing", async () => {
  const { store, adapter } = makeStore();
  const result = await runDistillation(makeInput(), adapter, scriptedRunner([{ text: "done" }]));
  expect(result).toEqual({ created: 0, updated: 0, deleted: 0 });
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
            name: "memory_update",
            id: "c1",
            args: { action: "create", type: "stuck-point", summary: "s" },
          },
        ],
      },
      { text: "done" },
    ]),
  );
  expect(result).toEqual({ created: 0, updated: 0, deleted: 0 });
  expect(await store.list()).toEqual([]);
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
