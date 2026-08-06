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
// ones with text or a note, newest first, capped. Pure — unit-tested.
export function selectSilentMarks(
  annotations: DistillAnnotation[],
  since: number | null,
  cap = 40,
): { marks: DistillAnnotation[]; capped: boolean } {
  const fresh = annotations
    .filter((a) => (since === null ? true : a.createdAt > since))
    .filter((a) => a.text.trim() !== "" || (a.comment ?? "").trim() !== "")
    .sort((a, b) => b.createdAt - a.createdAt);
  const capped = fresh.length > cap;
  return { marks: capped ? fresh.slice(0, cap) : fresh, capped };
}

// The silent-marks block for the user message, or "" when there are none. Framed
// as a pattern signal, with annotation ids so an observation can anchor to them.
export function formatSilentMarks(marks: DistillAnnotation[], capped: boolean): string {
  if (marks.length === 0) return "";
  const lines = [
    "Marks the reader made since the last distillation, most made silently (no",
    "conversation). Look for a PATTERN across them, not one-off details:",
  ];
  if (capped) lines.push(`(showing the ${marks.length} most recent; there were more)`);
  for (const a of marks) {
    const head = a.page !== null ? `p${a.page}` : "—";
    const quote = a.text.trim() ? `"${clip(a.text)}"` : "(no selected text)";
    const note = (a.comment ?? "").trim() ? ` — note: ${clip(a.comment!, 80)}` : "";
    lines.push(`- [${a.id}] ${head}: ${quote}${note}`);
  }
  return lines.join("\n");
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
  bookName: string;
  threadId: string;
  annotationId: string;
  page: number | null;
  markedText: string;
  messages: DistillMessage[];
  // The book's marks, filtered here against the store's cursor.
  annotations?: DistillAnnotation[];
}

// Assemble the input, run the pass, and advance the two timestamps only if it
// finished. Both stamps are one decision: they say what has already been folded
// into the observations, so moving them after a pass that did not write is how a
// conversation silently loses its observations for good.
export async function runDistillPass(
  input: DistillPassInput,
  deps: DistillPassDeps,
): Promise<DistillResult> {
  const now = deps.now ?? Date.now;
  const meta = await deps.store.getMeta();
  const { marks, capped } = selectSilentMarks(
    input.annotations ?? [],
    meta.lastAnnotationDistillAt,
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
  if (!result.ok) return result;
  // The transcript's stamp, and — when this pass actually saw the marks — the
  // silent-marks cursor.
  await deps.store.setMeta({
    lastDistilledAt: now(),
    lastAnnotationDistillAt: marks.length > 0 ? marks[0].createdAt : meta.lastAnnotationDistillAt,
  });
  return result;
}
