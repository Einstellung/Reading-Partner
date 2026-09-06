// One agent run on pi-agent-core's Agent, with everything this project will not
// give up kept outside it.
//
// The Agent owns what a loop is good at: streaming a turn, executing the tool
// calls it asks for, feeding the results back, and — the reason to adopt it at
// all — two message queues, so a run can be steered while it is working
// (`steer`) or given more to do once it stops (`followUp`). Nothing else about
// it is trusted with a decision:
//
//   shouldStopAfterTurn  the turn cap, and the mid-run budget verdict.
//   transformContext     the one reduction available before a request goes out
//                        (src/budget's fitRoundToBudget, the same call the
//                        hand-written loop makes, so the two cannot drift).
//   afterToolCall        the tool tally the evidence rule is decided from.
//   runWithWatchdog      wraps the whole run: a stall aborts and re-runs it.
//
// The result is a SubagentBrief, composed by the same brief.ts as runSubagent —
// so an honest failure reads identically whichever loop produced it, which is
// what makes switching a caller over a swap rather than a rewrite.
//
// Nothing calls this yet. src/legion/subagent/run.ts still drives the
// hand-written loop; this entry exists to be held against it in tests first.

import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool as PiAgentTool,
  type AgentToolResult,
  type QueueMode,
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingLevel,
  Tool,
} from "@earendil-works/pi-ai";
import { fitRoundToBudget, type BudgetPurpose } from "../../budget";
import type { AgentTool, StreamFn } from "../../ai/agent";
import {
  DEFAULT_MAX_RETRIES,
  ModelCallError,
  resolveCall,
  toPiMessages,
  type ChatMessage,
  type ProviderId,
  type ResponseHead,
} from "../../ai/providers";
import { composeBrief, withBriefContract, EMPTY_ANSWER, type BriefFacts } from "../subagent/brief";
import type { SubagentLedger } from "../subagent/ledger";
import {
  DEFAULT_BRIEF_TOKEN_CAP,
  DEFAULT_SUBAGENT_ROUNDS,
  type SubagentBrief,
  type SubagentOutcome,
  type SubagentToolFailure,
} from "../subagent/types";
import { StoppedError } from "../stop";
import { realTimers, type RunTimers } from "./observable-run";
import { resolveWatchdogConfig, runWithWatchdog, type WatchdogConfig } from "./watchdog";

// The model and effort one run is sent with. Resolved through the same
// resolveCall the conversational path uses, so OAuth credentials, the transport
// choice and the reasoning gate are whatever the app already decided.
export interface AgentTurnModel {
  providerId: ProviderId;
  modelId: string;
  reasoning?: ThinkingLevel;
}

// What the caller injects instead of a provider. Tests hand in a scripted
// stream; production leaves it out and the app's credentials are resolved.
export interface ResolvedStream {
  model: Model<Api>;
  stream: StreamFn;
  apiKey?: string;
}

export interface AgentTurnRequest {
  // Names the run in every honest-failure sentence ("The research sub-agent
  // used all 6 of its turns…"). Lowercase with underscores, like a tool name.
  name: string;
  // The caller's own instructions. The brief contract is appended, because the
  // model has to be told that only its last message survives.
  systemPrompt: string;
  // The whole list this run starts from. The last message is the prompt; the
  // ones before it are replayed as history.
  messages: ChatMessage[];
  tools: AgentTool[];
  model: AgentTurnModel;
  // The output floor each round is sized against. "chat" when unset.
  purpose?: BudgetPurpose;
  // Model turns this run may spend, before the ledger has its say.
  maxRounds?: number;
  // A shared pot for the caller's whole turn. Absent means the run gets its cap
  // outright.
  ledger?: SubagentLedger;
  // Whether a brief may be built out of a run in which no tool ever succeeded.
  // Defaults to "required" whenever tools are mounted.
  evidence?: "required" | "optional";
  briefTokenCap?: number;
  signal?: AbortSignal;
  // How the two queues drain. pi's own default is one-at-a-time for both, and
  // it is kept: an interruption is answered before the next one is read.
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  watchdog?: Partial<WatchdogConfig>;
  timers?: RunTimers;
  onResponse?: ResponseHead;
  onRound?(info: { round: number; rounds: number }): void;
  // The name of an injected tool that just started. A name only, and only ever
  // one the caller mounted itself.
  onTool?(name: string): void;
  resolve?(): Promise<ResolvedStream>;
}

// A run in progress. `result` is the only thing that settles; the two queue
// methods are fire-and-forget and are safe before the first round starts.
export interface AgentTurn {
  // The brief. Rejects only for cancellation (StoppedError) — every other way a
  // run can end is an outcome, because a caller that has to tell six failures
  // apart by catching them will get one of them wrong.
  result: Promise<SubagentBrief>;
  // Cut in while the run is working. The message lands after the tool results
  // of the round it interrupted, so the model sees the work it already did.
  steer(text: string): void;
  // Give the run more to do once it would otherwise stop.
  followUp(text: string): void;
}

// A tally of what each injected tool did. The only thing this module learns
// about the tools it was handed: it never inspects a name, a schema or a result.
class ToolTally {
  calls = 0;
  successes = 0;
  private failures = new Map<string, SubagentToolFailure>();

  fail(name: string, reason: string): void {
    const existing = this.failures.get(name);
    // The first reason is kept: it describes a working run going wrong, and
    // later attempts often fail differently as a consequence.
    if (existing) existing.count++;
    else this.failures.set(name, { name, reason, count: 1 });
  }

  list(): SubagentToolFailure[] {
    return [...this.failures.values()];
  }
}

function userMessage(text: string): Message {
  return { role: "user", content: text, timestamp: Date.now() };
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function wantsTools(message: AssistantMessage): boolean {
  return message.content.some((c) => c.type === "toolCall");
}

function errorText(content: readonly (TextContent | ImageContent)[]): string {
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .trim();
}

// Our AgentTool in pi-agent-core's shape. The two differ in three places: pi
// passes the call id and a partial-update callback we have no use for, wants a
// `label`, and takes content blocks rather than text-plus-images. A throw is
// left to propagate — pi turns it into an error tool result the model can react
// to, exactly as the hand-written loop does.
function toPiAgentTool(tool: AgentTool): PiAgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_id, params): Promise<AgentToolResult<null>> => {
      const raw = await tool.execute(params as Record<string, any>);
      const text = typeof raw === "string" ? raw : raw.text;
      const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
      if (typeof raw !== "string") {
        for (const im of raw.images ?? []) {
          content.push({ type: "image", data: im.data, mimeType: im.mimeType });
        }
      }
      return { content, details: null };
    },
  };
}

// How one attempt ended, before the evidence rule and the brief cap get a say.
type RunEnd =
  | { kind: "answer"; text: string }
  | { kind: "out-of-turns" }
  | { kind: "out-of-context" };

function evidenceRequired(request: AgentTurnRequest): boolean {
  if (request.evidence) return request.evidence === "required";
  return request.tools.length > 0;
}

// Resolve the app's provider for this run, and put back what Agent's own loop
// config does not carry: the client-side retry count on the request that opens
// each round's stream.
async function resolveDefault(request: AgentTurnRequest): Promise<ResolvedStream> {
  const call = await resolveCall(
    request.model.providerId,
    request.model.modelId,
    request.messages,
    request.model.reasoning,
  );
  const stream: StreamFn = (model, context, options) =>
    call.provider.streamSimple(model, context, {
      maxRetries: DEFAULT_MAX_RETRIES,
      transport: call.transport,
      onResponse: request.onResponse,
      ...options,
      apiKey: options?.apiKey ?? call.apiKey,
    });
  return { model: call.model, stream, apiKey: call.apiKey };
}

export function startAgentTurn(request: AgentTurnRequest): AgentTurn {
  const tokenCap = request.briefTokenCap ?? DEFAULT_BRIEF_TOKEN_CAP;
  const purpose = request.purpose ?? "chat";
  const want = request.maxRounds ?? DEFAULT_SUBAGENT_ROUNDS;
  const reserved = request.ledger ? request.ledger.grant(want) : want;
  const systemPrompt = withBriefContract(request.systemPrompt, tokenCap);
  const piTools: Tool[] = request.tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));

  const tally = new ToolTally();
  let rounds = 0;

  // The queues, buffered until an Agent exists. steer() is callable the moment
  // startAgentTurn returns, and a watchdog retry builds a fresh Agent, so the
  // handle cannot simply be pi's.
  let live: Agent | undefined;
  const queued: { steer: Message[]; followUp: Message[] } = { steer: [], followUp: [] };

  const finish = (partial: Partial<BriefFacts> & { outcome: SubagentOutcome }): SubagentBrief => {
    const facts: BriefFacts = {
      name: request.name,
      answer: "",
      rounds,
      roundsAllowed: reserved,
      toolsMounted: request.tools.length,
      toolCalls: tally.calls,
      toolSuccesses: tally.successes,
      toolFailures: tally.list(),
      tokenCap,
      ...partial,
    };
    const composed = composeBrief(facts);
    return {
      brief: composed.brief,
      outcome: facts.outcome,
      usable: composed.usable,
      rounds,
      roundsAllowed: reserved,
      toolCalls: facts.toolCalls,
      toolSuccesses: facts.toolSuccesses,
      toolFailures: facts.toolFailures,
      clipped: composed.clipped,
    };
  };

  // One attempt: a fresh Agent over the original messages, run to idle. A stall
  // aborts it and the watchdog calls this again, which is why nothing outside
  // the tally and the round count survives an attempt.
  const attempt = async (
    resolved: ResolvedStream,
    signal: AbortSignal,
    onProgress: (chars: number) => void,
  ): Promise<RunEnd> => {
    const piMessages = toPiMessages(request.messages);
    if (piMessages.length === 0) throw new Error("an agent turn needs at least one message");
    const prompt = piMessages[piMessages.length - 1];

    let stopFor: "out-of-turns" | "out-of-context" | undefined;
    let last: AssistantMessage | undefined;
    let chars = 0;

    const agent = new Agent({
      streamFn: resolved.stream,
      initialState: {
        model: resolved.model,
        systemPrompt,
        thinkingLevel: request.model.reasoning ?? "off",
        messages: piMessages.slice(0, -1),
        tools: request.tools.map(toPiAgentTool),
      },
      getApiKey: () => resolved.apiKey,
      onResponse: request.onResponse,
      steeringMode: request.steeringMode ?? "one-at-a-time",
      followUpMode: request.followUpMode ?? "one-at-a-time",
      // Sized before every request, not just the first: each round grows the
      // history by an assistant turn and its tool results, and a round that
      // outgrows the window is not refused by the provider — pi clamps the
      // allowed output to 1 and the model emits one token (docs/pitfall/65).
      transformContext: async (messages) => {
        const fit = fitRoundToBudget({
          model: resolved.model,
          systemPrompt,
          messages: messages as Message[],
          tools: piTools,
          purpose,
        });
        return fit.messages as AgentMessage[];
      },
      afterToolCall: async ({ toolCall, result, isError }) => {
        tally.calls++;
        if (isError) tally.fail(toolCall.name, errorText(result.content) || "tool call failed");
        else tally.successes++;
        return undefined;
      },
      // The two gates that end a run early. Both only apply to a turn that
      // wants to keep going: a turn that wrote a plain answer has already
      // finished, and stopping "after" it would say the wrong thing.
      shouldStopAfterTurn: ({ message, context }) => {
        if (!wantsTools(message as AssistantMessage)) return false;
        if (rounds >= reserved) {
          stopFor = "out-of-turns";
          return true;
        }
        const fit = fitRoundToBudget({
          model: resolved.model,
          systemPrompt,
          messages: context.messages as Message[],
          tools: piTools,
          purpose,
        });
        if (!fit.fits) {
          stopFor = "out-of-context";
          return true;
        }
        return false;
      },
    });

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === "turn_start") {
        rounds++;
        request.onRound?.({ round: rounds, rounds: reserved });
      } else if (event.type === "tool_execution_start") {
        request.onTool?.(event.toolName);
      } else if (event.type === "message_update") {
        // Liveness for the watchdog. Thinking counts: a model that reasons for a
        // long stretch before writing anything is not stalled.
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta" || ev.type === "thinking_delta") {
          chars += ev.delta.length;
          onProgress(chars);
        }
      } else if (event.type === "message_end") {
        const message = event.message as AgentMessage & { role?: string };
        if (message.role === "assistant") last = message as AssistantMessage;
      }
    });

    const onAbort = () => agent.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    live = agent;
    for (const m of queued.steer.splice(0)) agent.steer(m);
    for (const m of queued.followUp.splice(0)) agent.followUp(m);

    try {
      await agent.prompt(prompt);
      await agent.waitForIdle();
    } finally {
      live = undefined;
      signal.removeEventListener("abort", onAbort);
      unsubscribe();
    }

    // A provider failure is thrown rather than returned, so the watchdog gets to
    // classify it: a 429 is worth another attempt, a bad key is not. It carries
    // pi's own AssistantMessage for exactly that reason.
    if (last && (last.stopReason === "error" || last.stopReason === "aborted")) {
      if (request.signal?.aborted) throw new StoppedError();
      throw new ModelCallError(last.errorMessage || "stream error", { assistant: last });
    }
    if (stopFor) return { kind: stopFor };
    return { kind: "answer", text: last ? textOf(last) : "" };
  };

  const run = async (): Promise<SubagentBrief> => {
    if (request.signal?.aborted) throw new StoppedError();
    // The shared pot was already spent. Nothing is sent, and the brief says
    // nothing was looked up rather than that nothing was found.
    if (reserved <= 0) return finish({ outcome: "out-of-budget" });

    try {
      const resolved = request.resolve ? await request.resolve() : await resolveDefault(request);
      const end = await runWithWatchdog<RunEnd>(
        (opts) => attempt(resolved, opts.signal, opts.onProgress),
        resolveWatchdogConfig(request.watchdog),
        request.timers ?? realTimers,
        { onAttempt: () => {}, onProgress: () => {} },
        request.signal,
      );

      if (end.kind === "out-of-turns") return finish({ outcome: "out-of-turns" });
      if (end.kind === "out-of-context") return finish({ outcome: "out-of-context" });

      const answer = end.text.trim();
      if (!answer) return finish({ outcome: "refused", message: EMPTY_ANSWER });
      // A brief with nothing behind it is the failure this whole shape exists to
      // stop, so it is caught here rather than left to the caller to notice.
      if (evidenceRequired(request) && tally.successes === 0) {
        return finish({ outcome: "no-evidence" });
      }
      return finish({ outcome: "answered", answer });
    } catch (e) {
      // Cancellation is not a failure and must never become a brief: a brief for
      // a run the reader hung up on is a brief nobody asked for.
      if (e instanceof StoppedError || request.signal?.aborted) throw new StoppedError();
      return finish({ outcome: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      request.ledger?.settle(reserved, rounds);
    }
  };

  const enqueue = (into: "steer" | "followUp", text: string): void => {
    const message = userMessage(text);
    if (!live) queued[into].push(message);
    else if (into === "steer") live.steer(message);
    else live.followUp(message);
  };

  return {
    result: run(),
    steer: (text) => enqueue("steer", text),
    followUp: (text) => enqueue("followUp", text),
  };
}
