// What the model is told about web_search (docs/info/24). The tool's description
// says what it does, not when to reach for it: with nothing else said, a turn
// whose read_page failed on a cited URL told the reader fetching was not allowed
// and answered from memory without ever searching.
//
// Every desk that mounts web_search takes this paragraph from here, gated on
// the tool actually being mounted; where the provider has no search channel the
// one line in its place is what lets the model say so honestly.

import { WEB_SEARCH_TOOL } from "./tool";

export const WEB_SEARCH_PROMPT = [
  "Web search:",
  "Call web_search first when a question needs facts from outside the material in front of you:",
  "an original text the reader asks for, anything recent, anything the material at hand does not",
  "contain. read_page is for a URL you already have, including one a search cited. If read_page",
  "fails on a URL, search for that page or its content instead of giving up. Never tell the reader",
  "you cannot go online while web_search is mounted. Say plainly which parts of your answer came",
  "from a search and which from your own memory.",
].join("\n");

export const WEB_SEARCH_UNAVAILABLE_PROMPT =
  "Web search is not available on the current provider. When a question needs it, tell the reader " +
  "that plainly instead of blaming a failed page fetch.";

/** The web-search paragraph for a turn that mounted these tools. */
export function webSearchPrompt(toolNames: readonly string[]): string {
  return toolNames.includes(WEB_SEARCH_TOOL) ? WEB_SEARCH_PROMPT : WEB_SEARCH_UNAVAILABLE_PROMPT;
}
