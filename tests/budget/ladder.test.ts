// The compression ladder: what gets given up, in what order, what the user is
// told, and when the call is refused instead (src/budget/ladder.ts). Pure.
// Run: bun test.

import { expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { PI_CONTEXT_SAFETY_TOKENS } from "../../src/budget/estimate";
import {
  budgetNotice,
  planReductions,
  stubEarlyToolResults,
  toolResultStub,
  LADDER,
  REFUSE_EXHAUSTED,
  REFUSE_FLOOR_OVER,
  type LadderInput,
  type ReductionId,
} from "../../src/budget/ladder";

const WINDOW = 200_000;
// Chat needs 4096 of output, so a call fits at or below this many tokens.
const FITS_AT = WINDOW - PI_CONTEXT_SAFETY_TOKENS - 4096;

// Every rung available and worth 5,000 tokens, so the order is the only thing
// that decides which ones get used.
const EVEN: Record<ReductionId, number> = {
  "figure-catalog": 5_000,
  "reader-profile": 5_000,
  "notes-overview": 5_000,
  "booklist-thin": 5_000,
  "observation-trim": 5_000,
  "rehearsal-notes": 5_000,
  "tool-result-stubs": 5_000,
  "classroom-inline": 5_000,
  "rehearsal-marks": 5_000,
  "history-trim": 5_000,
};

function plan(over: Partial<LadderInput> = {}) {
  return planReductions({
    contextWindow: WINDOW,
    purpose: "chat",
    used: FITS_AT,
    floorTokens: 10_000,
    savings: EVEN,
    ...over,
  });
}

test("a call that fits gives up nothing and says nothing", () => {
  const p = plan({ used: 50_000 });
  expect(p.apply).toEqual([]);
  expect(p.outcome).toBe("ok");
  expect(p.notice).toBe("");
  expect(p.refusal).toBe("");
});

test("the ladder stops at the first rung that makes the call fit", () => {
  const p = plan({ used: FITS_AT + 1 });
  expect(p.apply).toEqual(["figure-catalog"]);
  expect(p.freed).toBe(5_000);
  expect(p.outcome).toBe("ok");
  // Redundancy went, so there is nothing to tell the user.
  expect(p.notice).toBe("");
});

test("rungs are given up in the declared order, cheapest loss first", () => {
  const p = plan({ used: FITS_AT + 22_000 });
  expect(p.apply).toEqual([
    "figure-catalog",
    "reader-profile",
    "notes-overview",
    "booklist-thin",
    "observation-trim",
  ]);
  expect(p.outcome).toBe("ok");
  expect(p.notice).toBe("");
});

test("tool-result stubs come after every silent drop and before any evidence", () => {
  const p = plan({ used: FITS_AT + 31_000 });
  expect(p.apply[p.apply.length - 1]).toBe("tool-result-stubs");
  expect(p.apply).not.toContain("classroom-inline");
  expect(p.notice).toBe("");
});

// The rehearsal's inlined chapter note is tier 2 like the tool results: read_chapter_note
// fetches it straight back, so it goes without a word, and it goes before the
// results the model asked for itself.
test("the rehearsal's chapter note goes silently, ahead of the tool results", () => {
  const p = plan({ used: FITS_AT + 26_000 });
  expect(p.apply[p.apply.length - 1]).toBe("rehearsal-notes");
  expect(p.apply).not.toContain("tool-result-stubs");
  expect(p.notice).toBe("");
});

test("dropping the inlined book is told to the user", () => {
  const p = plan({ used: FITS_AT + 36_000 });
  expect(p.apply).toContain("classroom-inline");
  expect(p.apply).not.toContain("history-trim");
  expect(p.notice).toBe(
    "Note: the book didn't fit in context, so I read the pages I needed instead of having all of it in view.",
  );
});

// The reader's own marks are evidence, so shortening them is said out loud — and
// the line says how to get them back, because read_annotations really can.
test("shortening the reader's marks is told to the user", () => {
  const p = plan({ used: FITS_AT + 41_000 });
  expect(p.apply[p.apply.length - 1]).toBe("rehearsal-marks");
  expect(p.apply).not.toContain("history-trim");
  expect(p.notice).toContain("your highlights are shortened here to fit");
});

// history-trim is last on purpose: the fallback distillation that is supposed to
// preserve an older stretch of thread is fired and forgotten, so a trim before
// it lands is a straight loss of the conversation.
test("history is the last thing given up, and it is told to the user", () => {
  const p = plan({ used: FITS_AT + 46_000 });
  expect(p.apply[p.apply.length - 1]).toBe("history-trim");
  expect(p.notice).toBe(
    "Note: the book didn't fit in context, so I read the pages I needed instead of having all of it in view; " +
      "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again; " +
      "earlier turns of this conversation were left out to make room.",
  );
});

test("rungs with nothing to give are skipped, not counted", () => {
  const p = plan({
    used: FITS_AT + 6_000,
    savings: { "figure-catalog": 0, "reader-profile": 5_000, "notes-overview": 5_000 },
  });
  expect(p.apply).toEqual(["reader-profile", "notes-overview"]);
  expect(p.freed).toBe(10_000);
});

test("a call whose untouchable part alone is over is refused, not shrunk", () => {
  const p = plan({ used: FITS_AT + 100_000, floorTokens: FITS_AT + 50_000, savings: EVEN });
  expect(p.outcome).toBe("refuse");
  expect(p.refusal).toBe(REFUSE_FLOOR_OVER);
  expect(p.notice).toBe("");
});

test("a call still over after every rung is refused with the other reason", () => {
  const p = plan({ used: FITS_AT + 100_000, floorTokens: 10_000, savings: EVEN });
  expect(p.apply.length).toBe(LADDER.length);
  expect(p.outcome).toBe("refuse");
  expect(p.refusal).toBe(REFUSE_EXHAUSTED);
});

test("a bigger output floor moves the line", () => {
  // 5,000 tokens of room left: plenty for a chat reply, not enough for a plan.
  const used = WINDOW - PI_CONTEXT_SAFETY_TOKENS - 5_000;
  const args = { contextWindow: WINDOW, used, floorTokens: 1_000, savings: {} };
  expect(planReductions({ ...args, purpose: "chat" }).apply).toEqual([]);
  expect(planReductions({ ...args, purpose: "plan" }).outcome).toBe("refuse");
  // With something to give, the same plan call reduces its way back over the line.
  const reduced = planReductions({ ...args, purpose: "plan", savings: EVEN });
  expect(reduced.outcome).toBe("ok");
  expect(reduced.apply).toEqual(["figure-catalog", "reader-profile", "notes-overview"]);
});

test("a model with no declared window never triggers the ladder", () => {
  const p = plan({ contextWindow: 0, used: 5_000_000 });
  expect(p.apply).toEqual([]);
  expect(p.outcome).toBe("ok");
});

test("budgetNotice only speaks for the rungs that owe an explanation", () => {
  expect(budgetNotice([])).toBe("");
  expect(budgetNotice(["figure-catalog", "observation-trim", "tool-result-stubs"])).toBe("");
  expect(budgetNotice(["history-trim"])).toBe(
    "Note: earlier turns of this conversation were left out to make room.",
  );
});

// --- tool result stubs ---

test("toolResultStub names the call, its size, and that it can be made again", () => {
  expect(toolResultStub("read_pages", { from: 49, to: 40 }, 8200)).toBe(
    "[read_pages 40-49: 8,200 chars, dropped to fit; call again if needed]",
  );
  expect(toolResultStub("search_topic", { query: "turkey problem" }, 1200)).toBe(
    '[search_topic "turkey problem": 1,200 chars, dropped to fit; call again if needed]',
  );
  expect(toolResultStub("read_paper", { slug: "smith2023", from: 3, to: 8 }, 900)).toBe(
    "[read_paper smith2023 3-8: 900 chars, dropped to fit; call again if needed]",
  );
  expect(toolResultStub("view_figure", { id: "3" }, 40, 1)).toBe(
    "[view_figure 3: 40 chars, 1 image, dropped to fit; call again if needed]",
  );
  expect(toolResultStub("mystery", undefined, 10)).toBe(
    "[mystery: 10 chars, dropped to fit; call again if needed]",
  );
});

function call(id: string, name: string, args: Record<string, unknown>): Message {
  return { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] } as unknown as Message;
}

function result(id: string, name: string, text: string): Message {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  };
}

test("stubbing keeps the message sequence valid and the recent results whole", () => {
  const messages: Message[] = [];
  for (let i = 0; i < 6; i++) {
    messages.push(call(`c${i}`, "read_pages", { from: i * 10, to: i * 10 + 9 }));
    messages.push(result(`c${i}`, "read_pages", "p".repeat(8200)));
  }

  const out = stubEarlyToolResults(messages, 2);
  expect(out.stubbed).toBe(4);
  expect(out.charsFreed).toBeGreaterThan(30_000);
  expect(out.messages.length).toBe(messages.length);

  const results = out.messages.filter((m) => m.role === "toolResult");
  // Identity survives: role, toolCallId and toolName are what make the batch legal.
  expect(results.map((m) => (m as { toolCallId: string }).toolCallId)).toEqual([
    "c0",
    "c1",
    "c2",
    "c3",
    "c4",
    "c5",
  ]);
  const text = (m: Message) => ((m as { content: { text?: string }[] }).content[0].text ?? "");
  expect(text(results[0])).toBe("[read_pages 0-9: 8,200 chars, dropped to fit; call again if needed]");
  expect(text(results[3])).toBe("[read_pages 30-39: 8,200 chars, dropped to fit; call again if needed]");
  expect(text(results[4]).length).toBe(8200);
  expect(text(results[5]).length).toBe(8200);
  // The input array is untouched.
  expect(text(messages[1]).length).toBe(8200);
});

test("stubbing leaves a result already smaller than its own stub alone", () => {
  const messages: Message[] = [
    call("c0", "read_pages", { from: 1, to: 1 }),
    result("c0", "read_pages", "nothing there"),
    call("c1", "read_pages", { from: 2, to: 2 }),
    result("c1", "read_pages", "x".repeat(5000)),
  ];
  const out = stubEarlyToolResults(messages, 1);
  expect(out.stubbed).toBe(0);
  expect(out.charsFreed).toBe(0);
});

test("stubbing is a no-op when there is nothing older than the keep window", () => {
  const messages: Message[] = [call("c0", "read_pages", { from: 1, to: 9 }), result("c0", "read_pages", "x".repeat(9000))];
  const out = stubEarlyToolResults(messages, 4);
  expect(out.stubbed).toBe(0);
  expect(out.messages).toBe(messages);
});
