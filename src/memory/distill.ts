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
