// Distillation (docs/02 part 2, write side): a silent sub-agent run over a
// finished conversation's transcript that curates the topic's observations
// through the observation tools. Triggered on hangup, with a fallback when the
// replayed history is trimmed (see live.ts / App).
//
// This was the codebase's first isolated silent run and predates the capability
// that now describes the shape (docs/25). It runs on `runSubagent` for the three
// things it used to lack: a failed pass says so instead of being swallowed, a
// pass can be cancelled, and the one thing that crosses back out of the run —
// the model's final text — has a cap on it rather than happening to be harmless.
//
// The turn is still injected (SubagentTurnFn), so every test here runs with no
// provider, no credentials and no network.

import type { AgentTool } from "../ai/agent";
import {
  runSubagent,
  type SubagentDefinition,
  type SubagentModel,
  type SubagentOutcome,
  type SubagentTurnFn,
} from "../ai/subagent";
import type { ObservationAdapter } from "./adapter";
import { isoDate } from "./files";
import type { ObservationMeta } from "./store";
import { buildObservationTools, type ObservationWriteAction } from "./tools";

export interface DistillMessage {
  role: "user" | "ai";
  text: string;
  ts: number;
}

// A mark the reader made on the book, reduced for distillation. Most are made
// silently (no conversation); the distiller looks for a pattern across them.
export interface DistillAnnotation {
  id: string;
  page: number | null; // 1-based
  text: string; // selected passage
  comment?: string; // the reader's note, if any
  createdAt: number; // ms epoch, for the "since last distillation" filter
}

export interface DistillInput {
  topicName: string;
  bookName: string;
  threadId: string;
  annotationId: string;
  page: number | null; // 1-based, where the thread's mark sits
  markedText: string;
  messages: DistillMessage[];
  // The current observation index (what "update, don't duplicate" checks against).
  indexText: string;
  today: string; // YYYY-MM-DD, so the model writes absolute dates
  // The reader's silent marks since the last distillation, already filtered and
  // capped by selectSilentMarks. Empty (or absent) when there are none.
  silentMarks?: DistillAnnotation[];
  // True when the marks were capped, so the prompt says the list is partial.
  silentMarksCapped?: boolean;
}

// Trim a mark snippet so a long highlight doesn't blow up the prompt.
function clip(text: string, max = 160): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

// The reader's marks created strictly after `since` (null = all), keeping only
// ones with text or a note, newest first, capped. `cursor` is where the caller
// moves the book's mark cursor to once the pass finishes. Pure — unit-tested.
//
// When the cap bites the batch is the OLDEST `cap` of them, not the newest. The
// cursor is one timestamp and the next pass only looks at marks newer than it,
// so whatever is left over has to be newer than every mark in the batch —
// otherwise the cursor steps over it and no pass ever looks at that mark again.
// Taking the newest 40 of a backlog of 300 and stamping the cursor with the
// newest of them wrote off the other 260 in one go: the highlights stay on the
// page, but the app has stopped noticing them. Draining from the oldest end
// costs a pass per 40 and reaches all of them.
//
// `cap` is a target rather than a limit, because a cursor is one millisecond and
// the batch therefore has to end between two of them: marks sharing a timestamp
// go in the same batch or the ones above the cut sit behind a cursor equal to
// their own createdAt, where `> since` never selects them again.
export function selectSilentMarks(
  annotations: DistillAnnotation[],
  since: number | null,
  cap = 40,
): { marks: DistillAnnotation[]; capped: boolean; cursor: number | null } {
  const fresh = annotations
    .filter((a) => (since === null ? true : a.createdAt > since))
    .filter((a) => a.text.trim() !== "" || (a.comment ?? "").trim() !== "")
    .sort((a, b) => b.createdAt - a.createdAt);
  // fresh is newest-first, so the tail is the oldest `cap` and marks[0] is the
  // newest mark this batch covers — the only safe place for the cursor.
  let start = Math.max(0, fresh.length - cap);
  // Then down past anything sharing that mark's timestamp, so the cut lands
  // between milliseconds. An overlong batch costs prompt; a cut through a tie
  // costs the marks above it for good.
  while (start > 0 && fresh[start - 1].createdAt === fresh[start].createdAt) start--;
  const marks = fresh.slice(start);
  // Capped means something was left over for a later pass, which after the walk
  // is not the same question as `fresh.length > cap`.
  return { marks, capped: start > 0, cursor: marks.length > 0 ? marks[0].createdAt : null };
}

// One bullet per mark: page, the passage, the reader's note. Shared by the two
// prompts that list marks.
function markLines(marks: DistillAnnotation[]): string[] {
  return marks.map((a) => {
    const head = a.page !== null ? `p${a.page}` : "—";
    const quote = a.text.trim() ? `"${clip(a.text)}"` : "(no selected text)";
    const note = (a.comment ?? "").trim() ? ` — note: ${clip(a.comment!, 80)}` : "";
    return `- [${a.id}] ${head}: ${quote}${note}`;
  });
}

// The silent-marks block for the user message, or "" when there are none. Framed
// as a pattern signal, with annotation ids so an observation can anchor to them.
export function formatSilentMarks(marks: DistillAnnotation[], capped: boolean): string {
  if (marks.length === 0) return "";
  const lines = [
    "Marks the reader made since the last distillation, most made silently (no",
    "conversation). Look for a PATTERN across them, not one-off details:",
  ];
  if (capped) {
    lines.push(`(the ${marks.length} oldest of a longer backlog; the rest follow in a later pass)`);
  }
  return [...lines, ...markLines(marks)].join("\n");
}

// Where a book's marks had been folded in to. Per book, falling back to the
// topic-wide stamp left by the versions that had only that (store.ts).
export function markCursor(meta: ObservationMeta, bookId: string): number | null {
  return meta.distilledMarks?.[bookId] ?? meta.lastAnnotationDistillAt;
}

export interface DistillDeps {
  // One sub-agent turn, run to completion. live.ts backs it with the app's
  // provider; tests script it over the real agent loop.
  run: SubagentTurnFn;
  // Cancels the pass. Neither trigger point owns one today — see live.ts, where
  // the reason each of them cannot is written down.
  signal?: AbortSignal;
  // The model the pass runs on. Resolved by the caller because only it knows
  // which of the app's thinking settings a silent turn of the reader's own
  // conversation belongs to.
  model?: SubagentModel;
}

export interface DistillResult {
  created: number;
  updated: number;
  deleted: number;
  // Whether the pass finished. False means the sub-agent gave up or the call did
  // not complete, and the caller must not advance its distillation timestamps:
  // the next trigger has to be able to redo this transcript.
  //
  // Returned rather than thrown. A pass has six ways to not finish and a caller
  // that had to tell them apart by catching would get one of them wrong; the
  // counts also matter on a pass that failed half-way, because the writes it did
  // make are already on disk.
  ok: boolean;
  outcome: SubagentOutcome;
  // The sub-agent's own sentence about why the pass did not finish. Set only when
  // ok is false, and this is the only use the brief's text has here: a pass that
  // did finish ends with the word "done" (the prompt asks for it) and its product
  // is the observation writes, so that text is discarded. Do not start relaying
  // it — there is no reader-facing place for a bookkeeping message.
  failure?: string;
}

// The sub-agent's name, which is what its honest-failure sentences are about
// ("The observation_distiller sub-agent could not complete: …"). Lowercase with
// underscores, like every other tool name in the app (docs/24).
export const DISTILL_AGENT_NAME = "observation_distiller";

// Model turns one pass may spend: read the index, make its observation_update calls,
// finish. The same cap the agent loop's default gave this pass before it moved
// onto the capability, kept rather than dropped to the capability's 6 because
// nobody is waiting on a background pass and a curation run that reads before it
// writes uses more turns than a lookup.
export const DISTILL_MAX_ROUNDS = 8;

// Tokens the final text may occupy. Nothing reads it, so the cap exists to bound
// what a run can hand back at all; it is low because the contract prompt derives
// its word limit from this number and the expected answer is one word.
export const DISTILL_BRIEF_TOKENS = 200;

// The distiller as a sub-agent definition: the prompt, the tools and the caps are
// the observation domain's, the loop and the failure mapping are the capability's.
//
// `evidence` is "optional", and this is the one field here that would do real
// damage at its default. The default is "required" as soon as tools are mounted,
// because a sub-agent given a search tool exists precisely because the answer is
// not in the model's memory, so an answer with no successful tool call behind it
// is invented. Distillation is not a lookup. Its prompt says outright that a
// short or shallow conversation may yield nothing worth keeping and that making
// no tool call at all is a fine outcome — so the correct pass over a thin
// conversation calls nothing. Under "required" every one of those would come back
// "no-evidence", be recorded as a failed pass, and hold the timestamps back, so
// the next trigger would distil the same transcript again and again.
export function buildDistillAgent(
  input: DistillInput,
  tools: AgentTool[],
  model?: SubagentModel,
): SubagentDefinition {
  return {
    name: DISTILL_AGENT_NAME,
    // Never mounted as a tool: no parent model chooses to distil, the app does,
    // on hangup and on a trimmed history. Nothing reads these two lines, and the
    // label is here because the type asks for one — no progress is subscribed to,
    // since a silent pass has nothing to show the reader.
    description: "Curate this topic's observations from a finished conversation.",
    label: "Distilling observations",
    systemPrompt: buildDistillSystemPrompt(input),
    tools,
    maxRounds: DISTILL_MAX_ROUNDS,
    model,
    evidence: "optional",
    briefTokenCap: DISTILL_BRIEF_TOKENS,
  };
}

export function buildDistillSystemPrompt(input: DistillInput): string {
  return [
    "You keep a reading companion's observations of its reader. A conversation",
    "with the reader just ended; distill from its transcript what is worth",
    "observing about the reader into this topic's observations, using the",
    "observation tools.",
    "This is a silent background pass: the reader sees nothing. Make your tool",
    'calls, then finish with the single word "done".',
    "",
    "Observation types (one fact per observation):",
    "- reading-position: where the reader is in a material",
    "- stuck-point: something the reader is stuck on or confused by",
    "- understood-concept: something the reader has worked out",
    "- belief: an opinion, question, or hypothesis the reader voiced",
    "- correction: the reader corrected you or the material",
    "",
    "Curation rules:",
    "- Update, don't duplicate: when the index below already has a related",
    "  observation, update it (observation_update action \"update\") instead of",
    "  creating another.",
    "- Delete what turned out wrong.",
    "- On contradiction with an existing observation (e.g. the reader was stuck and",
    "  now gets it), never silently drop the old state: rewrite that observation as",
    '  an evolution — "was stuck on X, resolved on <date>" — so both states stay visible.',
    `- Write absolute dates (today is ${input.today}); never "recently" or "last week".`,
    "- Record only what cannot be re-derived from the book or the reader's",
    "  annotations: their understanding, confusions, beliefs, corrections, and where",
    "  they are. Do not copy book content or annotation text into an observation.",
    "- Anchor evidence: pass the annotation id and the message ids an observation",
    "  came from.",
    "- A short or shallow conversation may yield nothing worth keeping; making no",
    "  tool call at all is a fine outcome.",
    ...((input.silentMarks?.length ?? 0) > 0
      ? [
          "- Silent marks: the message below lists marks the reader made since the last",
          "  distillation, most without any conversation. Judge whether they show a",
          "  PATTERN worth recording (what the reader keeps marking, which themes or",
          "  pages they lingered on). If so, write ONE aggregated observation (usually",
          "  understood-concept, belief, or stuck-point, as fits) anchored to those",
          "  annotation ids — never one observation per mark. Recording nothing is fine.",
        ]
      : []),
    "",
    "Current observation index for this topic:",
    input.indexText.trim() || "(empty)",
  ].join("\n");
}

export function buildDistillUserMessage(input: DistillInput): string {
  const lines = [
    `Topic: ${input.topicName}`,
    `Book: ${input.bookName}`,
    `Conversation date: ${input.today}`,
    `Thread ${input.threadId}, anchored on annotation ${input.annotationId}` +
      (input.page !== null ? ` (page ${input.page})` : ""),
  ];
  if (input.markedText.trim()) lines.push(`Marked passage: "${input.markedText.trim()}"`);
  lines.push("", "Transcript (message ids in brackets):");
  for (const m of input.messages) {
    lines.push(`[${input.threadId}:${m.ts}] ${m.role === "user" ? "reader" : "you"}: ${m.text}`);
  }
  const marksBlock = formatSilentMarks(input.silentMarks ?? [], input.silentMarksCapped ?? false);
  if (marksBlock) lines.push("", marksBlock);
  return lines.join("\n");
}

// One distillation pass. Rejects only for cancellation (StoppedError, raised by
// the capability); every other way of not finishing comes back in `ok`.
export async function runDistillation(
  input: DistillInput,
  adapter: ObservationAdapter,
  deps: DistillDeps,
): Promise<DistillResult> {
  const counts = { created: 0, updated: 0, deleted: 0 };
  const tools = buildObservationTools(adapter, {
    onWrite: (action: ObservationWriteAction) => {
      if (action === "create") counts.created++;
      else if (action === "update") counts.updated++;
      else counts.deleted++;
    },
  });
  const brief = await runSubagent(
    {
      definition: buildDistillAgent(input, tools, deps.model),
      task: buildDistillUserMessage(input),
      signal: deps.signal,
    },
    // No ledger. A ledger stops a parent model from calling the same sub-agent
    // nine times in one reader turn; nothing here is called by a model. The app
    // starts a pass on hangup or on a trim, one at a time per thread (live.ts),
    // so the run gets its own cap outright.
    { run: deps.run },
  );
  // The pass finished when the sub-agent ended a turn of its own accord. The
  // outcome is read rather than `usable`, which asks whether the text may be
  // relayed — a question with no meaning here, since the text is discarded.
  const ok = brief.outcome === "answered";
  return {
    ...counts,
    ok,
    outcome: brief.outcome,
    failure: ok ? undefined : brief.brief,
  };
}

// --- one pass over a thread, with the timestamp discipline ---

// What a pass needs of the topic's observation store. Narrow so the discipline
// below runs against a fake fs in tests.
export interface DistillPassStore {
  getMeta(): Promise<ObservationMeta>;
  setMeta(meta: ObservationMeta): Promise<void>;
  readIndexText(): Promise<string>;
}

export interface DistillPassDeps extends DistillDeps {
  store: DistillPassStore;
  adapter: ObservationAdapter;
  now?: () => number;
}

// The thread a pass is about. The live triggers add a topic id on top of this
// (live.ts) to resolve the store, the adapter and the event log.
export interface DistillPassInput {
  topicName: string;
  bookId: string;
  bookName: string;
  threadId: string;
  annotationId: string;
  page: number | null;
  markedText: string;
  messages: DistillMessage[];
  // The book's marks, filtered here against the store's cursor.
  annotations?: DistillAnnotation[];
  // How much new conversation the pass is worth. The whole transcript is still
  // sent — a conversation about one passage is one unit — so this only decides
  // whether to run at all.
  minNewMessages?: number;
}

// Why a pass did nothing, when it did nothing. Both are ordinary now that a
// sweep looks at every thread every half hour (arrears.ts).
export type DistillSkip = "no-new-messages" | "reader-silent";

export type DistillPassResult =
  | { ran: false; skipped: DistillSkip }
  | ({ ran: true } & DistillResult);

// How many of a thread's messages have already been folded in.
export function messageCursor(meta: ObservationMeta, threadId: string): number {
  return meta.distilledMessages?.[threadId] ?? 0;
}

// New messages the reader themselves wrote, after the cursor. Empty rows and the
// AI's own half do not count: neither is evidence about the reader, and counting
// them would make every answer look like arrears. Pure — unit-tested.
export function countNewReaderMessages(
  messages: readonly DistillMessage[],
  cursor: number,
): number {
  const from = Math.min(Math.max(cursor, 0), messages.length);
  let n = 0;
  for (let i = from; i < messages.length; i++) {
    if (messages[i].role === "user" && messages[i].text.trim() !== "") n++;
  }
  return n;
}

// Assemble the input, run the pass, and advance the bookkeeping only if it
// finished. The stamps say what has already been folded into the observations,
// so moving them after a pass that did not write is how a conversation silently
// loses its observations for good.
//
// The message cursor is on disk rather than in memory because the trigger is no
// longer only hangup: the sweep comes back to the same thread every half hour,
// and across restarts (arrears.ts).
export async function runDistillPass(
  input: DistillPassInput,
  deps: DistillPassDeps,
): Promise<DistillPassResult> {
  const now = deps.now ?? Date.now;
  const meta = await deps.store.getMeta();
  const cursor = messageCursor(meta, input.threadId);
  const fresh = countNewReaderMessages(input.messages, cursor);
  // Nothing the reader said → nothing that can't be re-derived from the book and
  // the mark itself. Marks with no conversation at all are a pass of their own
  // (runMarksDistillPass), not a degenerate case of this one.
  if (fresh === 0) {
    return { ran: false, skipped: cursor >= input.messages.length ? "no-new-messages" : "reader-silent" };
  }
  if (fresh < (input.minNewMessages ?? 1)) return { ran: false, skipped: "no-new-messages" };

  const { marks, capped, cursor: markCursorNext } = selectSilentMarks(
    input.annotations ?? [],
    markCursor(meta, input.bookId),
  );
  const result = await runDistillation(
    {
      topicName: input.topicName,
      bookName: input.bookName,
      threadId: input.threadId,
      annotationId: input.annotationId,
      page: input.page,
      markedText: input.markedText,
      messages: input.messages,
      indexText: await deps.store.readIndexText(),
      today: isoDate(now()),
      silentMarks: marks,
      silentMarksCapped: capped,
    },
    deps.adapter,
    { run: deps.run, model: deps.model, signal: deps.signal },
  );
  if (!result.ok) return { ran: true, ...result };
  // The transcript's cursor, and — when this pass actually saw the marks — the
  // book's mark cursor. Spread first: the rehearsal pass keeps its own per-thread
  // cursor in the same file (rehearsal.ts) and a hangup here must not wipe it.
  await deps.store.setMeta({
    ...meta,
    lastDistilledAt: now(),
    distilledMessages: { ...(meta.distilledMessages ?? {}), [input.threadId]: input.messages.length },
    ...(markCursorNext !== null
      ? { distilledMarks: { ...(meta.distilledMarks ?? {}), [input.bookId]: markCursorNext } }
      : {}),
  });
  return { ran: true, ...result };
}

// --- marks with no conversation ---

// The pass for a book the reader has only marked up: 34 highlights, not one
// question asked. Its own prompt rather than a branch of the transcript one,
// because the transcript prompt's whole footing — "a conversation just ended,
// distill what the reader said" — is false here, and a prompt that says
// something false about its own input gets answered as if it were true.
export const MARKS_DISTILL_AGENT_NAME = "marks_distiller";

export interface MarksDistillInput {
  topicName: string;
  bookName: string;
  // The marks since the book's cursor, newest first, already capped (the oldest
  // `cap` of them when there are more than that — see selectSilentMarks).
  marks: DistillAnnotation[];
  capped: boolean;
  indexText: string;
  today: string; // YYYY-MM-DD, so the model writes absolute dates
}

export function buildMarksDistillSystemPrompt(input: MarksDistillInput): string {
  return [
    "You keep a reading companion's observations of its reader. This pass has no",
    "conversation to read. The reader has been marking up a book on their own —",
    "highlighting passages, now and then writing a note beside one — and has not",
    "asked you about any of it. The marks listed in the message below are the",
    "whole of what you have. Distill from them what is worth observing about the",
    "reader, using the observation tools.",
    "This is a silent background pass: the reader sees nothing. Make your tool",
    'calls, then finish with the single word "done".',
    "",
    "Read the marks as a distribution, not as a list of quotes:",
    "- How far they have got. The pages the marks span, and the furthest one,",
    "  are where the reader is in this book (reading-position).",
    "- What their attention settles on. Several marks that share a theme, or a",
    "  handful of pages marked far more densely than the rest, say what this",
    "  reader is actually reading the book for.",
    "- Whether they keep coming back to something. The same idea marked at pages",
    "  far apart is a stronger signal than any single mark, and is worth saying",
    "  so in the body.",
    "- What a note adds. A note phrased as a question, or as disagreement, is the",
    "  one place in a silent stretch where the reader speaks (stuck-point, belief,",
    "  correction).",
    "",
    "What marks cannot tell you: whether the reader understood any of it. A",
    "highlight is attention, not comprehension. Do not record understood-concept",
    "from marks alone, and say in the body that the observation comes from marks",
    "with no conversation behind them, so a later pass knows how much weight it",
    "carries.",
    "",
    "Observation types (one fact per observation):",
    "- reading-position: where the reader is in a material",
    "- stuck-point: something the reader is stuck on or confused by",
    "- understood-concept: something the reader has worked out",
    "- belief: an opinion, question, or hypothesis the reader voiced",
    "- correction: the reader corrected you or the material",
    "",
    "Curation rules:",
    "- Aggregate. A stretch of marks is worth one or two observations, never one",
    "  per mark: the marks are on disk already, with their own text, and an",
    "  observation that restates one adds nothing.",
    "- Update, don't duplicate: when the index below already has a related",
    '  observation, update it (observation_update action "update") instead of',
    "  creating another. A reading-position for this book almost certainly exists",
    "  already — move it rather than writing a second one.",
    "- On contradiction with an existing observation, never silently drop the old",
    "  state: rewrite it as an evolution — \"was stuck on X, marked it again on",
    '  <date>" — so both states stay visible.',
    `- Write absolute dates (today is ${input.today}); never "recently" or "last week".`,
    "- Do not copy the marked passages into an observation. They are already",
    "  stored; what is not stored is what marking them says about the reader.",
    "- Anchor evidence: pass the annotation ids an observation came from.",
    "- A short or scattered stretch of marks may yield nothing worth keeping;",
    "  making no tool call at all is a fine outcome.",
    "",
    "Current observation index for this topic:",
    input.indexText.trim() || "(empty)",
  ].join("\n");
}

export function buildMarksDistillUserMessage(input: MarksDistillInput): string {
  const lines = [
    `Topic: ${input.topicName}`,
    `Book: ${input.bookName}`,
    `Date: ${input.today}`,
    "",
    `${input.marks.length} mark(s) since the last pass, newest first. None of them`,
    "was discussed with you — there is no transcript for this stretch of reading.",
  ];
  if (input.capped) {
    lines.push(
      `(the ${input.marks.length} oldest of a longer backlog; the rest follow in a later pass)`,
    );
  }
  return [...lines, ...markLines(input.marks)].join("\n");
}

export function buildMarksDistillAgent(
  input: MarksDistillInput,
  tools: AgentTool[],
  model?: SubagentModel,
): SubagentDefinition {
  return {
    name: MARKS_DISTILL_AGENT_NAME,
    description: "Curate this topic's observations from a stretch of silent reading.",
    label: "Distilling observations",
    systemPrompt: buildMarksDistillSystemPrompt(input),
    tools,
    maxRounds: DISTILL_MAX_ROUNDS,
    model,
    // Same reason as the transcript pass: a correct pass over a thin stretch of
    // marks makes no tool call at all, and "required" would file every one of
    // those as a failure and hold the cursor back.
    evidence: "optional",
    briefTokenCap: DISTILL_BRIEF_TOKENS,
  };
}

export async function runMarksDistillation(
  input: MarksDistillInput,
  adapter: ObservationAdapter,
  deps: DistillDeps,
): Promise<DistillResult> {
  const counts = { created: 0, updated: 0, deleted: 0 };
  const tools = buildObservationTools(adapter, {
    onWrite: (action: ObservationWriteAction) => {
      if (action === "create") counts.created++;
      else if (action === "update") counts.updated++;
      else counts.deleted++;
    },
  });
  const brief = await runSubagent(
    {
      definition: buildMarksDistillAgent(input, tools, deps.model),
      task: buildMarksDistillUserMessage(input),
      signal: deps.signal,
    },
    { run: deps.run },
  );
  const ok = brief.outcome === "answered";
  return { ...counts, ok, outcome: brief.outcome, failure: ok ? undefined : brief.brief };
}

export interface MarksPassInput {
  topicName: string;
  bookId: string;
  bookName: string;
  // The book's marks, filtered here against the book's cursor.
  annotations: DistillAnnotation[];
  // How many new marks make a pass worth its cost. The sweep gates on this too,
  // before it picks a job; the pass re-checks against the cursor it just read.
  minNewMarks?: number;
}

export type MarksPassResult = { ran: false; skipped: "no-new-marks" } | ({ ran: true } & DistillResult);

// One pass over a book's silent marks, with the same cursor discipline as the
// transcript pass: the book's mark cursor moves only if the pass finished.
export async function runMarksDistillPass(
  input: MarksPassInput,
  deps: DistillPassDeps,
): Promise<MarksPassResult> {
  const now = deps.now ?? Date.now;
  const meta = await deps.store.getMeta();
  const { marks, capped, cursor } = selectSilentMarks(
    input.annotations,
    markCursor(meta, input.bookId),
  );
  if (marks.length < (input.minNewMarks ?? 1)) return { ran: false, skipped: "no-new-marks" };

  const result = await runMarksDistillation(
    {
      topicName: input.topicName,
      bookName: input.bookName,
      marks,
      capped,
      indexText: await deps.store.readIndexText(),
      today: isoDate(now()),
    },
    deps.adapter,
    { run: deps.run, model: deps.model, signal: deps.signal },
  );
  if (!result.ok) return { ran: true, ...result };
  await deps.store.setMeta({
    ...meta,
    lastDistilledAt: now(),
    ...(cursor !== null
      ? { distilledMarks: { ...(meta.distilledMarks ?? {}), [input.bookId]: cursor } }
      : {}),
  });
  return { ran: true, ...result };
}
