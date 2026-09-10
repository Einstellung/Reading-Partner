// Searching every conversation the app holds, across all four kinds of thread
// file (docs/61): a book's chats, a retell's, a talk's, a day's briefing.
//
// The scope is a topic, and it widens rather than fails: what the reader said
// about attention while reading one book is the same reader, and a search that
// answered "nothing in this topic" while the answer sat one topic over would be
// the cross-topic hole memory/observations/recall.ts already had to close. The
// caller is told which scope the hits came from, so the model can say so.
//
// Term presence, not BM25 (docs/48 leaves the ranking open): the whole store is
// a few dozen files and a rank over a corpus this size buys nothing a term count
// does not. Rewriting this as retrieval proper is expected, which is why the
// tools return anchors rather than a summary — what the model gets back is a
// pointer into the transcript, and that survives changing how the pointer is
// found.
//
// A thread id is only unique within its file (docs/pitfall/209): the onboarding
// conversation carries the same id in every threads-info-<date>.json there is.
// So a hit is keyed by the file as well as the thread, nothing here builds an
// index by thread id, and two days' onboarding threads are two conversations.

import { appConversationIo, threadFileName, type ConversationIo } from "./io";
import { memoizeIo, walkThreadFiles } from "./walk";
import { messageTerms, queryTerms } from "./tokens";
import { threadKindOf, topicOfThreadFile, type ThreadKind, type TopicCarrier } from "./topic-of";

// Enough for the model to see the shape of what it found without spending the
// window on it; anything it wants in full it reads with read_conversation.
const MAX_HITS = 12;
const SNIPPET_RADIUS = 90;
const DEFAULT_SPAN = 8;
const MAX_SPAN = 40;
// One message of a returned excerpt. Long enough for a whole turn of ordinary
// conversation, short enough that a pasted article body cannot fill the window.
const MAX_MESSAGE_CHARS = 2000;

export interface ConversationHit {
  /** The thread file's store key: what read_conversation takes back. */
  fileKey: string;
  threadId: string;
  kind: ThreadKind;
  topicId: string | null;
  messageId?: string;
  ts: number;
  role: "user" | "ai";
  /**
   * The message, in the anchor form memory/observations/anchors.ts writes and
   * resolves: the id joined to "<threadId>:<ts>" by "@", or the pair alone for a
   * message written before ids existed.
   */
  anchor: string;
  snippet: string;
  /** How many of the query's terms this message holds. */
  score: number;
}

export interface SearchScope {
  /** The topic to look in first. Null searches everything from the start. */
  topicId: string | null;
  /** Whether a scoped search that found nothing may fall back to the library. */
  widen: boolean;
}

export interface SearchResult {
  hits: ConversationHit[];
  /** True when these hits came from the library because the topic held none. */
  widened: boolean;
}

// The anchor for a message. Written here rather than imported so this capability
// keeps to palace and platform/app; the form is the one anchors.ts owns and the
// tests hold the two together.
function anchorOf(id: string | undefined, threadId: string, ts: number): string {
  const pair = `${threadId}:${ts}`;
  return id ? `${id}@${pair}` : pair;
}

function snippetAround(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + SNIPPET_RADIUS);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * Every message matching the query, ranked by how many of its terms they hold
 * and, at equal score, by how recent they are.
 *
 * The whole store is scanned whatever the scope, because a hit carries the topic
 * it came from and the widening has to know whether the library holds anything
 * at all. Two dozen files of a few hundred messages; the cost is one read each.
 */
export async function searchConversations(
  query: string,
  scope: SearchScope,
  io: ConversationIo = appConversationIo,
): Promise<SearchResult> {
  const terms = queryTerms(query);
  if (terms.length === 0) return { hits: [], widened: false };
  const disk = memoizeIo(io);
  const all: ConversationHit[] = [];
  for await (const file of walkThreadFiles(disk)) {
    const { fileKey, kind } = file;
    for (const thread of file.threads) {
      const topicId = await topicOfThreadFile(fileKey, disk, thread as TopicCarrier);
      for (const message of thread.messages ?? []) {
        const text = message.text ?? "";
        if (text === "") continue;
        const held = messageTerms(text);
        const score = terms.reduce((n, term) => n + (held.has(term) ? 1 : 0), 0);
        if (score === 0) continue;
        all.push({
          fileKey,
          threadId: thread.id,
          kind,
          topicId,
          messageId: message.id,
          ts: message.ts,
          role: message.role,
          anchor: anchorOf(message.id, thread.id, message.ts),
          snippet: snippetAround(text, terms),
          score,
        });
      }
    }
  }
  const scoped = scope.topicId === null ? all : all.filter((h) => h.topicId === scope.topicId);
  const widened = scope.topicId !== null && scope.widen && scoped.length === 0 && all.length > 0;
  const chosen = widened ? all : scoped;
  chosen.sort((a, b) => b.score - a.score || b.ts - a.ts);
  return { hits: chosen.slice(0, MAX_HITS), widened };
}

export interface ExcerptLine {
  role: "user" | "ai";
  ts: number;
  anchor: string;
  text: string;
}

export interface ConversationExcerpt {
  fileKey: string;
  threadId: string;
  kind: ThreadKind;
  topicId: string | null;
  lines: ExcerptLine[];
  /** Messages of this thread before and after the excerpt. */
  before: number;
  after: number;
}

export interface ReadConversationInput {
  fileKey: string;
  threadId: string;
  /** The message to centre on. The tail of the thread when absent. */
  aroundTs?: number;
  span?: number;
}

/**
 * A stretch of one conversation, verbatim. Null when the file holds no thread
 * by that id — which, for a thread id that repeats across files
 * (docs/pitfall/209), is a question only the file key can answer.
 */
export async function readConversation(
  input: ReadConversationInput,
  io: ConversationIo = appConversationIo,
): Promise<ConversationExcerpt | null> {
  const kind = threadKindOf(threadFileName(input.fileKey));
  if (!kind) return null;
  const thread = (await io.peekThreads(input.fileKey)).find((t) => t.id === input.threadId);
  if (!thread) return null;
  const messages = thread.messages ?? [];
  const span = Math.max(1, Math.min(MAX_SPAN, Math.trunc(input.span ?? DEFAULT_SPAN)));
  let start = Math.max(0, messages.length - span);
  if (input.aroundTs !== undefined && messages.length > 0) {
    // The nearest message rather than an exact stamp: an anchor's ts names the
    // turn it was written from, and a caller passing one off a hit of a
    // neighbouring message should still land in the right stretch.
    let centre = 0;
    let best = Infinity;
    messages.forEach((m, i) => {
      const away = Math.abs(m.ts - input.aroundTs!);
      if (away < best) {
        best = away;
        centre = i;
      }
    });
    start = Math.max(0, Math.min(messages.length - span, centre - Math.floor(span / 2)));
    if (start < 0) start = 0;
  }
  const end = Math.min(messages.length, start + span);
  const lines = messages.slice(start, end).map((m) => {
    const text = m.text ?? "";
    return {
      role: m.role,
      ts: m.ts,
      anchor: anchorOf(m.id, thread.id, m.ts),
      text: text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text,
    };
  });
  return {
    fileKey: input.fileKey,
    threadId: thread.id,
    kind,
    topicId: await topicOfThreadFile(input.fileKey, io, thread as TopicCarrier),
    lines,
    before: start,
    after: messages.length - end,
  };
}
