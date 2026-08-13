// Fitting an assembled call to a model's window (src/budget/fit.ts): when the
// ladder gets priced at all, how each kind of rung is priced, and what comes
// back. The two turn assemblies drive this; here it is driven directly, with
// prompt and message composition stubbed to sizes chosen by the test.
// Run: bun test.

import { expect, test } from "bun:test";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import { fitToBudget } from "../../src/budget/fit";
import type { Rung } from "../../src/budget/ladder";

const WINDOW = 200_000;
// Latin text at 4 chars a token, so a section's size in characters is four
// times its size in tokens and the arithmetic below is readable.
const CHARS_PER_TOKEN = 4;

function model(contextWindow = WINDOW): Model<Api> {
  return { id: "m", name: "m", contextWindow, maxTokens: 64_000 } as unknown as Model<Api>;
}

type Id = "small" | "huge" | "elsewhere" | "history";

const RUNGS: readonly Rung<Id>[] = [
  { id: "small" },
  { id: "huge", price: "bulk", notice: "the big thing went" },
  { id: "elsewhere", price: "none" },
  { id: "history", price: "messages", notice: "the conversation was cut" },
];

interface Msg {
  role: "user" | "ai";
  text: string;
}

const toPi = (messages: Msg[]): Message[] =>
  messages.map((m) => ({ role: "user", content: m.text, timestamp: 0 }) as unknown as Message);

// A prompt of a fixed floor plus one block per rung still in play, each block
// sized in tokens by the caller. Records every composition so a test can say how
// many were paid for.
function harness(sizes: {
  floor: number;
  small: number;
  huge: number;
  messages?: number;
  messagesTight?: number;
}) {
  const prompts: ReadonlySet<Id>[] = [];
  const messageSets: ReadonlySet<Id>[] = [];
  const block = (tag: string, tokens: number) => tag.repeat(tokens * CHARS_PER_TOKEN);
  return {
    prompts,
    messageSets,
    composePrompt(dropped: ReadonlySet<Id>): string {
      prompts.push(dropped);
      return [
        block("f", sizes.floor),
        dropped.has("small") ? "" : block("s", sizes.small),
        dropped.has("huge") ? "" : block("h", sizes.huge),
      ].join("");
    },
    composeMessages(dropped: ReadonlySet<Id>): Msg[] {
      messageSets.push(dropped);
      const tokens = dropped.has("history")
        ? sizes.messagesTight ?? 100
        : sizes.messages ?? 500;
      return [{ role: "user", text: block("m", tokens) }];
    },
  };
}

function fit(sizes: Parameters<typeof harness>[0], contextWindow = WINDOW) {
  const h = harness(sizes);
  const out = fitToBudget<Id, Msg>({
    model: model(contextWindow),
    tools: [],
    composePrompt: h.composePrompt,
    composeMessages: h.composeMessages,
    toPi,
    rungs: RUNGS,
    purpose: "chat",
  });
  return { ...out, h };
}

// Pricing the ladder means composing the prompt once per rung. A call that fits
// must not pay for that, and the only way to see it is to count the calls.
test("a call that fits is assembled once and priced not at all", () => {
  const r = fit({ floor: 1_000, small: 100, huge: 10_000 });
  expect(r.notice).toBe("");
  expect(r.refusal).toBe("");
  expect(r.h.prompts.length).toBe(1);
  expect(r.h.messageSets.length).toBe(1);
  // Everything is still in the prompt it hands back.
  expect(r.systemPrompt).toContain("s");
  expect(r.systemPrompt).toContain("h");
});

// Over the line, the cheapest rung goes first; it owes no clause, so nothing is
// said. The prompt that comes back is the recomposed one, not the full one.
test("the first rung that makes it fit is the one taken, and the prompt is recomposed", () => {
  // Over the line by 2,000 tokens, and the small block is worth exactly that.
  const r = fit({ floor: 141_000, small: 2_000, huge: 50_000 });
  expect(r.refusal).toBe("");
  expect(r.notice).toBe("");
  expect(r.systemPrompt).not.toContain("s");
  expect(r.systemPrompt).toContain("h");
});

// A "bulk" rung is priced against the full prompt rather than the baseline the
// small rungs are measured against, and it carries a clause.
test("the bulk rung is reached when the small one is not enough, and it is spoken for", () => {
  const r = fit({ floor: 155_000, small: 3_000, huge: 40_000 });
  expect(r.refusal).toBe("");
  expect(r.notice).toBe("Note: the big thing went.");
  expect(r.systemPrompt).not.toContain("h");
});

// The bulk rung is held out of the baseline the "prompt" rungs are priced
// against. Without that, a prompt whose small section grows in the bulk rung's
// presence prices the small rung by what it is worth *with* the book still
// inlined — a number that stops being true the moment the book goes.
test("a small rung is priced against a prompt that does not carry the bulk one", () => {
  const seen: ReadonlySet<Id>[] = [];
  fitToBudget<Id, Msg>({
    model: model(),
    tools: [],
    composePrompt: (dropped) => {
      seen.push(dropped);
      return "f".repeat(800_000);
    },
    composeMessages: () => [{ role: "user", text: "m" }],
    toPi,
    rungs: RUNGS,
    purpose: "chat",
  });
  // The baseline, then the small rung on top of it: both carry "huge".
  const baseline = seen[1];
  const smallPriced = seen[2];
  expect([...baseline]).toEqual(["huge"]);
  expect([...smallPriced].sort()).toEqual(["huge", "small"]);
});

// A "none" rung is applied somewhere else entirely (the agent loop stubs tool
// results mid-turn), so it must never be composed for, never priced, and never
// end up in the plan.
test("a rung priced 'none' is never composed for and never applied", () => {
  const r = fit({ floor: 155_000, small: 3_000, huge: 40_000 });
  for (const dropped of r.h.prompts) expect(dropped.has("elsewhere")).toBe(false);
});

// The history rung is measured off the messages, not the prompt: composing the
// prompt without it would price it at zero and it would never be taken.
test("the history rung is priced off the messages and trims them when taken", () => {
  const r = fit({
    floor: 187_000,
    small: 500,
    huge: 500,
    messages: 6_000,
    messagesTight: 1_000,
  });
  expect(r.refusal).toBe("");
  expect(r.notice).toBe("Note: the big thing went; the conversation was cut.");
  expect(r.messages[0].text.length).toBe(1_000 * CHARS_PER_TOKEN);
  expect(r.h.messageSets.some((d) => d.has("history"))).toBe(true);
});

// Nothing on the ladder can save a floor that is over the line by itself, and
// the refusal comes back instead of a shrunken call.
test("a floor larger than the window is refused, not shrunk", () => {
  const r = fit({ floor: 300_000, small: 1_000, huge: 1_000 });
  expect(r.notice).toBe("");
  expect(r.refusal).toContain("too large for me to work through in one pass");
});

// Rungs the caller rules out are not priced and not taken: the reference this
// call would leave dangling is worth more than the tokens it would free.
test("a skipped rung is left alone even when it would have made the call fit", () => {
  const h = harness({ floor: 155_000, small: 3_000, huge: 40_000 });
  const out = fitToBudget<Id, Msg>({
    model: model(),
    tools: [],
    composePrompt: h.composePrompt,
    composeMessages: h.composeMessages,
    toPi,
    rungs: RUNGS,
    purpose: "chat",
    skip: new Set<Id>(["small"]),
  });
  expect(out.systemPrompt).toContain("s");
  expect(out.notice).toBe("Note: the big thing went.");
});

// A model whose metadata declares no window is exempt from pi's clamp, so there
// is nothing to fit to and nothing to give up.
test("a model with no declared window is left whole", () => {
  const r = fit({ floor: 5_000_000, small: 1_000, huge: 1_000 }, 0);
  expect(r.notice).toBe("");
  expect(r.refusal).toBe("");
  expect(r.h.prompts.length).toBe(1);
});
