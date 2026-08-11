// The sub-agent contract (docs/25): run a task in an agent loop whose message
// list, tools and intermediate products belong to that run alone, and hand the
// caller one short brief.
//
// Why the types live apart from the runner: every field here is something a
// domain has to decide when it defines a sub-agent, and the whole point of the
// capability is that a domain can read the contract without reading the loop.
//
// This directory is a capability. It knows nothing about literature search,
// briefings or books: the system prompt, the task and every tool are injected.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { BudgetPurpose } from "../../budget";
import type { AgentTool } from "../agent";
import type { ProviderId } from "../providers";

// A cheaper (or just different) model for one sub-agent. A run that only looks
// things up and lists what it found does not need the model the reader is
// talking to, and the caller is the only one who can judge that — so it is a
// field of the definition rather than a rule in here. Unset resolves the app's
// default model with the background-pipeline thinking setting.
export interface SubagentModel {
  providerId: ProviderId;
  modelId: string;
  reasoning?: ThinkingLevel;
}

// What a sub-agent is: a prompt, a narrow tool set, and a cap.
export interface SubagentDefinition {
  // The tool name the parent mounts this under, and the name that appears in
  // every honest-failure sentence. Lowercase with underscores: pi-ai rewrites
  // tool names matching Claude Code's canonical set on the OAuth channel
  // (docs/24), and subagentTool rejects anything that could collide.
  name: string;
  // What the parent model reads to decide whether to call it.
  description: string;
  // What the parent model should put in `task`. Defaults to a generic line.
  taskDescription?: string;
  // One line for the reader while it runs ("Searching the literature"). The
  // caller writes it, because only the caller knows what this run is for; the
  // runner never composes a status line out of a tool call.
  label: string;
  // The sub-agent's own role and instructions. The brief contract is appended.
  systemPrompt: string;
  // Every tool this run may reach. A sub-agent with an empty list is a plain
  // one-shot call and cannot be held to the evidence rule below.
  tools: AgentTool[];
  // Model turns this run may spend. DEFAULT_SUBAGENT_ROUNDS when unset.
  maxRounds?: number;
  // The output floor each of its rounds is sized against (src/budget). "chat"
  // when unset: a brief is short output, so the chat floor is the right one, and
  // a bigger floor would refuse rounds that would have answered fine.
  purpose?: BudgetPurpose;
  model?: SubagentModel;
  // Whether a brief may be built out of a run in which no tool ever succeeded.
  // "required" (the default whenever tools are mounted) is the rule that stops a
  // lookup sub-agent from answering out of the model's memory and having that
  // reach the reader as a finding. "optional" is for a sub-agent whose job is
  // not lookup — rewriting, planning, judging.
  evidence?: "required" | "optional";
  // Token ceiling on the model's own text in the brief (src/budget prices it);
  // the runner's own status lines are short and always kept on top of it. A
  // nested run must not be able to push the caller's next round over the window,
  // and the one thing that crosses back is this text.
  briefTokenCap?: number;
}

// Model turns a sub-agent gets when its definition does not say. Below the
// parent loop's 8: a run that cannot look something up and say what it found in
// six turns is not going to in twelve, and every extra turn is the reader's.
export const DEFAULT_SUBAGENT_ROUNDS = 6;

// Tokens a brief may occupy before it is clipped. Well under OUTPUT_FLOOR.chat
// (4096) on purpose: the brief lands in the caller's context as one tool result
// and has to leave the caller room to actually use it.
export const DEFAULT_BRIEF_TOKEN_CAP = 1200;

// One injected tool that failed, and why. Counted rather than listed one by one:
// the same tool failing five times for the same reason is one fact.
export interface SubagentToolFailure {
  name: string;
  reason: string;
  count: number;
}

// How the run ended. The distinctions are the ones a caller has to be able to
// state to the reader without lying:
//
//   answered       a final answer, with evidence behind it if evidence was required.
//   no-evidence    the model wrote something, but no tool of this run ever
//                  succeeded. The text is not returned: a fluent answer with
//                  nothing behind it is the failure this whole module exists to
//                  prevent from reaching the reader.
//   out-of-turns   spent its turn cap without writing an answer.
//   out-of-budget  the caller's shared round budget for sub-agents was already
//                  spent, so nothing was sent at all.
//   out-of-context a round outgrew the model's context window.
//   refused        the loop declined for another reason it can state.
//   failed         the call itself did not complete (no network, bad key).
export type SubagentOutcome =
  | "answered"
  | "no-evidence"
  | "out-of-turns"
  | "out-of-budget"
  | "out-of-context"
  | "refused"
  | "failed";

// What comes back. `brief` is never empty and never reads as a finding when the
// run did not produce one; `usable` is the caller's one-bit question ("may I
// relay this?"), and everything else is there so the caller can be specific
// about what it is relaying.
export interface SubagentBrief {
  brief: string;
  outcome: SubagentOutcome;
  usable: boolean;
  // Model turns actually streamed, and the allowance this run was granted (which
  // may be below its definition's cap, when a shared ledger had less left).
  rounds: number;
  roundsAllowed: number;
  toolCalls: number;
  toolSuccesses: number;
  toolFailures: SubagentToolFailure[];
  // The model wrote more than briefTokenCap and the brief was cut.
  clipped: boolean;
}

// What the caller may be told while a sub-agent runs.
//
// Deliberately not the tool-call stream. The caller renders one line from
// `label`, which it wrote itself; `tool` carries a tool NAME only, and only ever
// a name the caller injected, so nothing the sub-agent read or wrote can travel
// back this way. Arguments and results never appear here — a query the sub-agent
// invented is its own intermediate product, and a result is the thing this
// module exists to keep out of the caller's context.
export type SubagentPhase = "started" | "round" | "tool" | "done";

export interface SubagentProgress {
  phase: SubagentPhase;
  // The definition's label, repeated on every event so a renderer needs no state.
  label: string;
  // 1-based model turn in progress; 0 before the first one.
  round: number;
  roundsAllowed: number;
  // Set on "tool": the name of the injected tool that just started.
  tool?: string;
  // Set on "done".
  outcome?: SubagentOutcome;
}

// One sub-agent turn, run to completion. Injected so the core is testable with
// no provider, no credentials and no network — the same shape src/observation's
// distillation uses for the same reason. live.ts backs it with runAgentTurn.
//
// It must settle: a cancelled run rejects with StoppedError (the agent loop
// stops silently on abort, so something has to turn that into a rejection).
export interface SubagentTurnRequest {
  systemPrompt: string;
  // The whole message list this run starts from — one user turn. This is the
  // isolation: no caller history is replayed, so nothing the reader said and
  // nothing the caller fetched is in scope, and by construction none of this
  // run's rounds can end up in the caller's list either.
  task: string;
  tools: AgentTool[];
  maxRounds: number;
  purpose: BudgetPurpose;
  model?: SubagentModel;
  signal?: AbortSignal;
  onRound(info: { round: number; rounds: number }): void;
}

export type SubagentTurnOutcome =
  | { kind: "answer"; text: string }
  // The loop gave up for a reason it can state, with nothing having failed.
  | { kind: "refusal"; message: string }
  | { kind: "error"; message: string };

export type SubagentTurnFn = (request: SubagentTurnRequest) => Promise<SubagentTurnOutcome>;
