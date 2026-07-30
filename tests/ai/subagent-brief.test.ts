// What a sub-agent is allowed to say, and the round ledger behind it
// (src/ai/subagent/brief.ts, ledger.ts). Pure: no model, no tools, no network.
// Run: bun test.
//
// These tests are the specification of the honest-failure rule. Each one asserts
// both halves: that the brief says what happened, and that it cannot be read as
// a finding.

import { expect, test } from "bun:test";
import {
  briefContractPrompt,
  clipToTokens,
  composeBrief,
  subagentSystemPrompt,
  type BriefFacts,
} from "../../src/ai/subagent/brief";
import { createSubagentLedger } from "../../src/ai/subagent/ledger";
import { estimateTextTokens } from "../../src/budget";
import type { SubagentDefinition } from "../../src/ai/subagent/types";

function facts(over: Partial<BriefFacts> = {}): BriefFacts {
  return {
    name: "research_literature",
    answer: "",
    outcome: "answered",
    rounds: 3,
    roundsAllowed: 6,
    toolsMounted: 2,
    toolCalls: 4,
    toolSuccesses: 4,
    toolFailures: [],
    tokenCap: 1200,
    ...over,
  };
}

test("an answered run comes back as the model wrote it, with no note bolted on", () => {
  const c = composeBrief(facts({ answer: "Three papers since 2024: A, B, C." }));
  expect(c.usable).toBe(true);
  expect(c.clipped).toBe(false);
  expect(c.brief).toBe("Three papers since 2024: A, B, C.");
});

test("a spent turn cap says so, and says it is not an empty result", () => {
  const c = composeBrief(facts({ outcome: "out-of-turns", answer: "", rounds: 6 }));
  expect(c.usable).toBe(false);
  expect(c.brief).toContain("research_literature");
  expect(c.brief).toContain("all 6 of its turns");
  expect(c.brief).toContain("not a finding");
  expect(c.brief).toContain("must not be reported as if the search came back empty");
});

test("a run that never started says nothing was looked up", () => {
  const c = composeBrief(facts({ outcome: "out-of-budget", roundsAllowed: 0, rounds: 0 }));
  expect(c.usable).toBe(false);
  expect(c.brief).toContain("did not run at all");
  expect(c.brief).toContain("Nothing was looked up");
  expect(c.brief).toContain("not a finding");
});

test("a run that outgrew the window is not the same sentence as a spent cap", () => {
  const capped = composeBrief(facts({ outcome: "out-of-turns" })).brief;
  const overflowed = composeBrief(facts({ outcome: "out-of-context", rounds: 4 })).brief;
  expect(overflowed).toContain("stopped after 4 turns");
  expect(overflowed).toContain("no longer left the model room to answer");
  expect(overflowed).not.toBe(capped);
});

// The failure this module exists to prevent: a fluent paragraph with nothing
// behind it, arriving as an answer.
test("every tool having failed discards the answer and names the failures", () => {
  const c = composeBrief(
    facts({
      outcome: "no-evidence",
      answer: "The consensus in the field is that scaling laws hold.",
      toolSuccesses: 0,
      toolCalls: 3,
      toolFailures: [{ name: "search_papers", reason: "network error", count: 3 }],
    }),
  );
  expect(c.usable).toBe(false);
  expect(c.brief).not.toContain("consensus");
  expect(c.brief).toContain("every one of them failed");
  expect(c.brief).toContain("search_papers: network error");
  expect(c.brief).toContain("×3");
  expect(c.brief).toContain("not returned");
});

test("answering without touching the tools discards the answer too", () => {
  const c = composeBrief(
    facts({
      outcome: "no-evidence",
      answer: "I already know the answer.",
      toolCalls: 0,
      toolSuccesses: 0,
      toolsMounted: 2,
    }),
  );
  expect(c.usable).toBe(false);
  expect(c.brief).not.toContain("already know");
  expect(c.brief).toContain("without calling any of its 2 tools");
  expect(c.brief).toContain("nothing in that answer was looked up");
});

test("a partial tool failure is a note on a usable brief, not a discard", () => {
  const c = composeBrief(
    facts({
      answer: "Two papers: A and B.",
      toolCalls: 4,
      toolSuccesses: 3,
      toolFailures: [{ name: "walk_citations", reason: "429 rate limited", count: 1 }],
    }),
  );
  expect(c.usable).toBe(true);
  expect(c.brief).toContain("Two papers: A and B.");
  expect(c.brief).toContain("Sub-agent note:");
  expect(c.brief).toContain("1 of its 4 tool calls failed");
  expect(c.brief).toContain("walk_citations: 429 rate limited");
  expect(c.brief).toContain("may be incomplete");
});

test("a failed call is marked as a failure, not as an empty result", () => {
  const c = composeBrief(facts({ outcome: "failed", message: "401 invalid api key" }));
  expect(c.usable).toBe(false);
  expect(c.brief).toContain("401 invalid api key");
  expect(c.brief).toContain("failed call, not an empty result");
});

test("an answered run with an empty answer is not an answer", () => {
  const c = composeBrief(facts({ answer: "   " }));
  expect(c.usable).toBe(false);
  expect(c.brief).toContain("without writing a brief");
});

// --- the cap on what crosses back (src/budget prices it) ---

test("a brief over its cap is cut and says it was cut", () => {
  const answer = "paper. ".repeat(2_000);
  const c = composeBrief(facts({ answer, tokenCap: 60 }));
  expect(c.usable).toBe(true);
  expect(c.clipped).toBe(true);
  expect(c.brief).toContain("longer than 60 tokens and was cut off");
  // The kept text really is under the cap, measured the same way.
  const body = c.brief.split("\n\nSub-agent note:")[0];
  expect(estimateTextTokens(body)).toBeLessThanOrEqual(60);
});

test("clipping is script-aware, so a Chinese brief is not measured as English", () => {
  // pi charges chars/4 for every script; the estimator this uses charges dense
  // scripts by the character, so 50 tokens is about 50 characters, not 200.
  const chinese = "综".repeat(400);
  const clipped = clipToTokens(chinese, 50);
  expect(clipped.clipped).toBe(true);
  expect(clipped.text.length).toBe(50);
  expect(estimateTextTokens(clipped.text)).toBeLessThanOrEqual(50);
});

test("a brief already inside its cap is untouched", () => {
  expect(clipToTokens("short", 100)).toEqual({ text: "short", clipped: false });
});

// --- the prompt the run is sent with ---

test("the brief contract tells the run that its intermediate work is discarded", () => {
  const prompt = briefContractPrompt(1200);
  expect(prompt).toContain("discarded");
  expect(prompt).toContain("Only");
  expect(prompt).toContain("final message");
  expect(prompt).toContain("Name your sources");
  expect(prompt).toContain("say that instead of answering from");
});

test("the definition's own prompt comes first, the contract after it", () => {
  const definition = {
    name: "n",
    description: "d",
    label: "l",
    systemPrompt: "You look up papers.",
    tools: [],
  } satisfies SubagentDefinition;
  const prompt = subagentSystemPrompt(definition, 1200);
  expect(prompt.startsWith("You look up papers.")).toBe(true);
  expect(prompt).toContain("You are a sub-agent");
});

// --- the shared round budget ---

test("the ledger hands out turns until the caller's turn has none left", () => {
  const ledger = createSubagentLedger(8);
  expect(ledger.grant(6)).toBe(6);
  expect(ledger.remaining()).toBe(2);
  expect(ledger.grant(6)).toBe(2);
  expect(ledger.grant(6)).toBe(0);
});

test("unspent turns come back, so a cheap run does not cost the whole pot", () => {
  const ledger = createSubagentLedger(8);
  const reserved = ledger.grant(6);
  ledger.settle(reserved, 2);
  expect(ledger.remaining()).toBe(6);
});

test("a run cannot settle for more than it reserved", () => {
  const ledger = createSubagentLedger(8);
  const reserved = ledger.grant(6);
  ledger.settle(reserved, 99);
  expect(ledger.remaining()).toBe(2);
});
