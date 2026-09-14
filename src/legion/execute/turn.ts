// One tool-calling turn on the durable harness (harness.ts), behind the same
// contract the hand-written loop offered (contract.ts). Streams the model's
// turn; when it requests tool calls, runs them and feeds the results back,
// repeating until the model produces a final text answer or the round cap is
// hit — except that the loop itself is now pi-agent-core's, and every message,
// tool call and tool result is appended to a session file as it happens.
//
// Each turn opens one lane on a fresh session and closes it when the turn ends.
// Which lane, and which group the session is filed under, is the caller's to
// name (`lane`): the reader's turn runs on "turn", a sub-agent runs on a worker
// lane of its own. The session file stays on disk and nothing reads it back: a
// turn is a turn. The soul holding a lane across turns is the next slice.
//
// Where each of the old loop's decisions landed on the harness:
//
//   round cap        before_request hook: the round past the cap is refused
//                    before its request goes out.
//   budget fit       toProviderMessages: src/budget's fitRoundToBudget sizes
//                    every round from the session's messages, and only what it
//                    hands back is sent. A result stubbed in one round stays a
//                    stub in the next — remembered here, never written to the
//                    session — so what was given up does not come back the
//                    moment there is room for it again.
//   both refusals    ask the lane to abort; the run ends "aborted" with the
//                    refusal recorded here, and nothing else was sent.
//   abort            the caller's signal asks the lane to abort. A stream that
//                    reports an abort nobody asked for is treated the same way.
//   telemetry        message_end, once per assistant message that came back
//                    from the provider, failed rounds included.
//   tool args        prepareArguments: validated by pi-ai's validateToolCall
//                    under recordToolArgs, exactly where the loop did it.
//
// What the harness would do on its own and is told not to: retry a failed
// request (pi-ai's own retries on the request are kept, the same number as
// before), compact the context when it grows or overflows, and run a round's
// tool calls in parallel.

import {
  BACKGROUND_CONTEXT,
  type AgentHarness,
  type AgentHarnessTool,
  type AgentMessage,
  type FileSystem,
} from "@earendil-works/pi-agent-core";
import { validateToolCall } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  ProviderHeaders,
  TextContent,
  ThinkingLevel,
  Tool,
  ToolCall,
  Transport,
} from "@earendil-works/pi-ai";
import { fitRoundToBudget, type BudgetPurpose } from "../../budget";
import {
  newRunId,
  recordCacheTurn,
  resolveRetention,
  type TurnTelemetry,
} from "../../platform/app/cache-telemetry";
import { createSessionFileSystem } from "../../platform/app/session-fs";
import { recordToolArgs } from "../../platform/app/structured-output";
import { providerCallSetup } from "../../ai/call-setup";
import { recordModelCall, type ModelCallAbout } from "../../ai/model-usage";
import { DEFAULT_MAX_RETRIES, resolveCall, toPiMessages } from "../../ai/providers";
import { joinRoundTexts } from "../../ai/turn-rows";
import {
  REFUSE_MIDTURN,
  REFUSE_ROUNDS,
  type AgentCallbacks,
  type AgentTool,
  type RunAgentTurnOptions,
  type StreamFn,
  type TurnLane,
} from "./contract";
import { createHarness, createSessionRepo } from "./harness";

export {
  REFUSE_MIDTURN,
  REFUSE_ROUNDS,
  type AgentCallbacks,
  type AgentTool,
  type AgentToolEnd,
  type AgentToolStart,
  type RunAgentTurnOptions,
  type StreamFn,
  type ToolResult,
  type ToolResultImage,
  type TurnLane,
} from "./contract";

const DEFAULT_MAX_ROUNDS = 8;
const PREVIEW_LIMIT = 200;

// The package exports the harness type but not its lane's.
type AgentLane = Awaited<ReturnType<AgentHarness<undefined>["lane"]>>;

// Where a turn runs when the caller does not say: one directory of
// one-file-per-turn sessions beside whatever the soul will keep, and one lane
// in each. A worker names its own (legion/subagent).
const READER_TURN: TurnLane = { name: "turn", sessions: "turn" };

function preview(text: string): string {
  return text.length <= PREVIEW_LIMIT ? text : `${text.slice(0, PREVIEW_LIMIT)}…`;
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function toolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((c): c is ToolCall => c.type === "toolCall");
}

function contentText(content: readonly (TextContent | ImageContent)[]): string {
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

export interface HarnessTurnParams extends AgentCallbacks {
  stream: StreamFn;
  model: Model<Api>;
  apiKey?: string;
  systemPrompt?: string;
  // Already converted to pi's Message shape. The last one is the prompt; the
  // ones before it are the history the run starts from.
  messages: Message[];
  tools: AgentTool[];
  signal?: AbortSignal;
  // Already gated against the model's reasoning support; undefined = off.
  reasoning?: ThinkingLevel;
  // Provider transport preference (SSE for OpenAI; see transportFor).
  transport?: Transport;
  // Provider-required headers for this turn, decided by runAgentTurn where the
  // provider id is known and passed down as data — the stream is injected, so
  // a lookup here would be invisible to every test that drives it. One object
  // for the whole turn: every round of it carries the same session.
  headers?: ProviderHeaders;
  // pi's own session id for this turn, set only for the providers whose models
  // ask pi to send session-affinity headers (src/ai/call-setup.ts). Decided
  // from the same thread as `headers`, and likewise one value for every round.
  sessionId?: string;
  // Client-side retries on the request that opens each round's stream;
  // DEFAULT_MAX_RETRIES when unset. See providers.ts for why it must be passed.
  maxRetries?: number;
  maxRounds: number;
  // Output floor to hold each round to; "chat" when unset.
  purpose?: BudgetPurpose;
  // Already resolved to a thread. Unset in tests that drive the turn directly,
  // which then record nothing.
  telemetry?: TurnTelemetry;
  // What the turn is about, for the model-call log: the book being read, the
  // topic being discussed. Absent on a turn that is about neither.
  about?: ModelCallAbout;
  // Where the turn's session is written. AppData's session store when unset; a
  // test hands in a disk that is a Map.
  fileSystem?: FileSystem;
  // Which lane of which session group this turn runs on; the reader's when
  // unset. Nothing else about the turn changes with it: a worker lane is the
  // same loop under a different name, which is the whole point of the harness
  // owning the loop.
  lane?: TurnLane;
}

// The two ways this turn ends a run on its own: neither is a failure, and the
// harness has no word for either, so the run is aborted and the reason kept.
interface Refusal {
  message: string;
}

// Core turn, provider-injected so tests can drive it with a fake stream. Aborts
// (mid-stream or between tool calls) stop the turn silently — the caller raised
// the signal, so it already knows; no onDone/onError fires.
export async function runHarnessTurn(params: HarnessTurnParams): Promise<void> {
  const { stream, model, apiKey, systemPrompt, tools, signal, reasoning, transport, headers } = params;
  const { sessionId, maxRounds } = params;
  const { onDelta, onThinking, onResponse, onRound, onToolStart, onToolEnd, onDone, onError } = params;
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
  const refuse = params.onRefusal ?? ((message: string) => onError(message));
  const purpose = params.purpose ?? "chat";
  if (signal?.aborted) return;

  const piTools: Tool[] = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
  const modelRef = { providerId: model.provider, modelId: model.id };
  // Read once, beside the send rather than at the log: if this turn ever passes
  // cacheRetention to the stream, it has to pass the same value here or the log
  // describes a setting the request did not carry.
  const retention = resolveRetention();
  const telemetry = params.telemetry;

  // 1-based; counts rounds the harness has started preparing, whether or not
  // they were sent. Stamped before the request rather than after the answer:
  // the entry a round reads was written when the request before it went out,
  // so start-to-start is the interval the retention window is spent on.
  let round = 0;
  let startedAt = 0;
  // The last message the provider answered with, as pi handed it over — the
  // same object, so what onDone carries is what came back.
  let last: AssistantMessage | undefined;
  // What the rounds before the answer wrote, in order. Assistant text only — a
  // tool result is fed back to the model and never joins the reply.
  const written: string[] = [];
  // What the stream function threw, if a throw is what ended the turn. pi turns
  // a throwing stream into an error message; the error's own type is kept here.
  let thrown: unknown;
  let refusal: Refusal | undefined;
  // A callback that threw. The harness isolates a listener's failure and goes
  // on, so it is kept and raised once the run has settled.
  let handlerError: Error | undefined;
  // Tool results stubbed in an earlier round of this turn, by call id.
  const stubs = new Map<string, Message>();

  let lane: AgentLane | undefined;
  let operationId: string | undefined;
  const ctx = BACKGROUND_CONTEXT;

  const abortRun = async (): Promise<void> => {
    if (!lane || !operationId) return;
    try {
      await lane.requestAbort(operationId, ctx);
    } catch {
      // The run already ended, or the harness is closing: nothing left to stop.
    }
  };

  // One line per round that reached the provider, whichever way it ended. A
  // round that failed still spent its input tokens.
  const recordRound = (message: AssistantMessage, ok: boolean): void => {
    if (!telemetry) return;
    // A round is a call: the harness sends one request per round, and the log
    // counts requests. The surface is who spent it, and it is the same value
    // the cache line below carries, so the two logs read against each other.
    recordModelCall({
      caller: telemetry.surface,
      ...params.about,
      provider: model.provider,
      model: model.id,
      usage: message.usage,
      ok,
    });
    recordCacheTurn({
      telemetry,
      providerId: model.provider,
      modelId: model.id,
      round,
      startedAt,
      usage: message.usage,
      ok,
      retention,
    });
  };

  // The stream the harness is handed. The harness decides the signal (its own,
  // aborted through requestAbort) and captures the response head for its
  // after_response hook; everything else about the request is this turn's.
  const streamFn: StreamFn = (m, context, options) => {
    try {
      return stream(m, context, {
        ...options,
        apiKey,
        reasoning,
        transport,
        maxRetries,
        headers,
        sessionId,
        onResponse: async (response, responseModel) => {
          await options?.onResponse?.(response, responseModel);
          await onResponse?.(response, responseModel);
        },
      });
    } catch (e) {
      thrown = e;
      throw e;
    }
  };

  const harnessTools: AgentHarnessTool<undefined>[] = tools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    // Validate/coerce against the tool's schema before executing; a throw here
    // becomes a tool-result error the model can react to, not a crashed turn.
    // Both outcomes are recorded (platform/app/structured-output.ts): this is
    // the tool-argument half of how well models hit a schema, and a failure
    // rate is meaningless without its denominator.
    prepareArguments: (args: unknown) =>
      recordToolArgs(modelRef, tool.name, () =>
        validateToolCall(piTools, {
          type: "toolCall",
          id: "",
          name: tool.name,
          arguments: args as Record<string, any>,
        }),
      ),
    // A throw is left to propagate — the harness turns it into an error tool
    // result whose text is the error's message, exactly as the loop did.
    async execute(_id, args) {
      const raw = await tool.execute(args as Record<string, any>);
      const text = typeof raw === "string" ? raw : raw.text;
      const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
      if (typeof raw !== "string") {
        for (const im of raw.images ?? []) content.push({ type: "image", data: im.data, mimeType: im.mimeType });
      }
      return { content, details: undefined };
    },
  }));

  // Every round grows the history by an assistant turn and its tool results,
  // so a turn that started comfortably can reach the window mid-way; the one
  // reduction available mid-flight is to stub the tool results already
  // collected. Both the sizing and that reduction are src/budget's, so no
  // caller can drift on what "does not fit" means.
  //
  // What the reduction costs when it is not enough: a usage figure describes
  // the request that was already sent, so it does not fall when the history
  // behind it is rewritten. When pi's own number is what is over the line, no
  // edit to the history can help — refusing is the outcome rather than a
  // missed rescue.
  const toProviderMessages = async (history: AgentMessage[]): Promise<Message[]> => {
    const messages = (history as Message[]).map((m) =>
      m.role === "toolResult" ? (stubs.get(m.toolCallId) ?? m) : m,
    );
    const fit = fitRoundToBudget({ model, systemPrompt, messages, tools: piTools, purpose });
    fit.messages.forEach((m, i) => {
      if (m !== messages[i] && m.role === "toolResult") stubs.set(m.toolCallId, m);
    });
    if (!fit.fits) {
      refusal = { message: REFUSE_MIDTURN };
      await abortRun();
      return fit.messages;
    }
    onRound?.({ round, rounds: maxRounds });
    startedAt = Date.now();
    return fit.messages;
  };

  const fileSystem = params.fileSystem ?? createSessionFileSystem();
  const laneId = params.lane ?? READER_TURN;
  const onAbort = (): void => {
    void abortRun();
  };

  let handle: Awaited<ReturnType<typeof createHarness>> | undefined;
  try {
    const repo = createSessionRepo({ fileSystem });
    const session = await repo.create({ cwd: laneId.sessions }, ctx);
    handle = await createHarness(
      {
        fileSystem,
        session,
        model,
        streamFn,
        tools: harnessTools,
        systemPrompt,
        thinkingLevel: reasoning,
        toProviderMessages,
        retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
        compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
        toolExecution: "sequential",
      },
      ctx,
    );
    const { harness } = handle;

    harness.hooks.on("before_request", async ({ step }) => {
      if (step !== "assistant") return undefined;
      round += 1;
      // Same exit as the budget refusal, for the same reason: every round of
      // this turn reached the model and came back. What it did with them —
      // fetching and fetching without concluding — is not a broken call, and a
      // Retry button on it only offers to spend the cap again on the identical
      // ask.
      if (round > maxRounds) {
        refusal = { message: REFUSE_ROUNDS };
        await abortRun();
      }
      return undefined;
    });
    harness.hooks.on("after_response", async ({ message }) => {
      // pi reports an aborted signal as an aborted message; treat it as a
      // silent stop rather than a surfaced failure, whoever raised it.
      if (message.stopReason === "aborted") {
        await abortRun();
        return;
      }
      last = message;
      if (message.stopReason === "error") return;
      const calls = toolCalls(message);
      if (calls.length > 0) written.push(assistantText(message));
      // The harness reads a "length" stop as an overflow to recover from and a
      // "toolUse" stop with no calls as a broken provider; the loop treated
      // both as the answer it got, and so does this turn. What the caller is
      // handed is still the message as it came back.
      if (message.stopReason === "length" || (message.stopReason === "toolUse" && calls.length === 0)) {
        return { message: { ...message, stopReason: calls.length > 0 ? "toolUse" : "stop" } };
      }
    });
    harness.hooks.on("before_compaction", () => ({ decline: true }));

    harness.events.on("message_update", ({ event }) => {
      if (event.type === "text_delta") onDelta(event.delta);
      else if (event.type === "thinking_delta") onThinking?.(event.delta);
    });
    // The round is recorded either way: an abort and a provider failure both
    // leave the tokens the request already cost, and pi fills the usage it had
    // at message_start. A recovery message is the harness's own stand-in for
    // a request that never went out, and is not a round.
    harness.events.on("message_end", ({ message, recovery }) => {
      if (recovery || message.role !== "assistant") return;
      recordRound(message, message.stopReason !== "error" && message.stopReason !== "aborted");
    });
    harness.events.on("tool_start", ({ toolName, args }) => {
      onToolStart({ name: toolName, args: args as Record<string, any> });
    });
    harness.events.on("tool_end", ({ toolName, result, isError }) => {
      onToolEnd({ name: toolName, resultPreview: preview(contentText(result.content)), isError });
    });
    harness.events.on("handler_error", ({ error }) => {
      handlerError ??= new Error(error);
    });

    lane = await harness.lane(laneId.name, ctx);
    signal?.addEventListener("abort", onAbort, { once: true });

    const admitted = await lane.accept({ kind: "prompt", prompt: params.messages as AgentMessage[] }, ctx);
    if (!admitted.ok) {
      onError(admitted.error.message);
      return;
    }
    operationId = admitted.value.operationId;
    // The signal may have fired between the check above and the run existing.
    if (signal?.aborted) await abortRun();

    const driven = await lane.drive({ operationId, waitForRetry: true }, ctx);
    if (!driven.ok) {
      onError(driven.error.message);
      return;
    }
    if (driven.value.kind !== "settled") {
      onError(`the model turn stopped to wait on ${driven.value.reason}`);
      return;
    }
    if (handlerError) throw handlerError;

    const record = driven.value.outcome;
    if (record.status === "aborted") {
      if (refusal) refuse(refusal.message);
      return;
    }
    if (signal?.aborted) return;
    if (record.status === "failed") {
      if (thrown !== undefined) {
        onError(thrown instanceof Error ? thrown.message : String(thrown), undefined, thrown);
      } else {
        onError(last?.errorMessage || record.error?.message || "stream error", last);
      }
      return;
    }
    if (!last) {
      onError("model stream ended without a final message");
      return;
    }
    const text = assistantText(last);
    onDone(text, last, joinRoundTexts([...written, text]));
  } catch (e) {
    if (signal?.aborted) return;
    onError(e instanceof Error ? e.message : String(e), undefined, e);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (handle) {
      try {
        await handle.close(ctx);
      } catch {
        // The turn has already been answered; a session that would not close
        // is the store's problem, not the reply's.
      }
    }
  }
}

// Public entry: resolves the real provider/model/auth (same path as streamChat),
// gates images the same way, then runs the turn.
export async function runAgentTurn(options: RunAgentTurnOptions): Promise<void> {
  const {
    providerId,
    modelId,
    systemPrompt,
    messages,
    tools,
    signal,
    reasoning,
    maxRounds = DEFAULT_MAX_ROUNDS,
    purpose,
    about,
    lane,
    onDelta,
    onThinking,
    onResponse,
    onRound,
    onToolStart,
    onToolEnd,
    onDone,
    onError,
    onRefusal,
  } = options;
  // A run with no conversation of its own is its own thread: nothing before it
  // shares a prefix with it, and a fresh id says exactly that.
  const telemetry: TurnTelemetry = {
    surface: options.telemetry.surface,
    thread: options.telemetry.thread ?? newRunId(),
    ...(options.telemetry.inline ? { inline: options.telemetry.inline } : {}),
  };

  // The turn's session for providers that route on one — OpenCode as a header,
  // Fireworks as pi's own sessionId. It is the thread the cache accounting is
  // already keyed by, and deliberately the same value: they answer the same
  // question — which conversation this turn continues — so successive turns of
  // one conversation send one id, and every round of one turn sends it too
  // (the turn is handed this object once).
  const setup = providerCallSetup(providerId, telemetry.thread);

  try {
    const call = await resolveCall(providerId, modelId, messages, reasoning);

    await runHarnessTurn({
      stream: (m, ctx, opts) => call.provider.streamSimple(m, ctx, opts),
      model: call.model,
      apiKey: call.apiKey,
      systemPrompt,
      messages: toPiMessages(messages),
      tools,
      signal,
      reasoning: call.reasoning,
      transport: call.transport,
      ...setup,
      maxRounds,
      purpose,
      about,
      telemetry,
      ...(lane ? { lane } : {}),
      onDelta,
      onThinking,
      onResponse,
      onRound,
      onToolStart,
      onToolEnd,
      onDone,
      onError,
      onRefusal,
    });
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e), undefined, e);
  }
}
