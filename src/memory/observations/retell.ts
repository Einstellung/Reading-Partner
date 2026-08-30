// Distillation of a retell conversation (docs/31 second stage, docs/02 part 2
// write side): the reader went through a finished book chapter by chapter with
// the AI as examiner, and left. This pass reads that stretch of conversation and
// curates the topic's observations from it.
//
// The sibling of distill.ts and deliberately not a branch of it. That one runs
// over a conversation about a passage the reader is standing in front of, and
// folds in the marks they made since; this one runs over an examination of a
// book they have finished, where the valuable signal is what they could and
// could not say out loud. Only the plumbing is shared — the sub-agent caps, the
// message shape, the result type.
//
// It never imports the retell domain: everything about the retell arrives as input
// (the trigger point is on the retell's side, in ui/components/retell/useRetell.ts).

import type { AgentTool } from "../../ai/agent";
import { runSubagent, type SubagentDefinition, type SubagentModel } from "../../ai/subagent";
import type { ObservationAdapter } from "./adapter";
import {
  DISTILL_BRIEF_TOKENS,
  DISTILL_MAX_ROUNDS,
  datingRule,
  distillCoverage,
  evidenceDates,
  formatEvidenceSpan,
  type DistillCoverage,
  type DistillDeps,
  type DistillMessage,
  type DistillResult,
  type EvidenceDates,
} from "./distill";
import type { ObservationMeta } from "./store";
import { buildObservationTools, type ObservationWriteAction } from "./tools";
import { buildTranscript, renderTranscript } from "./transcript";

export const RETELL_DISTILL_AGENT_NAME = "retell_distiller";

export interface RetellDistillInput {
  topicName: string;
  retellName: string;
  // The retell's materials by title, so an observation can name the book a
  // chapter belongs to. Attribution is prose, not a field (docs/31).
  materials: string[];
  threadId: string;
  // The stretch of conversation this pass is about: only what earlier passes did
  // not already see (selectNewMessages).
  messages: DistillMessage[];
  // How many messages earlier passes already folded in, so the transcript below
  // does not read as the whole retell.
  earlier: number;
  // The current observation index — the whole of it, every pass. The first thing
  // the prompt asks for is a reconciliation against these lines.
  indexText: string;
  // When the stretch below happened, from the messages' own timestamps. A retell
  // is left and re-entered over days (docs/31), so this is routinely not today.
  dates: EvidenceDates | null;
}

// The conversation this pass has not seen yet, and the cursor to store if it
// finishes. Messages with no text of their own are dropped first: a retell's
// thread holds decision cards as empty rows (ui/components/retell/useRetell.ts), and
// counting them would move the cursor past conversation that was never read.
// Pure — unit-tested.
export function selectNewMessages(
  messages: readonly DistillMessage[],
  cursor: number,
): { fresh: DistillMessage[]; total: number } {
  const spoken = messages.filter((m) => m.text.trim() !== "");
  const from = Math.min(Math.max(cursor, 0), spoken.length);
  return { fresh: spoken.slice(from), total: spoken.length };
}

export function buildRetellDistillSystemPrompt(input: RetellDistillInput): string {
  return [
    "You keep a reading companion's observations of its reader. The reader has",
    "just stepped out of a retell: a conversation in which you quizzed them,",
    "chapter by chapter, about a book they have finished reading, to see whether",
    "they can say it back. Distill from that stretch of",
    "conversation what is worth observing about the reader, using the observation",
    "tools.",
    "This is a silent background pass: the reader sees nothing. Make your tool",
    'calls, then finish with the single word "done".',
    "",
    "What is worth keeping: a judgement that took a whole conversation to reach",
    "and that will still hold in a month. The transcript is on disk already — this",
    "pass is not an archive. It exists to turn what you would otherwise have to",
    "work out all over again into something you can read.",
    "",
    "Start by reconciling, not by writing.",
    "- Read the observation index at the end of this prompt and work out which",
    "  existing observations this conversation bears on. Decide what has to change",
    "  before you decide what to add. observation_read gives you one in full.",
    "- A retell is where earlier observations get tested. Something recorded as",
    "  a stuck-point while they were reading, and explained cleanly here, is not a",
    "  stuck-point any more; a question they voiced as a belief and have now",
    "  answered themselves is not open any more. Update those. Crossing types is",
    "  normal: change the old entry, giving it a different type when its state has",
    "  changed, rather than leaving it and writing a fresh one beside it.",
    "- Never leave two observations standing for the two ends of one story. That",
    "  is the failure this step exists to prevent: the next retell reads the",
    "  index, finds the stale stuck-point, and spends its questions on ground the",
    "  reader has already covered, while what actually needs work waits below it.",
    "- Updating keeps the history. Add a line to the body's timeline — e.g.",
    '  "2026-08-06 explained once, never tested; 2026-08-07 gave it unprompted in',
    '  the retell, via the Dyna analogy" — instead of overwriting the old',
    "  conclusion with the new one.",
    "- An observation this conversation shows was plain wrong — not out of date,",
    "  but mistaken when it was written — may be corrected outright or deleted,",
    "  with the body saying why.",
    "",
    "Then record what only a retell can tell you. Three things:",
    "- Whether the reader can give a chapter out loud, and when they cannot, which",
    "  part is missing: gave the conclusion and skipped the argument, mixed this",
    "  chapter up with another, had the mechanism but not the evidence for it.",
    "  Types can-explain / cannot-explain.",
    "- Where the reader corrected you. You laid out the spine of the book and they",
    "  said that is not it; you had a causal link the wrong way round and they",
    "  turned it over. That is a judgement about this book which you do not have",
    "  and which is not in the text. Type correction.",
    "- How this reader explains things: that they reach for the conclusion first",
    "  and have to be asked for the argument, that analogies out of one particular",
    "  field are where they are fluent. This is the kind that holds across books,",
    "  which makes it the most valuable thing in the conversation. Say in the body",
    "  that it is a habit rather than a one-off.",
    "",
    "Do not record:",
    "- What the retell settled on keeping. That is already written down,",
    "  structured, and more precise than prose.",
    "- What you explained. It can be produced again from the book.",
    "- A running account of the conversation. An observation is a judgement plus a",
    "  pointer to the evidence for it, never a retelling.",
    "",
    "Judge from what the reader actually said. You were the examiner here, which",
    'makes your own verdicts in the transcript worthless as evidence: "that is',
    'exactly right" was said to keep the retell moving, and taking it as proof',
    "that they can explain the chapter is reading your own encouragement back to",
    "yourself. Their words, not your reactions to them. Where an answer came back",
    "thin and you filled the rest in, that is a cannot-explain however warm the",
    "exchange sounded.",
    "",
    "Observation types (one fact per observation):",
    "- reading-position: where the reader is in a material",
    "- stuck-point: something the reader did not understand while reading",
    "- cannot-explain: the reader has read it and cannot say it out loud. The",
    "  understanding is there, or half there; the account of it is not. Write which",
    "  part is missing. Partly able counts as cannot-explain — the useful default",
    "  next move is to ask again.",
    "- can-explain: the reader gave the chapter's argument themselves, in their own",
    "  words, without being handed it",
    "- understood-concept: something the reader has worked out",
    "- belief: an opinion, question, or hypothesis the reader voiced",
    "- correction: the reader corrected you or the material",
    "",
    "Writing rules:",
    "- Say in the body which material and which chapter an observation is about,",
    "  in words (the titles are in the message below). There is no field for it.",
    "- One chapter retold twice is one observation, updated, with a timeline in",
    "  the body. Do not let a single chapter grow three entries: the index is what",
    "  the next conversation reads, and it is short.",
    ...datingRule("retell", input.dates),
    "- Anchor evidence: every observation you create must cite the transcript",
    "  line numbers it came from (messageIndices: the [n] printed in front of each",
    "  line). Numbers, not ids — the program holds the ids.",
    "- A short or shallow stretch of conversation may yield nothing worth keeping;",
    "  making no tool call at all is a fine outcome.",
    "",
    "Current observation index for this topic:",
    input.indexText.trim() || "(empty)",
  ].join("\n");
}

export function buildRetellDistillUserMessage(input: RetellDistillInput): string {
  const lines = [
    `Topic: ${input.topicName}`,
    `Retell: ${input.retellName}`,
    `Material${input.materials.length === 1 ? "" : "s"}: ${
      input.materials.length ? input.materials.join(", ") : "(none named)"
    }`,
    ...(input.dates ? [`Retell date: ${formatEvidenceSpan(input.dates)}`] : []),
    `Thread ${input.threadId}`,
  ];
  if (input.earlier > 0) {
    lines.push(
      `An earlier pass already folded in the first ${input.earlier} message(s) of this` +
        " retell; only what follows is new.",
    );
  }
  lines.push("", "Transcript. Cite a message by the [n] in front of it:");
  lines.push(...renderTranscript(buildTranscript(input.messages, input.threadId)));
  return lines.join("\n");
}

// Same caps and the same `evidence: "optional"` as the reading distiller, for
// the same reason: a correct pass over a thin conversation makes no tool call at
// all, and "required" would record every one of those as a failure and hold the
// cursor back (see distill.ts).
export function buildRetellDistillAgent(
  input: RetellDistillInput,
  tools: AgentTool[],
  model?: SubagentModel,
): SubagentDefinition {
  return {
    name: RETELL_DISTILL_AGENT_NAME,
    description: "Curate this topic's observations from a finished retell.",
    label: "Distilling observations",
    systemPrompt: buildRetellDistillSystemPrompt(input),
    tools,
    maxRounds: DISTILL_MAX_ROUNDS,
    model,
    evidence: "optional",
    briefTokenCap: DISTILL_BRIEF_TOKENS,
  };
}

// One pass over a retell transcript. Rejects only for cancellation
// (StoppedError); every other way of not finishing comes back in `ok`.
export async function runRetellDistillation(
  input: RetellDistillInput,
  adapter: ObservationAdapter,
  deps: DistillDeps,
): Promise<DistillResult> {
  const counts = { created: 0, updated: 0, deleted: 0 };
  // One numbering shared with the user message above (see distill.ts).
  const transcript = buildTranscript(input.messages, input.threadId);
  const tools = buildObservationTools(adapter, {
    messageLines: transcript,
    requireAnchor: true,
    onWrite: (action: ObservationWriteAction) => {
      if (action === "create") counts.created++;
      else if (action === "update") counts.updated++;
      else counts.deleted++;
    },
  });
  const brief = await runSubagent(
    {
      definition: buildRetellDistillAgent(input, tools, deps.model),
      task: buildRetellDistillUserMessage(input),
      signal: deps.signal,
    },
    { run: deps.run },
  );
  const ok = brief.outcome === "answered";
  return { ...counts, ok, outcome: brief.outcome, failure: ok ? undefined : brief.brief };
}

// --- one pass over a retell's conversation, with the cursor discipline ---

export interface RetellPassStore {
  getMeta(): Promise<ObservationMeta>;
  setMeta(meta: ObservationMeta): Promise<void>;
  readIndexText(): Promise<string>;
}

export interface RetellPassDeps extends DistillDeps {
  store: RetellPassStore;
  adapter: ObservationAdapter;
  now?: () => number;
}

export interface RetellPassInput {
  topicName: string;
  retellName: string;
  materials: string[];
  threadId: string;
  // The whole conversation as it stands on disk, oldest first. What this pass
  // sends is the part after the cursor.
  messages: DistillMessage[];
}

// Why the pass did nothing, when it did nothing. Both are ordinary: leaving a
// retell twice in a row is one of the two exits from the view, and a reader who
// only listened has left nothing that cannot be re-derived.
export type RetellSkip = "no-new-messages" | "reader-silent";

export type RetellPassResult =
  | { ran: false; skipped: RetellSkip }
  | ({ ran: true; distilled: number; coverage: DistillCoverage } & DistillResult);

// Assemble the input from the cursor, run the pass, and move the cursor only if
// it finished — the same discipline the reading pass keeps with its timestamps,
// and for the same reason: a cursor moved past a pass that wrote nothing is how
// a conversation loses its observations for good.
//
// The cursor counts input messages only. It never limits what the pass may
// write: every pass is handed the whole current index and told to reconcile
// against it first, so a stretch of new conversation can update or delete an
// observation left by any earlier pass, of either kind.
export async function runRetellDistillPass(
  input: RetellPassInput,
  deps: RetellPassDeps,
): Promise<RetellPassResult> {
  const now = deps.now ?? Date.now;
  const meta = await deps.store.getMeta();
  const cursor = meta.distilledMessages?.[input.threadId] ?? 0;
  const { fresh, total } = selectNewMessages(input.messages, cursor);
  if (fresh.length === 0) return { ran: false, skipped: "no-new-messages" };
  // Nothing the reader said in this stretch → nothing a retell is uniquely
  // able to observe. The AI's own half of the conversation is not evidence
  // about the reader (see the prompt's examiner rule).
  if (!fresh.some((m) => m.role === "user" && m.text.trim() !== "")) {
    return { ran: false, skipped: "reader-silent" };
  }

  const stamps = fresh.map((m) => m.ts);
  const coverage = distillCoverage(stamps, cursor);
  const result = await runRetellDistillation(
    {
      topicName: input.topicName,
      retellName: input.retellName,
      materials: input.materials,
      threadId: input.threadId,
      messages: fresh,
      earlier: cursor,
      indexText: await deps.store.readIndexText(),
      dates: evidenceDates(stamps),
    },
    deps.adapter,
    { run: deps.run, model: deps.model, signal: deps.signal },
  );
  if (!result.ok) return { ran: true, distilled: fresh.length, coverage, ...result };
  // Spread first: the reading pass's two stamps live in the same file and this
  // one has no business moving them.
  await deps.store.setMeta({
    ...meta,
    lastDistilledAt: now(),
    distilledMessages: { ...(meta.distilledMessages ?? {}), [input.threadId]: total },
  });
  return { ran: true, distilled: fresh.length, coverage, ...result };
}
