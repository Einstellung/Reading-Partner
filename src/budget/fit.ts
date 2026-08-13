// Fitting one assembled call to its model's context window: price the ladder,
// walk it, and hand back the prompt and messages that fit, plus what to tell the
// reader about it.
//
// This is the shape both turn assemblies had written out longhand and in
// duplicate (reading/turn.ts, reading/talks/turn.ts). What differs between them
// is the ladder and how the two halves of the call are composed, so those come
// in: the ladder as a table, the composition as two closures. Nothing under src/
// is imported here — budget stays a leaf, and the domains keep their own prompt
// building.

import { contextBudget, estimateContextTokens, estimateTextTokens, fitsBudget } from "./estimate";
import type { BudgetPurpose } from "./estimate";
import { planReductions, type Rung } from "./ladder";
import type { Api, Context, Message, Model, TSchema } from "@earendil-works/pi-ai";

// A tool as the budget sees it: only the three fields that go on the wire and
// therefore cost tokens. Structural on purpose, so budget does not import ai/.
export interface ToolShape {
  name: string;
  description: string;
  parameters: TSchema;
}

export interface FitInput<Id extends string, M> {
  model: Model<Api>;
  tools: readonly ToolShape[];
  // The two halves of the call, as a function of what this turn had to give up.
  // Called several times: once per rung to price it, then once more if the plan
  // applies anything. Both must be pure.
  composePrompt(dropped: ReadonlySet<Id>): string;
  composeMessages(dropped: ReadonlySet<Id>): M[];
  // The domain's messages in pi's shape, for the estimator. Injected rather than
  // imported: the conversion lives in ai/providers and carries a pitfall of its
  // own (docs/pitfall/64).
  toPi(messages: M[]): Message[];
  rungs: readonly Rung<Id>[];
  purpose: BudgetPurpose;
  // Rungs this particular call has nothing to gain from, or must not take: a
  // figure catalog the conversation has already cited [fig:N] from cannot go
  // without leaving the reference dangling, and a rung whose material this turn
  // never assembled would cost a full re-render to price at zero.
  skip?: ReadonlySet<Id>;
}

export interface FittedCall<M> {
  systemPrompt: string;
  messages: M[];
  // What this turn had to leave out, or "" when nothing the reader has a stake
  // in was dropped.
  notice: string;
  // Set when the call cannot be made small enough to leave the model room to
  // answer. Show this instead of sending; retrying changes nothing.
  refusal: string;
}

// Assemble at full size, and only if that is over the line pay for the pricing
// passes. Left unchecked an over-full request comes back one token long with a
// normal `done` and no error (docs/pitfall/65), so the check is not optional —
// but it is also not free, and a call that fits must not pay for it.
export function fitToBudget<Id extends string, M>(input: FitInput<Id, M>): FittedCall<M> {
  const { model, tools, composePrompt, composeMessages, toPi, rungs, purpose, skip } = input;

  const none: ReadonlySet<Id> = new Set<Id>();
  let systemPrompt = composePrompt(none);
  let messages = composeMessages(none);

  const piContext = (prompt: string, msgs: M[]): Context => ({
    systemPrompt: prompt,
    messages: toPi(msgs),
    tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  });

  const budget = contextBudget(model, piContext(systemPrompt, messages));
  if (fitsBudget(budget, purpose)) return { systemPrompt, messages, notice: "", refusal: "" };

  // The bulk rungs are held out of the baseline whether or not this call can
  // take them, so the small rungs are always measured against the same prompt.
  const bulk = new Set<Id>(rungs.filter((r) => r.price === "bulk").map((r) => r.id));
  const baseTokens = estimateTextTokens(composePrompt(bulk));
  const fullTokens = estimateTextTokens(systemPrompt);
  const messageTokens = estimateContextTokens({ messages: toPi(messages) });

  const price = (rung: Rung<Id>): number => {
    switch (rung.price ?? "prompt") {
      case "bulk":
        return Math.max(0, fullTokens - estimateTextTokens(composePrompt(new Set([rung.id]))));
      case "messages":
        return Math.max(
          0,
          messageTokens -
            estimateContextTokens({ messages: toPi(composeMessages(new Set([rung.id]))) }),
        );
      default:
        return Math.max(
          0,
          baseTokens - estimateTextTokens(composePrompt(new Set([...bulk, rung.id]))),
        );
    }
  };

  const savings: Partial<Record<Id, number>> = {};
  for (const rung of rungs) {
    if (skip?.has(rung.id) || (rung.price ?? "prompt") === "none") continue;
    savings[rung.id] = price(rung);
  }

  let total = 0;
  for (const rung of rungs) total += savings[rung.id] ?? 0;
  const plan = planReductions({
    rungs,
    contextWindow: budget.contextWindow,
    purpose,
    used: budget.used,
    floorTokens: budget.used - total,
    savings,
  });
  if (plan.apply.length > 0) {
    const dropped = new Set(plan.apply);
    systemPrompt = composePrompt(dropped);
    messages = composeMessages(dropped);
  }
  return { systemPrompt, messages, notice: plan.notice, refusal: plan.refusal };
}
