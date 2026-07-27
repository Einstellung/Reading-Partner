// Context budgeting: the estimate and the output-allowance gate
// (src/budget/estimate.ts). Pure — no provider, no network. Run: bun test.

import { expect, test } from "bun:test";
import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import {
  contextBudget,
  estimateContextTokens,
  estimateTextTokens,
  fitsAllowance,
  fitsBudget,
  outputAllowance,
  piBudget,
  OUTPUT_FLOOR,
  PI_CONTEXT_SAFETY_TOKENS,
} from "../../src/budget/estimate";

function model(contextWindow: number): Model<Api> {
  return { id: "m", name: "m", contextWindow, maxTokens: 64000 } as unknown as Model<Api>;
}

function ctx(over: Partial<Context> = {}): Context {
  return { messages: [], ...over };
}

function user(text: string): Context["messages"][number] {
  return { role: "user", content: text, timestamp: 0 };
}

// This is the load-bearing assumption of the whole module: pi's estimate is
// readable only through its clamp, and the clamp is
//   max(1, contextWindow - estimate - CONTEXT_SAFETY_TOKENS).
// The relationship is not documented. Pinning it here means a pi upgrade that
// moves the safety margin, the chars-per-token heuristic or the floor fails
// loudly instead of quietly making every budget wrong.
test("pi's context estimate is exactly recoverable from clampMaxTokensToContext", () => {
  const m = model(200_000);
  // 40,000 ASCII chars of system prompt + 400 of user text: pi charges chars/4,
  // so 10,000 + 100 tokens.
  const c = ctx({ systemPrompt: "x".repeat(40_000), messages: [user("y".repeat(400))] });

  const allowed = clampMaxTokensToContext(m, c, Number.MAX_SAFE_INTEGER);
  expect(allowed).toBe(200_000 - 10_100 - PI_CONTEXT_SAFETY_TOKENS);

  const pi = piBudget(m, c);
  expect(pi.tokens).toBe(10_100);
  expect(pi.allowedOutput).toBe(allowed);
  expect(pi.saturated).toBe(false);
});

test("piBudget reports saturation when the clamp bottoms out", () => {
  const m = model(200_000);
  // 196,000 tokens of prompt: pi allows 200000 - 196000 - 4096 < 0 -> floored
  // at 1. This is the failure that emits one token and calls it a success.
  const pi = piBudget(m, ctx({ systemPrompt: "x".repeat(4 * 196_000) }));
  expect(pi.allowedOutput).toBe(1);
  expect(pi.saturated).toBe(true);
});

test("a model with no declared window is exempt from the clamp", () => {
  const pi = piBudget(model(0), ctx({ systemPrompt: "x".repeat(4000) }));
  expect(pi.saturated).toBe(false);
  expect(outputAllowance(0, 1_000_000)).toBe(Number.MAX_SAFE_INTEGER);
});

test("estimateTextTokens charges CJK by the character and Latin by four", () => {
  expect(estimateTextTokens("")).toBe(0);
  expect(estimateTextTokens("x".repeat(4000))).toBe(1000);
  expect(estimateTextTokens("张".repeat(1000))).toBe(1000);
  // Mixed: 800 CJK + 400 ASCII -> 800 + 100.
  expect(estimateTextTokens("张".repeat(800) + "y".repeat(400))).toBe(900);
  // Full-width punctuation and kana count as dense too.
  expect(estimateTextTokens("，。、「」")).toBe(5);
  expect(estimateTextTokens("ひらがな")).toBe(4);
});

test("a Chinese book is priced 2.5-4x above pi's chars/4", () => {
  // The shape of the user's own library: 84.9% CJK by character.
  const chars = 221_328;
  const cjk = Math.round(chars * 0.849);
  const body = "张".repeat(cjk) + "a".repeat(chars - cjk);
  const c = ctx({ systemPrompt: body });

  const pi = piBudget(model(200_000), c);
  const scriptAware = estimateContextTokens(c);
  expect(pi.tokens).toBe(Math.ceil(chars / 4));
  expect(scriptAware / pi.tokens).toBeGreaterThan(3);

  // pi sees 55k tokens and a comfortable 140k of room; the script-aware number
  // sees a book that leaves nothing to answer with. This gap is the whole point:
  // pi waves through the one call that has no chance of producing a reply.
  expect(pi.saturated).toBe(false);
  expect(pi.allowedOutput).toBeGreaterThan(100_000);
  expect(outputAllowance(200_000, scriptAware)).toBe(0);
  expect(fitsBudget(contextBudget(model(200_000), c), "chat")).toBe(false);
});

test("contextBudget plans against the larger of the two estimates", () => {
  const m = model(200_000);
  // Latin: the two agree, and pi's number wins by a rounding hair at most.
  const latin = contextBudget(m, ctx({ systemPrompt: "x ".repeat(20_000) }));
  expect(Math.abs(latin.used - latin.pi.tokens)).toBeLessThan(latin.used * 0.1);

  // CJK: the script-aware number takes over.
  const cjk = contextBudget(m, ctx({ systemPrompt: "张".repeat(60_000) }));
  expect(cjk.pi.tokens).toBe(15_000);
  expect(cjk.used).toBe(60_000);
  expect(cjk.allowedOutput).toBe(200_000 - 60_000 - PI_CONTEXT_SAFETY_TOKENS);
});

test("tool schemas and images are part of the estimate", () => {
  const tools = [
    { name: "read_pages", description: "d".repeat(400), parameters: { type: "object" } },
  ] as unknown as NonNullable<Context["tools"]>;
  expect(estimateContextTokens(ctx({ tools }))).toBeGreaterThan(100);

  const withImage = ctx({
    messages: [
      { role: "user", content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: 0 },
    ],
  });
  // Priced the same as pi's 4800-character stand-in.
  expect(estimateContextTokens(withImage)).toBe(1200);
});

test("assistant turns count text, thinking and tool-call arguments", () => {
  const c = ctx({
    messages: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "a".repeat(400) },
          { type: "thinking", thinking: "b".repeat(400), thinkingSignature: "" },
          { type: "toolCall", id: "1", name: "read_pages", arguments: { from: 1, to: 10 } },
        ],
      } as unknown as Context["messages"][number],
      {
        role: "toolResult",
        toolCallId: "1",
        toolName: "read_pages",
        content: [{ type: "text", text: "张".repeat(500) }],
        isError: false,
        timestamp: 0,
      },
    ],
  });
  // 100 + 100 for the two prose blocks, the tool call's name and JSON, and 500
  // for the Chinese page text.
  expect(estimateContextTokens(c)).toBeGreaterThan(700);
});

test("the output floor gates the call before it is sent", () => {
  const m = model(200_000);
  // 190,000 tokens in: 5,904 of output allowed. Enough for chat, not for a plan.
  const tight = contextBudget(m, ctx({ systemPrompt: "x".repeat(4 * 190_000) }));
  expect(tight.allowedOutput).toBe(5_904);
  expect(fitsBudget(tight, "chat")).toBe(true);
  expect(fitsBudget(tight, "digest")).toBe(false);
  expect(fitsBudget(tight, "overview")).toBe(false);

  // 196,000 tokens in: pi allows 1. Nothing may be sent.
  const over = contextBudget(m, ctx({ systemPrompt: "x".repeat(4 * 196_000) }));
  expect(over.pi.saturated).toBe(true);
  expect(over.allowedOutput).toBe(0);
  for (const purpose of Object.keys(OUTPUT_FLOOR) as (keyof typeof OUTPUT_FLOOR)[]) {
    expect(fitsBudget(over, purpose)).toBe(false);
  }
});

test("fitsAllowance gates a caller that only has numbers", () => {
  expect(fitsAllowance(200_000, 100_000, "plan")).toBe(true);
  expect(fitsAllowance(200_000, 180_000, "plan")).toBe(false);
  expect(fitsAllowance(200_000, 180_000, "chat")).toBe(true);
  expect(fitsAllowance(0, 5_000_000, "plan")).toBe(true);
});
