// The open call's transitions (src/reading/call-state). Every one of the moves
// App.tsx used to make with a spread of its own is here, with the guards that
// used to be implicit in where each of those spreads sat. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  applyRowChange,
  callReducer,
  levelGate,
  toolInCall,
  type CallRow,
  type CallState,
  type RowChange,
} from "../../src/reading/call-state";

// A surface's row: CallRow plus something only the render layer knows about, so
// a transition that dropped it would show up here.
interface Row extends CallRow {
  parts?: string[];
}

const reduce = callReducer<Row>;

function call(over: Partial<CallState<Row>> = {}): CallState<Row> {
  return {
    threadId: "t1",
    annotationId: "mark-1",
    view: "bubble",
    anchor: { x: 10, y: 20 },
    messages: [],
    ...over,
  };
}

const user = (ts: number, text: string): Row => ({ role: "user", text, ts });
const ai = (ts: number, text: string, over: Partial<Row> = {}): Row => ({ role: "ai", text, ts, ...over });

test("a fresh AI-pen mark opens a bubble, replacing whatever was open", () => {
  const open = call({ threadId: "old", messages: [user(1, "hi")] });
  const next = reduce(open, {
    type: "opened",
    call: call({ threadId: "new", annotationId: "mark-2", messages: [] }),
  });

  expect(next?.threadId).toBe("new");
  expect(next?.view).toBe("bubble");
  expect(next?.messages).toEqual([]);
});

test("the book-level thread opens straight to chat-main and is flagged as the book's", () => {
  const next = reduce(null, {
    type: "opened",
    call: call({ threadId: "book", annotationId: "", isBook: true, view: "chat-main" }),
  });

  expect(next?.isBook).toBe(true);
  expect(next?.annotationId).toBe("");
  expect(next?.view).toBe("chat-main");
});

test("every way out of a call leaves nothing open", () => {
  expect(reduce(call({ view: "chat-main" }), { type: "closed" })).toBeNull();
  expect(reduce(null, { type: "closed" })).toBeNull();
});

test("deleting a mark closes the call anchored on it and no other", () => {
  const open = call({ annotationId: "mark-1" });
  expect(reduce(open, { type: "closed-with-mark", annotationId: "mark-1" })).toBeNull();
  expect(reduce(open, { type: "closed-with-mark", annotationId: "mark-9" })).toBe(open);
  // The book-level thread has no mark; a deleted mark must not take it down.
  const book = call({ annotationId: "", isBook: true });
  expect(reduce(book, { type: "closed-with-mark", annotationId: "mark-1" })).toBe(book);
});

test("chat takes the whole window from the bubble and from the chat corner card", () => {
  expect(reduce(call({ view: "bubble" }), { type: "chat-opened" })?.view).toBe("chat-main");
  expect(reduce(call({ view: "chat-pip" }), { type: "chat-opened" })?.view).toBe("chat-main");
  expect(reduce(null, { type: "chat-opened" })).toBeNull();
});

test("chat shrinks to the corner card when the reader is wanted back", () => {
  const open = call({ view: "chat-main", messages: [ai(1, "here")] });
  const next = reduce(open, { type: "reading-uncovered" });

  expect(next?.view).toBe("chat-pip");
  expect(next?.messages).toBe(open.messages);
});

// The guard that differed between App's two callers. The bubble does not cover
// the reader, so a citation tapped inside one has nothing to uncover: it jumps
// the page and the bubble stays where it is.
test("a bubble is not turned into the chat corner card by a citation", () => {
  const open = call({ view: "bubble" });
  expect(reduce(open, { type: "reading-uncovered" })).toBe(open);
  const pip = call({ view: "chat-pip" });
  expect(reduce(pip, { type: "reading-uncovered" })).toBe(pip);
});

test("a thread's stored images land on the rows they belong to", () => {
  const open = call({ messages: [user(1, "look"), user(2, "and this"), ai(3, "I see")] });
  const images = new Map([[1, [{ data: "AAA", mediaType: "image/png" as const }]]]);
  const next = reduce(open, { type: "images-loaded", threadId: "t1", images });

  expect(next?.messages[0].images).toEqual([{ data: "AAA", mediaType: "image/png" }]);
  expect(next?.messages[1].images).toBeUndefined();
  expect(next?.messages[2]).toBe(open.messages[2]);
});

test("images that finished loading for another thread are ignored", () => {
  const open = call({ messages: [user(1, "look")] });
  const images = new Map([[1, [{ data: "AAA", mediaType: "image/png" as const }]]]);

  expect(reduce(open, { type: "images-loaded", threadId: "other", images })).toBe(open);
});

test("a turn starting replaces the rows that hold no answer and clears the retry", () => {
  const open = call({
    error: true,
    messages: [
      user(1, "why?"),
      ai(2, "because"),
      ai(3, "Couldn't reach the model.", { failed: true }),
      ai(4, "", { notice: "too long to send" }),
      ai(5, "", { streaming: true }),
    ],
  });
  const row = ai(6, "", { streaming: true });
  const next = reduce(open, { type: "turn-started", threadId: "t1", row });

  expect(next?.messages.map((m) => m.ts)).toEqual([1, 2, 6]);
  expect(next?.error).toBe(false);
});

test("a turn starting on a thread the call has moved off changes nothing", () => {
  const open = call({ messages: [user(1, "why?")] });
  const row = ai(2, "", { streaming: true });

  expect(reduce(open, { type: "turn-started", threadId: "other", row })).toBe(open);
});

test("the reply is written into the AI row of that turn, and nothing else", () => {
  const open = call({
    messages: [user(7, "why?"), ai(7, "beca"), ai(8, "another turn")],
  });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 7,
    change: { kind: "delta", chunk: "use" },
  });

  expect(next?.messages[0].text).toBe("why?");
  expect(next?.messages[1].text).toBe("because");
  expect(next?.messages[2].text).toBe("another turn");
});

test("what a turn writes to a closed-over thread is dropped", () => {
  const open = call({ messages: [ai(1, "half")] });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "other",
    ts: 1,
    change: { kind: "delta", chunk: " a sentence" },
  });

  expect(next).toBe(open);
});

test("a tool starting takes the inter-round preamble with it", () => {
  const open = call({ messages: [ai(1, "let me look", { streaming: true })] });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "tool-start", name: "read_page", label: "Reading p. 4" },
  });

  expect(next?.messages[0].text).toBe("");
  expect(next?.messages[0].tools).toEqual([
    { name: "read_page", label: "Reading p. 4", state: "running" },
  ]);
  expect(next?.messages[0].streaming).toBe(true);
});

test("a tool that finished comes off the trace, and a failed one stays", () => {
  const started = call({
    messages: [
      ai(1, "", {
        streaming: true,
        tools: [
          { name: "read_page", label: "Reading p. 4", state: "running" },
          { name: "search", label: "Searching", state: "running" },
        ],
      }),
    ],
  });
  const ok = reduce(started, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "tool-end", name: "read_page", isError: false },
  });
  const failed = reduce(ok, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "tool-end", name: "search", isError: true },
  });

  expect(ok?.messages[0].tools?.map((t) => t.name)).toEqual(["search"]);
  expect(failed?.messages[0].tools).toEqual([
    { name: "search", label: "Searching", state: "error" },
  ]);
});

test("a sub-agent's progress rewrites its one line instead of adding another", () => {
  const open = call({
    messages: [
      ai(1, "", { tools: [{ name: "research", label: "Researching", state: "running" }] }),
    ],
  });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "tool-label", name: "research", label: "Read 3 papers" },
  });

  expect(next?.messages[0].tools).toEqual([
    { name: "research", label: "Read 3 papers", state: "running" },
  ]);
});

test("the answer landing keeps only the calls that failed, and carries the notice", () => {
  const open = call({
    messages: [
      ai(1, "part", {
        streaming: true,
        tools: [
          { name: "read_page", label: "Reading p. 4", state: "running" },
          { name: "search", label: "Searching", state: "error" },
        ],
      }),
    ],
  });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "answer", text: "the whole answer", notice: "left out chapter 2" },
  });
  const row = next?.messages[0];

  expect(row?.text).toBe("the whole answer");
  expect(row?.streaming).toBeFalsy();
  expect(row?.notice).toBe("left out chapter 2");
  expect(row?.tools).toEqual([{ name: "search", label: "Searching", state: "error" }]);
});

test("a turn that could not reach the model says so in the row and offers a retry", () => {
  const open = call({
    messages: [ai(1, "", { streaming: true, tools: [{ name: "search", label: "S", state: "error" }] })],
  });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "error", text: "Couldn't reach the model." },
    error: true,
  });
  const row = next?.messages[0];

  expect(row?.text).toBe("Couldn't reach the model.");
  expect(row?.failed).toBe(true);
  expect(row?.streaming).toBeFalsy();
  expect(row?.tools).toBeFalsy();
  expect(next?.error).toBe(true);
});

test("a refusal is the app talking about the turn, so it never becomes the reply", () => {
  const open = call({
    error: true,
    messages: [ai(1, "", { streaming: true, tools: [{ name: "search", label: "S", state: "error" }] })],
  });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "refusal", text: "This turn was too big to send." },
    error: false,
  });
  const row = next?.messages[0];

  expect(row?.text).toBe("");
  expect(row?.notice).toBe("This turn was too big to send.");
  expect(row?.failed).toBeFalsy();
  expect(row?.streaming).toBe(false);
  expect(row?.tools).toEqual([{ name: "search", label: "S", state: "error" }]);
  expect(next?.error).toBe(false);
});

test("a change that says nothing about the retry leaves it as it was", () => {
  const open = call({ error: true, messages: [ai(1, "half", { streaming: true })] });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "delta", chunk: " more" },
  });

  expect(next?.error).toBe(true);
});

test("the reader's message goes on the end of the conversation it was typed in", () => {
  const open = call({ messages: [ai(1, "hello")] });
  const row = user(2, "why?");
  const next = reduce(open, { type: "row-appended", threadId: "t1", row });

  expect(next?.messages.map((m) => m.ts)).toEqual([1, 2]);
  expect(reduce(open, { type: "row-appended", threadId: "other", row })).toBe(open);
});

test("the stop button keeps the half sentence as a finished row", () => {
  const open = call({
    messages: [ai(1, "half a sen", { streaming: true, tools: [{ name: "s", label: "S", state: "running" }] })],
  });
  const next = reduce(open, {
    type: "row-changed",
    threadId: "t1",
    ts: 1,
    change: { kind: "stopped", text: "half a sen" },
  });
  const row = next?.messages[0];

  expect(row?.text).toBe("half a sen");
  expect(row?.streaming).toBeFalsy();
  expect(row?.tools).toBeFalsy();
});

test("a turn stopped before it wrote anything leaves no row behind", () => {
  const open = call({ messages: [user(1, "why?"), ai(1, "", { streaming: true })] });
  const next = reduce(open, { type: "row-dropped", threadId: "t1", ts: 1 });

  // The reader's message shares the timestamp and is not the row being dropped.
  expect(next?.messages).toEqual([user(1, "why?")]);
  expect(reduce(open, { type: "row-dropped", threadId: "other", ts: 1 })).toBe(open);
});

// Every kind of change rebuilds the row it lands on, and each rebuild is a place
// the surface's own fields can be dropped. One of them going untested is how a
// stored card would come back from a reopened thread and then vanish the moment
// the turn ended.
test("what only the surface knows about the row survives every change", () => {
  const changes: RowChange[] = [
    { kind: "delta", chunk: "!" },
    { kind: "tool-start", name: "s", label: "S" },
    { kind: "tool-label", name: "s", label: "still S" },
    { kind: "tool-end", name: "s", isError: false },
    { kind: "answer", text: "answered" },
    { kind: "error", text: "could not be reached" },
    { kind: "refusal", text: "declined" },
    { kind: "stopped", text: "half a sen" },
  ];
  // A running tool, so the two changes that hand the row back when nothing
  // matches take their rebuilding path instead.
  const running = { name: "s", label: "S", state: "running" as const };

  const survived = changes.map((change) => {
    const open = call({ messages: [ai(1, "recorded", { parts: ["card"], tools: [running] })] });
    const next = reduce(open, { type: "row-changed", threadId: "t1", ts: 1, change });
    return [change.kind, next?.messages[0].parts];
  });

  expect(survived).toEqual(changes.map((c) => [c.kind, ["card"]]));
  // Directly too: the registry's copy is patched by this function alone.
  expect(applyRowChange(ai(1, "recorded", { parts: ["card"] }), { kind: "answer", text: "a" }).parts).toEqual([
    "card",
  ]);
});

test("what only the surface knows about the row survives its images arriving", () => {
  const open = call({ messages: [user(1, "look"), ai(2, "recorded", { parts: ["card"] })] });
  const images = new Map([[2, [{ data: "AAA", mediaType: "image/png" as const }]]]);
  const next = reduce(open, { type: "images-loaded", threadId: "t1", images });

  expect(next?.messages[1].parts).toEqual(["card"]);
  expect(next?.messages[1].images).toEqual([{ data: "AAA", mediaType: "image/png" }]);
});

// The registry's copy of the row and the one on screen are patched separately;
// they stay in step only because one function applies the change to both.
test("a change nothing matches hands the row back untouched", () => {
  const row = ai(1, "text", { tools: [{ name: "a", label: "A", state: "running" }] });

  expect(applyRowChange(row, { kind: "tool-end", name: "other", isError: false })).toBe(row);
  expect(applyRowChange(row, { kind: "tool-label", name: "other", label: "x" })).toBe(row);
});

// --- what the open call leaves open ---------------------------------------
//
// Two levels, decided by the door (docs/09). These are the answers the top bar
// draws its two dim buttons from.

const LESSON = { isBook: true };
const ASIDE = { aside: { parentThreadId: "lesson" } };
// A page mark's own conversation, opened with no lesson running. Not a side
// conversation, and still a first level.
const MARK_THREAD = {};

test("with nothing open, both doors are live", () => {
  expect(levelGate(null)).toEqual({ aiPen: null, bookThread: null });
  expect(levelGate(undefined)).toEqual({ aiPen: null, bookThread: null });
});

test("in the book's conversation the AI pen is live and the blackboard is not", () => {
  const gate = levelGate(LESSON);

  expect(gate.aiPen).toBeNull();
  expect(gate.bookThread).not.toBeNull();
});

test("in a side conversation neither door opens, and each says a different why", () => {
  const gate = levelGate(ASIDE);

  expect(gate.aiPen).not.toBeNull();
  expect(gate.bookThread).not.toBeNull();
  // The book's conversation is already open behind this one, which is not the
  // same thing as it being on screen.
  expect(gate.bookThread).not.toBe(levelGate(LESSON).bookThread);
});

test("a page mark's own conversation opens no side one, but the blackboard still opens", () => {
  const gate = levelGate(MARK_THREAD);

  expect(gate.aiPen).toBe(levelGate(ASIDE).aiPen);
  expect(gate.bookThread).toBeNull();
});

test("every dim button says why in a sentence of its own", () => {
  const lines = [levelGate(ASIDE).aiPen, levelGate(ASIDE).bookThread, levelGate(LESSON).bookThread];

  for (const line of lines) {
    expect(line).toMatch(/^[A-Z].*\.$/);
  }
  expect(new Set(lines).size).toBe(3);
});

test("the rack acts with no pen where the AI pen is dim, and with it where it is not", () => {
  expect(toolInCall("ai", LESSON)).toBe("ai");
  expect(toolInCall("ai", null)).toBe("ai");
  expect(toolInCall("ai", ASIDE)).toBe("none");
  expect(toolInCall("ai", MARK_THREAD)).toBe("none");
});

// Held, not cleared: the reader who steps into a side conversation and back gets
// the pen they were holding, and the other two are never taken off them.
test("the AI pen comes back on the way out, and the other tools are never touched", () => {
  // One pick, read twice: nothing wrote it back to "none" on the way in.
  const picked = "ai";
  expect(toolInCall(picked, ASIDE)).toBe("none");
  expect(toolInCall(picked, LESSON)).toBe("ai");
  for (const tool of ["none", "navlock", "highlight", "underline"] as const) {
    expect(toolInCall(tool, ASIDE)).toBe(tool);
    expect(toolInCall(tool, LESSON)).toBe(tool);
  }
});
