// What gets given up when a call does not fit its model's context window, and in
// what order. Pure planning: the ladder is handed the size of each thing that
// could go and returns the list to drop; the caller owns the actual assembly.
//
// The mechanism is here; the rungs are not. What a reading turn can give up is
// not what a retell can, and both lists are written in the reader's own
// words, so each domain declares its own ladder (src/reading/ladder.ts,
// src/reading/retell/ladder.ts) and hands it in. This file knows nothing about
// books, notes or retells.
//
// The rule an order is expected to encode: touch evidence and you say so, drop
// redundancy and you keep quiet, and when neither is enough you refuse rather
// than quietly answer a different question from a sample of the material. A rung
// with a `notice` is one the reader is told about; a rung without one goes
// silently, and that absence is the whole of what makes it silent.

import { OUTPUT_FLOOR, outputAllowance, type BudgetPurpose } from "./estimate";
import type { Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";

// How a rung's saving is measured when fitToBudget prices the ladder (fit.ts).
// Data rather than a callback so a ladder stays a table.
//
//   "prompt"   recompose the system prompt without it. The default.
//   "bulk"     the same, but the rung is held out of the baseline the "prompt"
//              rungs are priced against, and measured as what the full prompt
//              loses by dropping only it. For material an order of magnitude
//              bigger than the rest, so the small rungs are not measured against
//              a prompt that carries it.
//   "messages" recompose the replayed messages without it.
//   "none"     never priced at assembly time — the rung is applied somewhere
//              else (tool results are stubbed inside the agent loop). It stays
//              on the ladder because its position is what says when it happens.
export type RungPrice = "prompt" | "bulk" | "messages" | "none";

export interface Rung<Id extends string> {
  id: Id;
  // The clause this rung contributes to the note at the end of the reply. Absent
  // for the rungs that go silently.
  notice?: string;
  price?: RungPrice;
}

// Said when even the material that cannot be dropped does not leave the model
// room to answer. There is nothing to retry: the same call would be assembled
// again and clamped again.
export const REFUSE_FLOOR_OVER =
  "This material is too large for me to work through in one pass. Ask about a narrower part of it and I can.";

// Said when the ladder ran out of rungs with irreducible material still over the
// line. Same conclusion, different cause.
export const REFUSE_EXHAUSTED =
  "Even after setting aside everything optional, this doesn't fit the model's context window. Ask about a narrower part of it and I can.";

export interface LadderInput<Id extends string> {
  // The rungs, in the order they are given up.
  rungs: readonly Rung<Id>[];
  contextWindow: number;
  purpose: BudgetPurpose;
  // Tokens the call occupies as assembled.
  used: number;
  // Tokens the tier-0 material occupies: everything not on the ladder.
  floorTokens: number;
  // Tokens each rung would free. Missing, zero or negative means the rung has
  // nothing to give on this call and is skipped.
  savings: Partial<Record<Id, number>>;
}

export interface LadderPlan<Id extends string> {
  // The rungs to apply, in order.
  apply: Id[];
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
export function budgetNotice<Id extends string>(
  rungs: readonly Rung<Id>[],
  applied: readonly Id[],
): string {
  const byId = new Map(rungs.map((r) => [r.id, r]));
  const clauses = applied.map((id) => byId.get(id)?.notice).filter((n): n is string => !!n);
  return clauses.length === 0 ? "" : `Note: ${clauses.join("; ")}.`;
}

// Walk the ladder until the call fits, or run out of rungs and refuse.
export function planReductions<Id extends string>(input: LadderInput<Id>): LadderPlan<Id> {
  const floor = OUTPUT_FLOOR[input.purpose];
  const fits = (used: number) => outputAllowance(input.contextWindow, used) >= floor;

  const apply: Id[] = [];
  let used = input.used;
  let freed = 0;

  if (!fits(used)) {
    for (const rung of input.rungs) {
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
    return {
      apply,
      freed,
      allowedOutput,
      outcome: "ok",
      notice: budgetNotice(input.rungs, apply),
      refusal: "",
    };
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

// --- tool results turned into stubs ---

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
