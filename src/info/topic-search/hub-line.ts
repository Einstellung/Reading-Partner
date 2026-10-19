// A paper's Hugging Face facts as the rerank and the write-up see them
// (docs/info/88 「打分」「结果」): reference for the models, never a score term.
// The counts and the repository's name are the program's; the line goes into
// the prompt and into the write-up's number check, and the result file keeps
// the facts themselves (`TopicSearchResultItem.hub`), so nothing here is
// copied back out of a reply.

import { cut } from "./model-io";
import type { HubFacts } from "./result-types";

/** Characters of the Hub's machine-written summary a prompt shows. */
export const HUB_SUMMARY_CHARS = 240;

/** What the rerank and the write-up are told about the Hub lines. */
export const HUB_RULE =
  "A paper may carry a Hugging Face line: its upvotes there, its GitHub repository and that repository's stars, whether it has a project page, and the Hub's machine-written summary. " +
  "Upvotes and stars show community attention, not quality or fit to the topic. The machine-written summary is unchecked: never take a fact or a number from it.";

/** "owner/repo" of a GitHub URL; the text as given otherwise. */
export function repoName(repo: string): string {
  const m = /github\.com\/([^/\s?#]+\/[^/\s?#]+)/i.exec(repo);
  return m ? m[1].replace(/\.git$/i, "") : repo;
}

/** The Hub's counts and links in one line; null when it has none. */
export function hubLine(hub: HubFacts | undefined): string | null {
  if (!hub) return null;
  const parts: string[] = [];
  if (hub.upvotes !== undefined) parts.push(`${hub.upvotes} upvotes`);
  if (hub.repo) parts.push(`GitHub repository ${repoName(hub.repo)}${hub.stars !== undefined ? ` (${hub.stars} stars)` : ""}`);
  if (hub.projectPage) parts.push("has a project page");
  return parts.length ? `Hugging Face: ${parts.join("; ")}` : null;
}

/** The Hub's machine-written summary, labelled and cut; null when there is none. */
export function hubSummaryLine(hub: HubFacts | undefined, chars = HUB_SUMMARY_CHARS): string | null {
  const text = hub?.aiSummary?.trim();
  return text ? `Hugging Face's machine-written summary (unchecked): ${cut(text, chars)}` : null;
}

/** Both lines, those there are. */
export function hubLines(hub: HubFacts | undefined): string[] {
  return [hubLine(hub), hubSummaryLine(hub)].filter((l): l is string => l !== null);
}
