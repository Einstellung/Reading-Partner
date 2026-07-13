// Context assembly v1 (docs/02, first segment: live reading context). Pure
// function: given where the reader is and what they just marked, produce the
// system prompt. Later segments (topic snapshot, recalled memory, evidence)
// attach here as they come online.

export interface ReadingContext {
  topicName: string;
  fileName: string;
  pageLabel: string | null;
  selectionText: string;
  selectionComment?: string | null;
}

export function buildSystemPrompt(ctx: ReadingContext): string {
  const lines: string[] = [
    "You are a reading companion embedded in a PDF reader. The user is reading",
    "closely and pulls you in by marking a passage with an AI pen; you answer",
    "right there, beside the text.",
    "",
    "How to answer:",
    "- Get to the point. Explain the marked passage directly; no preamble, no",
    "  restating the whole passage back to them.",
    "- Be concise and concrete. A few sentences usually beats a lecture.",
    "- Follow the user's language: if they write in Chinese, answer in Chinese.",
    "- You can see the passage below, so refer to it naturally rather than",
    "  quoting it in full.",
    "- Your replies render as Markdown: write math as LaTeX delimited by $...$",
    "  (inline) or $$...$$ (block), and put code in fenced code blocks.",
    "",
    "Current reading context:",
    `- Topic: ${ctx.topicName}`,
    `- File: ${ctx.fileName}`,
  ];
  if (ctx.pageLabel) lines.push(`- Page: ${ctx.pageLabel}`);
  lines.push(`- Marked passage: "${ctx.selectionText.trim()}"`);
  if (ctx.selectionComment && ctx.selectionComment.trim()) {
    lines.push(`- The user's note on it: "${ctx.selectionComment.trim()}"`);
  }
  return lines.join("\n");
}
