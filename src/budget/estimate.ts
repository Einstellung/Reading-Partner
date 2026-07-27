// How many tokens an assembled call occupies, and how many the provider will
// then let the model emit. Pure: no network, no credentials, no provider lookup.
//
// Why this module exists. pi clamps maxTokens on every request to
// `contextWindow - its own estimate of the context - 4096`, floored at 1. A
// floored clamp is silent: the model emits one token, stops with stopReason
// "length", and the stream still ends with a normal `done` event. In chat that
// reads as a one-word reply; anywhere a JSON answer is parsed it reads as a
// formatting error. Nothing in the failure names the context window. The only
// defence is to compute the same number pi does, before sending.
//
// Two estimates, and we plan against the larger:
//
//   - pi's own, reverse-solved out of clampMaxTokensToContext (see piBudget).
//     Using pi's number means we can never be in the position of thinking a call
//     fits while pi thinks it does not.
//   - a script-aware one. pi charges chars/4 for every script, which under-counts
//     CJK by 2.5-4x, so it waves through exactly the contexts that need holding
//     back. estimateTextTokens charges dense scripts by the character.

import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
import type { Api, Context, ImageContent, Message, Model, TextContent } from "@earendil-works/pi-ai";

// The window pi reserves on every request (its CONTEXT_SAFETY_TOKENS). Mirrored
// rather than imported because pi does not export it; tests/budget/estimate.test.ts
// pins the mirror, so a pi upgrade that moves the margin turns that test red.
export const PI_CONTEXT_SAFETY_TOKENS = 4096;

// pi's floor for the clamp. An allowance of exactly this means "pi's estimate has
// already reached the window", not "one token is genuinely left".
const PI_MIN_MAX_TOKENS = 1;

// Characters one token holds, by script. Estimates, not measurements: real
// tokenizers run CJK at roughly 1-1.7 chars/token and Latin prose near 4. Both
// are pinned at the pessimistic end deliberately. An estimate that is too high
// only costs a call some optional context; an estimate that is too low lets the
// silent truncation through, which is the failure this module exists to stop.
const DENSE_CHARS_PER_TOKEN = 1;
const SPARSE_CHARS_PER_TOKEN = 4;

// What one image block costs. Mirrors pi's stand-in of 4800 characters, so the
// two estimates price a picture the same way.
const IMAGE_TOKENS = 1200;

// Code units that tokenize densely: CJK ideographs and their punctuation, kana,
// hangul, fullwidth forms, and every surrogate — the astral planes hold rare
// ideographs and emoji, both expensive per character.
function isDense(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x11ff) || // hangul jamo
    (c >= 0x2e80 && c <= 0x303f) || // CJK radicals, symbols and punctuation
    (c >= 0x3040 && c <= 0x30ff) || // kana
    (c >= 0x3130 && c <= 0x318f) || // hangul compatibility jamo
    (c >= 0x3400 && c <= 0x4dbf) || // ideographs extension A
    (c >= 0x4e00 && c <= 0x9fff) || // ideographs
    (c >= 0xa960 && c <= 0xa97f) || // hangul jamo extended-A
    (c >= 0xac00 && c <= 0xd7ff) || // hangul syllables + extended-B
    (c >= 0xd800 && c <= 0xdfff) || // surrogates (astral planes)
    (c >= 0xf900 && c <= 0xfaff) || // compatibility ideographs
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK compatibility forms
    (c >= 0xff00 && c <= 0xffef) // halfwidth and fullwidth forms
  );
}

// Script-aware token estimate for one string.
export function estimateTextTokens(text: string): number {
  let dense = 0;
  for (let i = 0; i < text.length; i++) {
    if (isDense(text.charCodeAt(i))) dense++;
  }
  const sparse = text.length - dense;
  return Math.ceil(dense / DENSE_CHARS_PER_TOKEN + sparse / SPARSE_CHARS_PER_TOKEN);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function contentTokens(content: string | (TextContent | ImageContent)[]): number {
  if (typeof content === "string") return estimateTextTokens(content);
  let n = 0;
  for (const block of content) {
    n += block.type === "text" ? estimateTextTokens(block.text) : IMAGE_TOKENS;
  }
  return n;
}

export function estimateMessageTokens(message: Message): number {
  if (message.role === "user" || message.role === "toolResult") return contentTokens(message.content);
  let n = 0;
  for (const block of message.content) {
    if (block.type === "text") n += estimateTextTokens(block.text);
    else if (block.type === "thinking") n += estimateTextTokens(block.thinking);
    else n += estimateTextTokens(block.name) + estimateTextTokens(safeJson(block.arguments));
  }
  return n;
}

// Script-aware estimate for a whole call: system prompt, tool schemas, messages.
// Unlike pi this never short-circuits to a previous response's reported usage —
// that shortcut is what makes pi's number the better one when the provider has
// already counted the prefix, which is why callers take the max of the two.
export function estimateContextTokens(ctx: Context): number {
  let n = ctx.systemPrompt ? estimateTextTokens(ctx.systemPrompt) : 0;
  if (ctx.tools && ctx.tools.length > 0) n += estimateTextTokens(safeJson(ctx.tools));
  for (const message of ctx.messages) n += estimateMessageTokens(message);
  return n;
}

export interface PiBudget {
  // pi's own estimate of the context, in tokens.
  tokens: number;
  // What pi will clamp maxTokens to: contextWindow - tokens - 4096, floored at 1.
  allowedOutput: number;
  // The clamp bottomed out, so `tokens` is only a lower bound and the request as
  // it stands would come back one token long with no error attached.
  saturated: boolean;
}

// pi's estimate, read back out of the only public function that exposes it.
// clampMaxTokensToContext returns `max(1, contextWindow - estimate - 4096)`
// capped by the requested maxTokens, so asking for MAX_SAFE_INTEGER leaves the
// estimate as the only unknown. Models with no declared window (contextWindow
// <= 0) are exempt from pi's clamp entirely, and reported as unbounded here.
export function piBudget(model: Model<Api>, ctx: Context): PiBudget {
  if (model.contextWindow <= 0) {
    return { tokens: 0, allowedOutput: Number.MAX_SAFE_INTEGER, saturated: false };
  }
  const allowedOutput = clampMaxTokensToContext(model, ctx, Number.MAX_SAFE_INTEGER);
  return {
    tokens: model.contextWindow - allowedOutput - PI_CONTEXT_SAFETY_TOKENS,
    allowedOutput,
    saturated: allowedOutput <= PI_MIN_MAX_TOKENS,
  };
}

// Output tokens left for a context of `used` tokens, after pi's safety margin.
// Never negative; a model with no declared window is unbounded.
export function outputAllowance(contextWindow: number, used: number): number {
  if (contextWindow <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, contextWindow - used - PI_CONTEXT_SAFETY_TOKENS);
}

export interface ContextBudget {
  contextWindow: number;
  // What the call is planned against: the larger of the two estimates, so a
  // Chinese book is never planned as if it were English.
  used: number;
  allowedOutput: number;
  pi: PiBudget;
  scriptAware: number;
}

export function contextBudget(model: Model<Api>, ctx: Context): ContextBudget {
  const pi = piBudget(model, ctx);
  const scriptAware = estimateContextTokens(ctx);
  const used = Math.max(pi.tokens, scriptAware);
  return {
    contextWindow: model.contextWindow,
    used,
    allowedOutput: outputAllowance(model.contextWindow, used),
    pi,
    scriptAware,
  };
}

// What a call is for, which decides how much room its answer needs.
export type BudgetPurpose = "chat" | "chapter-note" | "digest" | "overview" | "plan";

// The smallest output allowance each kind of call may be sent with. Below it the
// call is not sent as assembled: the reply comes back clamped, with a normal
// `done` and no error, and downstream reads it as a bad answer rather than as a
// context overflow.
export const OUTPUT_FLOOR: Record<BudgetPurpose, number> = {
  chat: 4096,
  "chapter-note": 4096,
  digest: 8192,
  overview: 16384,
  plan: 16384,
};

export function fitsBudget(budget: ContextBudget, purpose: BudgetPurpose): boolean {
  return budget.allowedOutput >= OUTPUT_FLOOR[purpose];
}

// The same gate for a caller that already knows its token count and window and
// has no pi Context to hand (the whole-input tasks price their material directly).
export function fitsAllowance(contextWindow: number, used: number, purpose: BudgetPurpose): boolean {
  return outputAllowance(contextWindow, used) >= OUTPUT_FLOOR[purpose];
}
