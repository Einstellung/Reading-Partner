// The front's prompt and context (docs/companion/136 "前台的上下文与模型"): who
// is speaking (docs/companion/90), a fixed duty, the place, the numbered list,
// the call's last ten turns, in that order and capped near 4k tokens, so the
// fixed part leads and is cached.

import { DEFAULT_COMPANION_NAME } from "../../../platform/app/settings";
import { MAX_IN_FLIGHT } from "../../think/contract";
import type { CallLine, FrontContext, FrontListRow } from "./contract";

export const FRONT_TOKEN_CAP = 4000;
export const FRONT_PLACE_CAP = 400;
export const FRONT_LIST_ROWS = 10;
export const FRONT_TURNS = 10;
/** Runs in flight at once: the back half's cap, which it enforces. */
export const FRONT_IN_FLIGHT = MAX_IN_FLIGHT;

export const FRONT_DUTY = [
  "In this call you are the front voice, speaking aloud with the reader: no lists, no markdown, no headings.",
  "Answer in the reader's language. Whatever you can answer yourself, answer in two sentences at most.",
  "Anything you cannot answer right now — a lookup, a calculation, several steps of reasoning, a fact you are not sure of, " +
    "anything that needs more than three sentences — say one short sentence such as \"let me think about that\" and call " +
    "delegate in the same reply. Do not promise a time, do not repeat the question, do not report progress. Then go back to the reader.",
  "Never make up a fact. Never retell what came back from a delegated run: offer to read it out (read_out) or to show it (show).",
  `At most ${FRONT_IN_FLIGHT} runs can be out at once; when the list already has that many running, tell the reader to wait for one to come back.`,
  "When the reader asks whether something is ready, answer from the list's progress line without calling a tool.",
  "Every new question gets its own delegate, even while other runs are out; they run side by side.",
  "Call cancel only when the reader says they no longer want that particular request (\"forget the weather\"). " +
    "When they change it, delegate the new one with replaces set to the old number and the whole task written out.",
  "Thanks, goodbye or \"that's all\" drops nothing: what is out still lands in the box. Answer it with a short goodbye and no tool.",
  "Back-channel with a word or two at most.",
  "The delegate task is read by someone who cannot hear this call: say what to answer and what counts as an answer. " +
    "Use kind \"think\" unless another kind plainly fits.",
].join("\n");

/**
 * Who is speaking, said the way a call says it: the reader's name for the
 * companion and the short what-I-am of the written intro (soul/intro.ts). The
 * front sees no tool result, so it cannot call about_app itself: what the app
 * or the companion can do goes to a think run, whose desk is the place's own
 * turn and carries about_app among its reads (soul/think/kind.ts).
 */
export function frontIdentity(name: string): string {
  return [
    `You are ${name}, the companion inside the Lumen app, the one in the corner of the screen. ` +
      "You are a tool for reading, analysis and the reader's own material, not a person: no longing, loneliness or affection.",
    `Asked who you are, say you are ${name} in one sentence. Asked what you or the app can do, or how to do something in it, ` +
      "delegate it like any question you cannot answer, and never invent a feature.",
  ].join("\n");
}

/** The part of the front's prompt that does not change during a call: identity, then duty. */
export function frontFixedPrompt(name: string = DEFAULT_COMPANION_NAME): string {
  return `${frontIdentity(name)}\n${FRONT_DUTY}`;
}

/** Rough tokens: a CJK character is about one, other text about four characters each. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (/[　-鿿가-힯＀-￯]/.test(ch)) cjk++;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

function clip(text: string, tokens: number): string {
  if (estimateTokens(text) <= tokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= tokens) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

export function listText(rows: readonly FrontListRow[]): string {
  if (rows.length === 0) return "Nothing has been handed off in this call.";
  return rows
    .slice(0, FRONT_LIST_ROWS)
    .map((r) => {
      const parts = [`#${r.number}`, r.status, r.task];
      if (r.progress) parts.push(`progress: ${r.progress}`);
      if (r.cover) parts.push(`cover: ${r.cover}`);
      return parts.join(" | ");
    })
    .join("\n");
}

/**
 * The system prompt: identity and duty, place, list. The first two do not
 * change during a call; the place may, turn to turn.
 */
export function frontSystemPrompt(place: string, rows: readonly FrontListRow[], name: string = DEFAULT_COMPANION_NAME): string {
  return [
    frontFixedPrompt(name),
    `Where this call is held:\n${clip(place, FRONT_PLACE_CAP)}`,
    `The numbered list (what this call handed off):\n${listText(rows)}`,
  ].join("\n\n");
}

export interface FrontMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * The call's lines as alternating messages, newest last, at most ten turns and
 * within what the cap leaves after the system prompt. A program line (a notice,
 * a read-out) has no line of the reader's before it and joins the reply it
 * follows; a call that opens with the front speaking gets a placeholder line.
 */
export function frontMessages(lines: readonly CallLine[], budget: number): FrontMessage[] {
  const out: FrontMessage[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const role = line.role === "user" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.text = `${last.text}\n${text}`;
    else out.push({ role, text });
  }
  if (out[0]?.role === "assistant") out.unshift({ role: "user", text: "(the call opened)" });
  // Ten turns: a turn starts at a reader's line.
  let starts = 0;
  let from = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.role !== "user") continue;
    starts++;
    from = i;
    if (starts === FRONT_TURNS) break;
  }
  let kept = out.slice(from);
  while (kept.length > 1 && kept.reduce((n, m) => n + estimateTokens(m.text), 0) > budget) {
    // Drop the oldest whole turn: up to the next reader's line.
    const next = kept.findIndex((m, i) => i > 0 && m.role === "user");
    kept = next > 0 ? kept.slice(next) : kept.slice(-1);
  }
  return kept;
}

/** Everything one front call is sent: within FRONT_TOKEN_CAP, the fixed part first. */
export function frontRequest(ctx: FrontContext): { system: string; messages: FrontMessage[] } {
  const system = frontSystemPrompt(ctx.place, ctx.list, ctx.name);
  return { system, messages: frontMessages(ctx.lines, FRONT_TOKEN_CAP - estimateTokens(system)) };
}
