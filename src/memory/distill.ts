// Distillation (docs/02 part 2, write side): a silent agent turn over a
// finished conversation's transcript that curates the topic memory through the
// memory tools. Dep-injected agent runner so tests never touch a provider.
// Triggered on hangup, with a fallback when the replayed history is trimmed
// (see live.ts / App).

import type { AgentTool } from "../ai/agent";
import type { MemoryAdapter } from "./adapter";
import { buildMemoryTools, type MemoryWriteAction } from "./tools";

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
  // The current memory index text (what "update, don't duplicate" checks against).
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
// as a pattern signal, with annotation ids so a memory can anchor to them.
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

// Runs one silent agent turn to completion. Resolves on the model's final text,
// rejects on error. live.ts backs this with runAgentTurn; tests script it.
export type DistillRunner = (params: {
  systemPrompt: string;
  userText: string;
  tools: AgentTool[];
}) => Promise<void>;

export interface DistillResult {
  created: number;
  updated: number;
  deleted: number;
}

export function buildDistillSystemPrompt(input: DistillInput): string {
  return [
    "You are the memory keeper of a reading companion. A conversation with the",
    "reader just ended; distill from its transcript what is worth remembering",
    "about the reader into this topic's long-term memory, using the memory tools.",
    "This is a silent background pass: the reader sees nothing. Make your tool",
    'calls, then finish with the single word "done".',
    "",
    "Memory types (one fact per memory):",
    "- reading-position: where the reader is in a material",
    "- stuck-point: something the reader is stuck on or confused by",
    "- understood-concept: something the reader has worked out",
    "- belief: an opinion, question, or hypothesis the reader voiced",
    "- correction: the reader corrected you or the material",
    "",
    "Curation rules:",
    "- Update, don't duplicate: when the index below already has a related memory,",
    "  update it (memory_update action \"update\") instead of creating another.",
    "- Delete what turned out wrong.",
    "- On contradiction with an existing memory (e.g. the reader was stuck and now",
    "  gets it), never silently drop the old state: rewrite that memory as an",
    '  evolution — "was stuck on X, resolved on <date>" — so both states stay visible.',
    `- Write absolute dates (today is ${input.today}); never "recently" or "last week".`,
    "- Record only what cannot be re-derived from the book or the reader's",
    "  annotations: their understanding, confusions, beliefs, corrections, and where",
    "  they are. Do not copy book content or annotation text into memory.",
    "- Anchor evidence: pass the annotation id and the message ids a memory came from.",
    "- A short or shallow conversation may yield nothing worth keeping; making no",
    "  tool call at all is a fine outcome.",
    ...((input.silentMarks?.length ?? 0) > 0
      ? [
          "- Silent marks: the message below lists marks the reader made since the last",
          "  distillation, most without any conversation. Judge whether they show a",
          "  PATTERN worth remembering (what the reader keeps marking, which themes or",
          "  pages they lingered on). If so, write ONE aggregated memory (usually",
          "  understood-concept, belief, or stuck-point, as fits) anchored to those",
          "  annotation ids — never one memory per mark. Recording nothing is fine.",
        ]
      : []),
    "",
    "Current memory index for this topic:",
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

export async function runDistillation(
  input: DistillInput,
  adapter: MemoryAdapter,
  run: DistillRunner,
): Promise<DistillResult> {
  const result: DistillResult = { created: 0, updated: 0, deleted: 0 };
  const tools = buildMemoryTools(adapter, {
    onWrite: (action: MemoryWriteAction) => {
      if (action === "create") result.created++;
      else if (action === "update") result.updated++;
      else result.deleted++;
    },
  });
  await run({
    systemPrompt: buildDistillSystemPrompt(input),
    userText: buildDistillUserMessage(input),
    tools,
  });
  return result;
}
