// One reading-companion turn (M6/M9, docs/03, docs/09, docs/14, docs/21,
// docs/24), as the reader's session asks for it: system prompt, tool set and
// replayed history for the AI-pen bubble and the book-level thread.
//
// The assembly itself is no longer here. What a book contributes to a call is
// reading/desk.ts, what the soul contributes is src/soul, and putting
// the two together is one function every domain now shares (docs/61). This file
// is what is left of the old entry point: it lays the desk — the open book, and
// the articles the reader kept beside it — asks for a turn, and hands the answer
// back in the shape the session has always taken it.
//
// Pure assembly plus reads — it never touches React state and never starts the
// stream; the caller owns runAgentTurn.

import type { AgentTool } from "../ai/agent";
import { assembleTurn } from "../soul";
import { deskKindRegistered, openDesk, type DeskEnv } from "../desk";
import { EXPLAIN_KICKOFF } from "./intents";
import type { InlineMode } from "./lecture";
import {
  registerReadingDesk,
  BOOK_KIND,
  SAVED_ARTICLES_KIND,
  type BookDeskRef,
  type ReadingTurnMessage,
} from "./desk";
import type { SavedArticleStore } from "./saved-article-tools";
import type { Settings } from "../platform/app/settings";

// The opening ask on a marked passage (reading/intents.ts), re-exported here
// because this is where every caller has always imported it from. Nothing sends
// it unprompted any more — the reader picks it off a chip — but it is still the
// stand-in first user message the desk composes.
export { EXPLAIN_KICKOFF };
// The book's own vocabulary, still reached through this module: the retell and
// coach turns fit their history to the same caps, and the session hook types its
// context with these.
export {
  gatherTopicMaterials,
  HISTORY_KEEP,
  HISTORY_KEEP_TIGHT,
  TRIM_DISTILL_MIN_NEW,
  type PageRenderFn,
  type ReadingTurnContext,
  type ReadingTurnMessage,
  type RenderedPage,
} from "./desk";
// The configured model's metadata, now that every turn is fitted by the same
// assembly. Re-exported because the retell and coach turns still ask for it
// here (reading/retell/turn.ts, reading/rehearsal/coach-turn.ts).
export { configuredModel } from "../soul";

export interface ReadingTurnInput extends BookDeskRef {
  settings: Settings;
  // The store of articles the reader kept on the info side (docs/21). Injected so
  // the assembly runs with no AppData.
  savedArticles?: SavedArticleStore;
  // The turn's abort signal. It drops the assembly when the reader has already
  // moved on, and it is the signal the research sub-agent runs under, so hanging
  // up mid-search kills the run rather than leaving it fetching in the background.
  signal?: AbortSignal;
}

export interface ReadingTurn {
  systemPrompt: string;
  tools: AgentTool[];
  messages: ReadingTurnMessage[];
  // How much of the book this turn actually inlined (docs/09). What the caller
  // reports as telemetry, so it is what the assembly settled on and not what it
  // set out to do: a turn taken before extraction finishes inlines nothing
  // however big the window is.
  inline: InlineMode;
  // A low-key line for the end of the reply, naming what this turn had to leave
  // out, or "" when nothing was dropped that the user has a stake in.
  notice: string;
  // Set when the turn cannot be assembled small enough to leave the model room
  // to answer. Show this instead of sending; retrying changes nothing, since the
  // same inputs assemble the same call.
  refusal: string;
}

// Why a turn produced no reply. The distinction the UI has to make is not what
// went wrong but what a second press would change.
//
//   "refusal" — the turn was declined for a reason it can state: it did not fit
//     the model's window (before sending, or after growing mid-flight), or the
//     loop went round and round without answering. Every request that went out
//     was answered; nothing was unreachable.
//   "error" — the call itself did not complete: no network, a rejected key, a
//     provider failure. The reason is outside the conversation, so it may well
//     be gone by the next press.
export type TurnFailure = "refusal" | "error";

export interface TurnFailureView {
  // What the row says, in full.
  text: string;
  // Where that sentence goes on the row. "reply" stands in for the answer that
  // never came: it takes the row's text and is drawn as a failure. "notice" is
  // the app talking about a turn that reached the model and came back without
  // one; it sits beside the row's text rather than in it, and so is never
  // replayed as the assistant's own words next turn (turn-rows.ts).
  as: "reply" | "notice";
  // The toast to raise, or null for none. A refusal raises none: it is already
  // sitting where the reply would be, and a red banner over it would say the
  // opposite of what it says.
  toast: string | null;
  // Whether to offer Retry. False for a refusal — the same inputs are declined
  // the same way, so the button would only promise a second identical stop.
  retry: boolean;
}

// One place deciding how a turn that produced no reply is shown, so the two
// refusal paths (declined before sending, declined mid-loop) cannot drift apart
// or drift into the error path's wording.
export function turnFailureView(kind: TurnFailure, message: string): TurnFailureView {
  if (kind === "refusal") return { text: message, as: "notice", toast: null, retry: false };
  return {
    text: `⚠️ Couldn't reach the model. ${message}`,
    as: "reply",
    toast: "AI reply failed",
    retry: true,
  };
}

// The same failure, for a turn whose conversation is no longer on screen: it
// kept running after the bubble was closed (docs/03), so the row it writes is
// nowhere to be seen and a toast is the only place left to say so. Named by the
// marked passage, since several threads can be running at once.
export function backgroundFailureToast(kind: TurnFailure, markedText: string): string {
  const trimmed = markedText.trim().replace(/\s+/g, " ");
  const where = trimmed ? `“${trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed}”` : "a closed conversation";
  return kind === "refusal" ? `AI reply stopped on ${where}` : `AI reply failed on ${where}`;
}

// Lay the desk and assemble one turn from it. Returns null when the signal
// aborts while the book is being opened (the caller has already been
// superseded).
export async function buildReadingTurn(input: ReadingTurnInput): Promise<ReadingTurn | null> {
  // The shell registers reading's openers when it boots (useShellBootstrap). A
  // turn assembled without one — the first one in a test, or a path that never
  // went through a shell — registers them on the way in rather than failing on
  // a desk this module owns anyway.
  if (!deskKindRegistered(BOOK_KIND)) registerReadingDesk();
  const { settings, signal, savedArticles, ...book } = input;
  const env: DeskEnv = {
    settings,
    topic: { id: input.context.topicId, name: input.context.topicName },
    thread: { key: input.bookId, id: input.threadId },
    ...(signal ? { signal } : {}),
  };
  // The book first, the kept articles beside it: the order they lie in is the
  // order their paragraphs come out in.
  const desk = await openDesk(
    [
      { kind: BOOK_KIND, ref: book },
      {
        kind: SAVED_ARTICLES_KIND,
        ref: {
          bookId: input.bookId,
          getPipeline: input.getPipeline,
          ...(savedArticles ? { savedArticles } : {}),
        },
      },
    ],
    env,
  );
  // The book opening into nothing is the abort: there is no turn to assemble
  // about a desk the reader has already walked away from.
  if (!desk.items.some((i) => i.kind === BOOK_KIND)) return null;
  const assembled = await assembleTurn({ desk });
  if (!assembled) return null;
  return {
    systemPrompt: assembled.systemPrompt,
    tools: assembled.tools,
    messages: assembled.messages,
    inline: (assembled.report.inline as InlineMode | undefined) ?? "none",
    notice: assembled.notice,
    refusal: assembled.refusal,
  };
}
