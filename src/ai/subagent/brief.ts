// What comes back from a sub-agent, and what it is allowed to say. Pure: no
// model, no tools, no clock — every honest-failure sentence in the codebase's
// most load-bearing spot is decided here and unit-tested here.
//
// The rule the wording encodes: a run that gave up says so in the words the
// caller will relay. It must be impossible to read a brief as "there is nothing
// to find" when what happened was "this run stopped early", and impossible for a
// fluent answer with nothing behind it to arrive as an answer at all. The
// precedent is src/reading/prep/search-tool.ts, which throws rather than return
// an empty candidate list when no library answered.

import { estimateTextTokens } from "../../budget";
import type { SubagentDefinition, SubagentOutcome, SubagentToolFailure } from "./types";

// Appended to every sub-agent's own system prompt. It exists because the model
// cannot otherwise know the two things that make this run different from a
// normal turn: nothing it does is visible to anyone, and only its last message
// survives.
export function briefContractPrompt(tokenCap: number): string {
  return [
    "You are a sub-agent working for another agent, not for a person.",
    "",
    "Your tool calls and their results are discarded the moment you finish. Only",
    "your final message is returned, and it is everything the agent that called",
    "you will ever know about this run — it cannot see what you searched, what you",
    "read, or what you tried and abandoned.",
    "",
    "So write that final message as a brief:",
    `- Short. Under roughly ${Math.floor(tokenCap * 0.6)} words; anything longer is cut off.`,
    "- Findings, not process. Never describe which tools you called or in what order.",
    "- Name your sources concretely (titles, ids, links, page numbers) so the caller",
    "  can pass them on and the reader can check them.",
    "- Say plainly what you could not establish. A gap stated is useful; a gap filled",
    "  in from what you already believe is not, and the caller cannot tell them apart.",
    "- If your tools failed or returned nothing, say that instead of answering from",
    "  memory. An answer with nothing behind it is worse than no answer.",
  ].join("\n");
}

// The prompt one sub-agent run is sent with.
export function subagentSystemPrompt(definition: SubagentDefinition, tokenCap: number): string {
  const own = definition.systemPrompt.trim();
  return own ? `${own}\n\n${briefContractPrompt(tokenCap)}` : briefContractPrompt(tokenCap);
}

// The largest prefix of `text` that fits `cap` tokens, priced by src/budget's
// script-aware estimator so a Chinese brief is not measured as if it were
// English. Monotone in the prefix length, so a binary search lands exactly.
export function clipToTokens(text: string, cap: number): { text: string; clipped: boolean } {
  if (cap <= 0) return { text: "", clipped: text.length > 0 };
  if (estimateTextTokens(text) <= cap) return { text, clipped: false };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTextTokens(text.slice(0, mid)) <= cap) lo = mid;
    else hi = mid - 1;
  }
  return { text: text.slice(0, lo).trimEnd(), clipped: true };
}

// The facts a brief is composed from. Everything a caller could be misled about
// is in here, so the composition can be checked without running anything.
export interface BriefFacts {
  name: string;
  // The model's final text, or "" when the run never produced one.
  answer: string;
  outcome: SubagentOutcome;
  rounds: number;
  roundsAllowed: number;
  // Tools the definition mounted, so "answered without calling any of its 3
  // tools" can be said with a number.
  toolsMounted: number;
  toolCalls: number;
  toolSuccesses: number;
  toolFailures: SubagentToolFailure[];
  tokenCap: number;
  // Set for "refused" and "failed": what the loop or the provider said.
  message?: string;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function failureList(failures: SubagentToolFailure[]): string {
  return failures
    .map((f) => `${f.name}: ${f.reason}${f.count > 1 ? ` (×${f.count})` : ""}`)
    .join("; ");
}

// The sentence that stands in for a brief when there is no brief. Every one of
// these ends by saying what it is not, because the caller is a model that will
// otherwise summarise "stopped early" as "found nothing".
const NOT_A_FINDING =
  "This is not a finding: it does not mean there was nothing to find, and must not be reported as if the search came back empty.";

// The reason given when a run ends with a final turn that says nothing.
export const EMPTY_ANSWER = "it finished without writing a brief";

export function failureStatement(f: BriefFacts): string {
  const who = `The ${f.name} sub-agent`;
  switch (f.outcome) {
    case "out-of-turns":
      return (
        `${who} used all ${f.roundsAllowed} of its ${plural(f.roundsAllowed, "turn")} without ` +
        `writing an answer, so it returned nothing. Whatever it read is gone with it. ${NOT_A_FINDING}`
      );
    case "out-of-budget":
      return (
        `${who} did not run at all: the budget for sub-agent work in this turn was already spent. ` +
        `Nothing was looked up. ${NOT_A_FINDING}`
      );
    case "out-of-context":
      return (
        `${who} stopped after ${f.rounds} ${plural(f.rounds, "turn")}: what it had collected no ` +
        `longer left the model room to answer. ${NOT_A_FINDING}`
      );
    case "no-evidence":
      if (f.toolCalls === 0) {
        return (
          `${who} answered without calling any of its ${f.toolsMounted} ` +
          `${plural(f.toolsMounted, "tool")}, so nothing in that answer was looked up. It is not ` +
          `returned. ${NOT_A_FINDING}`
        );
      }
      return (
        `${who} made ${f.toolCalls} tool ${plural(f.toolCalls, "call")} and every one of them ` +
        `failed (${failureList(f.toolFailures)}). It wrote an answer anyway; that answer is not ` +
        `returned, because nothing behind it worked. ${NOT_A_FINDING}`
      );
    case "refused":
      return `${who} declined this task: ${f.message ?? "no reason given"}. ${NOT_A_FINDING}`;
    case "failed":
      return (
        `${who} could not complete: ${f.message ?? "unknown error"}. This is a failed call, not ` +
        `an empty result.`
      );
    case "answered":
      // Not reachable through composeBrief; kept exhaustive so a new outcome
      // cannot be added without deciding what it says.
      return `${who} answered.`;
  }
}

// The line appended to a brief that did come back, when something about the run
// qualifies what it says. Silent when there is nothing to qualify — a note on
// every brief is a note the caller stops reading.
export function briefNote(f: BriefFacts, clipped: boolean): string {
  const parts: string[] = [];
  if (f.toolFailures.length > 0) {
    const failed = f.toolFailures.reduce((n, x) => n + x.count, 0);
    parts.push(
      `${failed} of its ${f.toolCalls} tool ${plural(f.toolCalls, "call")} failed ` +
        `(${failureList(f.toolFailures)}), so this may be incomplete`,
    );
  }
  if (clipped) parts.push(`the brief was longer than ${f.tokenCap} tokens and was cut off`);
  return parts.length === 0 ? "" : `Sub-agent note: ${parts.join("; ")}.`;
}

export interface ComposedBrief {
  brief: string;
  // Whether the caller may relay this as something the sub-agent established.
  usable: boolean;
  clipped: boolean;
}

// The one place a SubagentBrief's text is built. An unusable outcome never
// carries the model's words: not clipped, not quoted, not labelled — left out,
// because a labelled quote is still a paragraph the caller can relay.
export function composeBrief(f: BriefFacts): ComposedBrief {
  if (f.outcome !== "answered") {
    return { brief: failureStatement(f), usable: false, clipped: false };
  }
  const body = f.answer.trim();
  // An "answered" run whose answer is empty is not an answer; the loop can reach
  // that (a last turn that says nothing). runSubagent reports it as "refused"
  // with the same message, so the outcome and the sentence agree.
  if (!body) {
    return {
      brief: failureStatement({ ...f, outcome: "refused", message: EMPTY_ANSWER }),
      usable: false,
      clipped: false,
    };
  }
  const { text, clipped } = clipToTokens(body, f.tokenCap);
  const note = briefNote(f, clipped);
  return { brief: note ? `${text}\n\n${note}` : text, usable: true, clipped };
}
