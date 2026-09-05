// One night of dream (docs/48, "dream"): read every observation nothing stands
// on yet, and write down what is generally true of this reader.
//
// The first version does this one thing. No retrieval, no concerns, no
// association, no forgetting marks — those are named in docs/48 and are not
// here.
//
// Pure but for the two things injected: the model call and the statement store.
// Everything that decides whether a model is called at all happens before it.

import type { CreateStatementInput, Statement } from "../statements/types";
import { selectDreamCandidates, type DreamInput } from "./candidates";
import { materializeDream } from "./materialize";
import { parseProposals, validateProposals } from "./proposals";

// The part of the statement store a night touches. Deliberately narrow: dream
// appends and refreshes, and it deletes nothing (docs/48, "pass 只做追加和刷新").
export interface DreamStore {
  createStatement(input: CreateStatementInput): Promise<Statement>;
  addEvidence(id: string, evidence: readonly string[]): Promise<Statement | null>;
  supersede(oldId: string, input: CreateStatementInput): Promise<Statement | null>;
  // Points a statement at a replacement that already exists. One supersede
  // proposal may name several statements — the store holds the same conclusion
  // twice, once in each language — and supersede() mints the replacement for
  // the first of them; the rest are pointed at it with this.
  markSuperseded(id: string, byId: string): Promise<Statement | null>;
}

export interface DreamModelRequest {
  systemPrompt: string;
  task: string;
}

// Returns the reply text. A failure throws, and comes back as the "failed"
// outcome.
export type DreamCallModel = (request: DreamModelRequest) => Promise<string>;

export interface DreamRunInput extends DreamInput {
  // The hash the last run finished on, or null when there has not been one.
  lastInputHash?: string | null;
}

// Which of the four the night ended in. The enum is the waterline rule
// (docs/49, "结局枚举决定水位线"): "merged" and "no-change" advance
// lastInputHash, "failed" leaves it where it was so the same input is
// reconsidered rather than written off.
//
// "waiting-migration" is the one runDream never returns. The store was still
// half-migrated and live.ts stood the night down before reading anything
// (gate.ts); it advances neither the hash nor the day.
export type DreamOutcome = "no-change" | "merged" | "failed" | "waiting-migration";

export interface DreamResult {
  outcome: DreamOutcome;
  // Observations offered to the model this run.
  candidates: number;
  // Statements created, supported or superseded.
  written: number;
  // Proposals the rules threw away, plus any the store refused.
  dropped: number;
  // The hash to record, and null on any outcome that must not advance it. The
  // caller stores what it is given rather than deciding, so the rule above lives
  // in one place.
  inputHash: string | null;
}

export const DREAM_SYSTEM_PROMPT = [
  "You are going over one reader's observations at the end of the day and writing down",
  "what is generally true of them.",
  "",
  "An observation is something that happened on a day. A statement is what you conclude",
  "from several of them: how this reader reads, what they have understood, what they are",
  "stuck on. A statement carries no date and no hedging — it is a claim, and the",
  "observations behind it are what it rests on.",
  "",
  "Rules:",
  "- A statement needs at least two observations from two different days behind it.",
  "  Something that happened once is not something that is true of a person.",
  "- Write only what the observations support. Do not reach past them.",
  "- When an observation is already covered by a statement that stands, support that",
  "  statement with it rather than writing the claim a second time.",
  "- Supersede a statement only when the evidence has turned against it, or when its",
  "  wording is plainly wrong now. A statement written by the reader is never superseded;",
  "  support it instead.",
  "- When two standing statements say the same thing, supersede both with one statement",
  "  that carries the union of their evidence.",
  "- Write the statement in the language the observations are written in.",
  "- Write the claim itself. Never put an observation id in the text: the evidence list",
  "  carries them.",
  "",
  "Answer with one JSON array and nothing else. Each element is one of:",
  '  {"action":"state","kind":"profile","text":"...","evidence":[1,4]}',
  '  {"action":"support","statement":2,"evidence":[7]}',
  '  {"action":"supersede","statement":2,"text":"...","evidence":[3,9]}',
  '  {"action":"supersede","statement":[2,11],"text":"...","evidence":[3,9]}',
  "",
  "`evidence` holds numbers from the observation list; `statement` is a number from the",
  "statement list, or a list of them when one statement replaces several. An empty array",
  "is a good answer when nothing has come together yet.",
].join("\n");

const TASK_TAIL = "\nSend the JSON array now.";

export async function runDream(
  input: DreamRunInput,
  callModel: DreamCallModel,
  store: DreamStore,
): Promise<DreamResult> {
  const candidates = selectDreamCandidates(input);
  const material = materializeDream(candidates);
  const idle: DreamResult = {
    outcome: "no-change",
    candidates: candidates.observations.length,
    written: 0,
    dropped: 0,
    inputHash: material.hash,
  };
  // Nothing to read, or the same bytes as last night. Either way there is
  // nothing a model could say that it did not already say, so it is not called.
  // The hash still advances on the empty case: it is what the next night
  // compares against, and an empty input is a real state of the store.
  if (candidates.observations.length === 0) return idle;
  if (input.lastInputHash === material.hash) return idle;

  let reply: string;
  try {
    reply = await callModel({
      systemPrompt: DREAM_SYSTEM_PROMPT,
      task: material.text + TASK_TAIL,
    });
  } catch {
    return { ...idle, outcome: "failed", inputHash: null };
  }

  const raw = parseProposals(reply);
  // An answer that is not an array is a failed night rather than an empty one:
  // the model was asked and its answer was lost, which is not the same as it
  // having nothing to say.
  if (raw === null) return { ...idle, outcome: "failed", inputHash: null };

  const { accepted, dropped } = validateProposals(raw, candidates);
  let written = 0;
  let refused = 0;
  for (const proposal of accepted) {
    const evidence = proposal.evidence.map((i) => candidates.observations[i - 1].id);
    try {
      if (proposal.action === "state") {
        await store.createStatement({
          kind: "profile",
          text: proposal.text,
          author: "dream",
          evidence,
        });
        written += 1;
        continue;
      }
      if (proposal.action === "support") {
        const target = candidates.statements[proposal.statement - 1];
        if (await store.addEvidence(target.id, evidence)) written += 1;
        else refused += 1;
        continue;
      }
      const targets = proposal.statements.map((i) => candidates.statements[i - 1]);
      // The first target mints the replacement; the rest are pointed at it. Its
      // kind is the replacement's kind — every target passed the author rule, so
      // they are all statements a night wrote, and a night writes profile.
      const replacement = await store.supersede(targets[0].id, {
        kind: targets[0].kind,
        text: proposal.text,
        author: "dream",
        evidence,
      });
      if (!replacement) {
        // Nothing was created, so there is nothing for the other targets to
        // point at and none of them is touched.
        refused += 1;
        continue;
      }
      written += 1;
      for (const target of targets.slice(1)) {
        // Counted one at a time: a target that went away, or that something
        // else already replaced, costs that target and not the replacement
        // which is on disk either way.
        if (await store.markSuperseded(target.id, replacement.id)) written += 1;
        else refused += 1;
      }
    } catch {
      // One write refused — evidence the store could not date, a statement that
      // went away between the read and the write — is one proposal lost, not a
      // failed night. The proposals are independent of each other, and the ones
      // already written are on disk: reporting failure here would hold the
      // waterline back and offer the same batch again tomorrow, on top of what
      // it already wrote.
      refused += 1;
    }
  }

  return {
    outcome: "merged",
    candidates: candidates.observations.length,
    written,
    dropped: dropped + refused,
    inputHash: material.hash,
  };
}
