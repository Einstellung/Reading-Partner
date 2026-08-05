// What gets given up when a call does not fit its model's context window, and in
// what order. Pure planning: the ladder is handed the size of each thing that
// could go and returns the list to drop; the caller owns the actual assembly.
//
// The rule the order encodes: touch evidence and you say so, drop redundancy and
// you keep quiet, and when neither is enough you refuse rather than quietly
// answer a different question from a sample of the material.
//
//   tier 0  never dropped, so it is not on the ladder at all: the role and
//           instructions, the current user message, the marked passage and the
//           user's note on it, the current position, the tool schemas already
//           offered this turn, and the last two rounds of conversation.
//   tier 1  redundancy. Nothing the model could not derive or fetch, so it goes
//           silently.
//   tier 2  still silent, because a tool can fetch it back — the stub says so.
//   tier 3  evidence. Dropped only as a last resort, and the reply carries a
//           line saying what was left out.

import { OUTPUT_FLOOR, outputAllowance, type BudgetPurpose } from "./estimate";
import type { Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";

export type ReductionId =
  | "figure-catalog"
  | "reader-profile"
  | "notes-overview"
  | "booklist-thin"
  | "memory-trim"
  | "rehearsal-notes"
  | "tool-result-stubs"
  | "classroom-inline"
  | "rehearsal-marks"
  | "history-trim";

interface Rung {
  id: ReductionId;
  // The clause this rung contributes to the note at the end of the reply. Absent
  // for the rungs that go silently, which is what makes them silent.
  notice?: string;
}

// The order things are given up in. First to go is the cheapest to lose.
export const LADDER: readonly Rung[] = [
  // tier 1: redundancy.
  { id: "figure-catalog" },
  { id: "reader-profile" },
  { id: "notes-overview" },
  { id: "booklist-thin" },
  { id: "memory-trim" },
  // tier 2: gone from the prompt, still reachable by a tool, and the stub says so.
  // The rehearsal's inlined chapter note goes before the tool results: the model
  // asked for those and is working from them, while the note was put in front of
  // it unasked and read_chapter_note fetches it straight back.
  { id: "rehearsal-notes" },
  { id: "tool-result-stubs" },
  // tier 3: evidence.
  {
    id: "classroom-inline",
    notice: "the book didn't fit in context, so I read the pages I needed instead of having all of it in view",
  },
  // The reader's own marks, in the one mode where they are the material rather
  // than a hint (docs/31). Trimmed, not dropped: a rehearsal with no marks in
  // front of it stops being a rehearsal of *their* reading, so what goes is the
  // long tail of each chapter and the length of each quote. It never co-occurs
  // with classroom-inline — the two modes are mutually exclusive — so their
  // order relative to each other is not a judgement about the two.
  {
    id: "rehearsal-marks",
    notice: "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again",
  },
  // Last, below even the inlined book, because of what it costs: the fallback
  // distillation meant to capture an older stretch of a thread before it falls
  // out of context is fired and forgotten (src/reading/turn.ts), so nothing
  // guarantees it has landed by the time the trim happens. Cutting history is a
  // straight loss of the conversation, not a compaction of it.
  { id: "history-trim", notice: "earlier turns of this conversation were left out to make room" },
];

const BY_ID = new Map(LADDER.map((r) => [r.id, r]));

// Said when even the material that cannot be dropped does not leave the model
// room to answer. There is nothing to retry: the same call would be assembled
// again and clamped again.
export const REFUSE_FLOOR_OVER =
  "This material is too large for me to work through in one pass. Ask about a narrower part of it and I can.";

// Said when the ladder ran out of rungs with irreducible material still over the
// line. Same conclusion, different cause.
export const REFUSE_EXHAUSTED =
  "Even after setting aside everything optional, this doesn't fit the model's context window. Ask about a narrower part of it and I can.";

export interface LadderInput {
  contextWindow: number;
  purpose: BudgetPurpose;
  // Tokens the call occupies as assembled.
  used: number;
  // Tokens the tier-0 material occupies: everything not on the ladder.
  floorTokens: number;
  // Tokens each rung would free. Missing, zero or negative means the rung has
  // nothing to give on this call and is skipped.
  savings: Partial<Record<ReductionId, number>>;
}

export interface LadderPlan {
  // The rungs to apply, in order.
  apply: ReductionId[];
  freed: number;
  // The output allowance the plan leaves.
  allowedOutput: number;
  // "ok" — fits as assembled, or fits after `apply`.
  // "refuse" — nothing left to give. Do not retry; assembly is deterministic.
  outcome: "ok" | "refuse";
  // One low-key line for the end of the reply, or "" when only redundancy went.
  notice: string;
  // What to tell the user instead of answering, or "" when outcome is "ok".
  refusal: string;
}

// Compose the end-of-reply note for the rungs that owe the user one. Exported
// so a caller applying a rung outside the planner (the agent loop stubs tool
// results mid-turn) can produce the same wording.
export function budgetNotice(applied: readonly ReductionId[]): string {
  const clauses = applied.map((id) => BY_ID.get(id)?.notice).filter((n): n is string => !!n);
  return clauses.length === 0 ? "" : `Note: ${clauses.join("; ")}.`;
}

// Walk the ladder until the call fits, or run out of rungs and refuse.
export function planReductions(input: LadderInput): LadderPlan {
  const floor = OUTPUT_FLOOR[input.purpose];
  const fits = (used: number) => outputAllowance(input.contextWindow, used) >= floor;

  const apply: ReductionId[] = [];
  let used = input.used;
  let freed = 0;

  if (!fits(used)) {
    for (const rung of LADDER) {
      const saving = input.savings[rung.id] ?? 0;
      if (saving <= 0) continue;
      apply.push(rung.id);
      used -= saving;
      freed += saving;
      if (fits(used)) break;
    }
  }

  const allowedOutput = outputAllowance(input.contextWindow, used);
  if (allowedOutput >= floor) {
    return { apply, freed, allowedOutput, outcome: "ok", notice: budgetNotice(apply), refusal: "" };
  }
  // Nothing more to give. Which of the two refusals applies is about cause, not
  // remedy: both mean this call cannot be made as asked.
  return {
    apply,
    freed,
    allowedOutput,
    outcome: "refuse",
    notice: "",
    refusal: fits(input.floorTokens) ? REFUSE_EXHAUSTED : REFUSE_FLOOR_OVER,
  };
}

// --- tier 2: tool results turned into stubs ---

// How many of the most recent tool results stay whole; everything older becomes
// a stub. Enough to keep what the model just fetched and is working from.
export const TOOL_RESULTS_KEPT = 4;

function argSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const parts: string[] = [];
  if (typeof args.slug === "string") parts.push(args.slug);
  if (typeof args.material === "string") parts.push(args.material);
  if (typeof args.query === "string") parts.push(`"${args.query}"`);
  const from = Number(args.from);
  const to = Number(args.to);
  if (Number.isFinite(from) && Number.isFinite(to)) {
    parts.push(`${Math.min(from, to)}-${Math.max(from, to)}`);
  } else if (Number.isFinite(from)) {
    parts.push(String(from));
  }
  if (typeof args.id === "string" || typeof args.id === "number") parts.push(String(args.id));
  return parts.join(" ");
}

// The line that stands in for a dropped tool result. It names the call and its
// size and says the model may make it again, so the model can tell "I read this
// and it did not help" from "I read this and it is no longer in front of me".
export function toolResultStub(
  name: string,
  args: Record<string, unknown> | undefined,
  chars: number,
  images = 0,
): string {
  const where = argSummary(args);
  const size = `${chars.toLocaleString("en-US")} chars`;
  const pics = images > 0 ? `, ${images} image${images === 1 ? "" : "s"}` : "";
  return `[${name}${where ? ` ${where}` : ""}: ${size}${pics}, dropped to fit; call again if needed]`;
}

export interface StubbedMessages {
  messages: Message[];
  // How many results were replaced.
  stubbed: number;
  // Characters removed. Token savings are the caller's estimator to compute.
  charsFreed: number;
}

// Replace the bodies of all but the last `keep` tool results with stubs. The
// message keeps its role, toolCallId, toolName and error flag so the sequence
// stays valid for every provider — only the payload goes.
export function stubEarlyToolResults(messages: Message[], keep = TOOL_RESULTS_KEPT): StubbedMessages {
  const argsById = new Map<string, Record<string, unknown>>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const block of m.content) {
      if (block.type === "toolCall") argsById.set((block as ToolCall).id, (block as ToolCall).arguments);
    }
  }

  const resultIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) if (messages[i].role === "toolResult") resultIndexes.push(i);
  const stubUpTo = resultIndexes.length - keep;
  if (stubUpTo <= 0) return { messages, stubbed: 0, charsFreed: 0 };
  const toStub = new Set(resultIndexes.slice(0, stubUpTo));

  let stubbed = 0;
  let charsFreed = 0;
  const out = messages.map((m, i) => {
    if (!toStub.has(i)) return m;
    const result = m as ToolResultMessage;
    let chars = 0;
    let images = 0;
    for (const block of result.content) {
      if (block.type === "text") chars += block.text.length;
      else images++;
    }
    const text = toolResultStub(result.toolName, argsById.get(result.toolCallId), chars, images);
    // A result already smaller than its own stub is left alone: swapping it
    // would cost tokens and lose the answer.
    if (images === 0 && chars <= text.length) return m;
    stubbed++;
    charsFreed += chars - text.length;
    return { ...result, content: [{ type: "text" as const, text }] };
  });

  return { messages: out, stubbed, charsFreed };
}
