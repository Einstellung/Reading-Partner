// What the conversation model reads back from web_search: the answer with its
// `[n]` markers and a numbered source list, under a hard size cap. When the
// cap bites the answer is cut and every source stays, since the sources are
// what read_page opens next.
//
// Portions adapted from pi-web-search by ttttmr (https://www.npmjs.com/package/pi-web-search),
// MIT License; see LICENSE.pi-web-search in this directory.

import type { SearchOutcome } from "./results";

export const WEB_SEARCH_MAX_CHARS = 8000;
const MAX_SOURCES = 20;
const MAX_TITLE = 120;
const CUT = "\n[answer truncated]";

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function formatSearchResult(outcome: SearchOutcome, maxChars = WEB_SEARCH_MAX_CHARS): string {
  const sources = outcome.sources.slice(0, MAX_SOURCES);
  const list = sources.length
    ? `\n\nSources:\n${sources.map((s, i) => `[${i + 1}] ${clip(s.title, MAX_TITLE)} — ${s.url}`).join("\n")}`
    : "\n\nSources: none returned.";
  const room = Math.max(0, maxChars - list.length);
  const answer = outcome.text.trim();
  const body = answer.length > room ? answer.slice(0, Math.max(0, room - CUT.length)) + CUT : answer;
  return (body + list).slice(0, maxChars);
}
