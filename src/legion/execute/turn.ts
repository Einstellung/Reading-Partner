// One tool-calling turn on the durable harness (harness.ts), behind the same
// contract the hand-written loop offered (contract.ts). Streams the model's
// turn; when it requests tool calls, runs them and feeds the results back,
// repeating until the model produces a final text answer or the round cap is
// hit — except that the loop itself is now pi-agent-core's, and every message,
// tool call and tool result is appended to a session file as it happens.
//
// Where a turn runs is the caller's to say. With nothing said, it opens one
// lane on a fresh session and closes it when the turn ends; which lane, and
// which group the session is filed under, is `lane` (the reader's turn runs on
// "turn", a sub-agent on a worker lane of its own), and the session file stays
// on disk with nothing reading it back. With `held`, the turn borrows the lane
// of a harness that outlives it (held.ts): the soul's turns all run on one
// lane of one session, each from the session root, so the session records
// them without any of them becoming the next one's context.
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
//                    A read still running is let go of rather than waited
//                    for: pi waits on a tool's promise, and a read that never
//                    settles would hold the run, and the lane, open for ever.
//   time limit       a turn on a held lane gets an allowance (stall.ts,
//                    TURN_LIMIT_MS), from its run starting to its end, tools
//                    included; running out of it aborts the run like a stall.
//   diagnostics      one line per moment of the turn in a local log
//                    (turn-log.ts): start, lane, each round's first byte and
//                    end, and how it ended.
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
  type JsonValue,
  type OperationResultRecord,
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
import { joinRoundTexts } from "../../ai/turn-view/turn-rows";
import {
  REFUSE_MIDTURN,
  REFUSE_ROUNDS,
  STEER_ENDED,
  type AgentCallbacks,
  type AgentTool,
  type Receipt,
  type RunAgentTurnOptions,
  type SteerMessage,
  type SteerPort,
  type StreamFn,
  type TurnLane,
  type TurnWait,
} from "./contract";
import {
  recordLongestSilence,
  StallError,
  STALL_MESSAGE,
  stallWatches,
  TURN_LIMIT_MESSAGE,
  TurnLimitError,
  turnLimitFor,
  type StallWatch,
  type StallWatches,
} from "./stall";
import { appTurnLog, type TurnEnd, type TurnLogEvent, type TurnLogSink } from "./turn-log";
import { normalizeToolResult, toolLabel } from "./tool-result";
import { createHarness, createSessionRepo, sweepSessionGroup } from "./harness";
import type { AgentLane, HeldHarness, HeldLane } from "./held";
import { errMsg } from "../../platform/std/errors";

export {
  REFUSE_MIDTURN,
  REFUSE_ROUNDS,
  STEER_ENDED,
  type AgentCallbacks,
  type AgentTool,
  type AgentToolEnd,
  type AgentToolStart,
  type RunAgentTurnOptions,
  type SteerMessage,
  type SteerOutcome,
  type SteerPort,
  type StreamFn,
  type Receipt,
  type ReceiptLink,
  type ToolEffect,
  type ToolGate,
  type ToolResult,
  type ToolResultImage,
  type TurnLane,
  type TurnWait,
} from "./contract";

const DEFAULT_MAX_ROUNDS = 8;
const PREVIEW_LIMIT = 200;

/**
 * The session entry that says where a turn's reply goes. Written before the
 * prompt is accepted and read back by whoever finds that run still open
 * (src/soul/recover.ts). Nothing projects it, so it never reaches the model.
 */
export const DELIVERY_ENTRY = "reading-partner.delivery";

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

// What a tool call that was let go of says, as its result.
const TOOL_LET_GO = "the turn ended while this tool was still running";

// `work`, unless `signal` aborts first. What `work` goes on to do is nobody's:
// it cannot be stopped from here, only no longer waited for.
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal | undefined, onLetGo: () => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const letGo = (): void => {
      onLetGo();
      reject(new Error(TOOL_LET_GO));
    };
    if (signal.aborted) {
      letGo();
      return;
    }
    signal.addEventListener("abort", letGo, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", letGo);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", letGo);
        reject(error);
      },
    );
  });
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
  // Run on this harness's lane instead of a fresh session: the soul's turns
  // (src/soul/harness.ts). `lane` and `fileSystem` are then the harness's own
  // and ignored here.
  held?: HeldHarness;
  // Where this turn's reply goes, stamped on the session beside the run before
  // it starts, so a later process can rebuild the receiver for a run it finds
  // still open (src/soul/recover.ts). Only a borrowed lane is stamped: a turn
  // with a session of its own is over when the process is.
  deliverTo?: Record<string, unknown>;
  // Where this turn registers its silence watch (stall.ts). The process's own
  // unless a test hands one in; `null` turns the watch off, which is what every
  // turn driven by a scripted stream wants.
  stall?: StallWatches | null;
  // The silence this turn is allowed. The watch's own default unless said.
  stallMs?: number;
  // How long this turn may run, from its run starting to its end, tools
  // included (stall.ts). No limit when unset; rides the stall watch's clock,
  // so `stall: null` turns it off too.
  limitMs?: number;
  // The conversation this turn continues, which is the lane it queues on when
  // `held` is set (held.ts). Ignored on a session of the turn's own.
  conversation?: string;
  // Where the turn's diagnostic lines go (turn-log.ts). Nothing is written
  // when unset.
  log?: TurnLogSink;
  // Finish the operation of this id on the borrowed lane instead of accepting a
  // prompt: `messages` is not sent, because that prompt is already in the
  // session the lane belongs to. Everything else about the turn is unchanged —
  // the same hooks, the same listeners, the same budget fit.
  resume?: string;
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
  const { onSteerable, onSteered, onDelivered, onWait } = params;
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
  const refuse = params.onRefusal ?? ((message: string) => onError(message));
  const purpose = params.purpose ?? "chat";
  if (signal?.aborted) return;

  // The diagnostic record (turn-log.ts). Times are wall-clock, from the turn's
  // start or from the round's request.
  const turnId = newRunId();
  const begunAt = Date.now();
  const note = (event: TurnLogEvent): void => {
    params.log?.({ at: Date.now(), turn: turnId, ...event });
  };
  let endReason: TurnEnd | undefined;
  let endError: string | undefined;
  const ending = (reason: TurnEnd, error?: string): void => {
    endReason ??= reason;
    if (error !== undefined) endError ??= error;
  };
  const wait = (w: TurnWait): void => {
    onWait?.(w);
  };
  note({
    event: "start",
    ...(params.telemetry ? { surface: params.telemetry.surface } : {}),
    ...(params.conversation !== undefined ? { conversation: params.conversation } : {}),
    provider: model.provider,
    model: model.id,
    held: params.held !== undefined,
  });

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

  // Steered messages this turn queued and has not yet seen injected, by the id
  // the lane gave them. A queued message becomes an entry in the transcript
  // when the round boundary drains it, and the entry carries that same id — so
  // `entry_added` is the moment the model was handed it, not a guess from the
  // round after. Nothing is reported twice: an id leaves the set as it lands.
  const queuedSteer = new Set<string>();
  // Of those, the ones the app queued rather than the reader (SteerMessage
  // `internal`). Held apart so the landing is reported on the callback that
  // says whose words they were.
  const internalSteer = new Set<string>();
  // No more queueing: the run has settled (or never started). A steer after
  // this is refused rather than swallowed, because the caller is still holding
  // the reader's sentence.
  let ended = false;
  // The watch said this turn's stream had gone silent, and the abort below is
  // that and not the reader's Stop. Read once the run has settled, where the
  // two are otherwise the same thing.
  let stalled = false;
  // The same, for the turn's whole allowance running out.
  let timedOut = false;
  let watch: StallWatch | undefined;
  // When the round in flight sent its request, and whether anything of its
  // answer has come back yet.
  let requestAt = 0;
  let heard = true;
  // Tool calls let go of because the run was ending (unlessAborted), by id.
  const letGo = new Set<string>();

  const steer: SteerPort = async (message) => {
    const m: SteerMessage = typeof message === "string" ? { text: message } : message;
    if (ended || signal?.aborted || !lane || !operationId) {
      return { ok: false, reason: "ended", message: STEER_ENDED };
    }
    const queued = await lane.steer(m.text, undefined, ctx);
    if (!queued.ok) return { ok: false, reason: "rejected", message: queued.error.message };
    // The run may have settled while the enqueue was in flight; the message is
    // then sitting in a queue nothing will drain.
    if (ended) return { ok: false, reason: "ended", message: STEER_ENDED };
    queuedSteer.add(queued.value.entryId);
    if (m.internal) internalSteer.add(queued.value.entryId);
    return { ok: true, id: queued.value.entryId };
  };

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

  // The tools by name, so the two harness events — which carry a name and not a
  // tool — can reach the label and the effect the tool declared.
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const harnessTools: AgentHarnessTool<Receipt | undefined>[] = tools.map((tool) => ({
    name: tool.name,
    // pi's own label is one fixed string, so it gets the argument-free reading of
    // the tool's label and is only ever a fallback; the line the reader sees is
    // computed per call at tool_start below.
    label: toolLabel(tool, {}),
    description: tool.description,
    parameters: tool.parameters,
    // Whether a call left in flight by a dead process is run again or handed
    // pi's synthetic interrupted result. Declared by the tool; "never" is what
    // pi assumes of one that says nothing.
    ...(tool.replay ? { replay: tool.replay } : {}),
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
    //
    // pi aborts the context it hands a tool when the run is asked to stop, and
    // then waits for the tool (docs/pitfall/500). A tool here takes no signal,
    // so for a read the abort is raced instead: the run settles and the lane is
    // handed back whether or not the read ever does. A write is waited for: one
    // that landed after its turn had ended would land with nobody shown its
    // receipt.
    async execute(id, args, _onUpdate, _toolContext, _invocation, context) {
      const running = tool.execute(args as Record<string, any>);
      const raw = await (tool.effect === "read"
        ? unlessAborted(running, context.abortSignal, () => letGo.add(id))
        : running);
      const { text, images, receipt } = normalizeToolResult(tool, raw);
      const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
      for (const im of images) content.push({ type: "image", data: im.data, mimeType: im.mimeType });
      // pi carries `details` through to tool_end untouched and never shows it to
      // the model: it is the channel a receipt travels on to the UI.
      return { content, details: receipt };
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

  const onAbort = (): void => {
    void abortRun();
  };

  // The stream fell silent for longer than a model ever thinks. The run is
  // ended the one way pi supports mid-flight — the same request the reader's
  // Stop makes — so the operation settles, the lane is handed back and the
  // thread stops counting as busy. What told the two apart is `stalled`.
  const registry = params.stall === undefined ? stallWatches() : params.stall;
  if (registry) {
    watch = registry.watch({
      ...(params.stallMs === undefined ? {} : { stallMs: params.stallMs }),
      onStall: () => {
        stalled = true;
        void abortRun();
      },
      onLimit: () => {
        timedOut = true;
        void abortRun();
      },
    });
    // What is measured is the provider's silence. Until the first request goes
    // out this turn may be queued behind another on a held lane for as long as
    // that one takes; a watch that ran out there would abort nothing and leave
    // the turn unwatched for the stream that follows.
    watch.hold();
  }
  let awaitingFirstRequest = watch !== undefined;

  // One of the two is set: a session of this turn's own, or a borrowed lane.
  let handle: Awaited<ReturnType<typeof createHarness>> | undefined;
  let borrowed: HeldLane | undefined;
  // The hooks and listeners below are this turn's; on a held harness they
  // would otherwise hear every turn after it.
  const subscriptions: (() => void)[] = [];
  try {
    let harness: AgentHarness<undefined>;
    if (params.held) {
      borrowed = await params.held.acquire(
        {
          model,
          streamFn,
          tools: harnessTools,
          systemPrompt,
          toProviderMessages,
          ...(params.conversation !== undefined ? { conversation: params.conversation } : {}),
        },
        ctx,
        signal,
        () => {
          note({ event: "queued" });
          wait({ kind: "queued" });
        },
      );
      harness = borrowed.harness;
      lane = borrowed.lane;
      note({ event: "lane", waitMs: Date.now() - begunAt });
    } else {
      const fileSystem = params.fileSystem ?? createSessionFileSystem();
      const laneId = params.lane ?? READER_TURN;
      const repo = createSessionRepo({ fileSystem });
      // A session of this turn's own, and one file left behind per turn. The
      // same sweep the process-start path runs keeps the group from growing
      // without bound; nothing here settles a previous session, because a turn
      // that is over has no operation anyone is coming back for.
      const session = await repo.create({ cwd: laneId.sessions }, ctx);
      await sweepSessionGroup(fileSystem, session, ctx);
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
      harness = handle.harness;
      lane = await harness.lane(laneId.name, ctx);
    }
    const on: typeof harness.hooks.on = (name, handler) => {
      const off = harness.hooks.on(name, handler);
      subscriptions.push(off);
      return off;
    };
    const listen: typeof harness.events.on = (type, listener) => {
      const off = harness.events.on(type, listener);
      subscriptions.push(off);
      return off;
    };

    on("before_request", async ({ step }) => {
      if (step !== "assistant") return undefined;
      // The clock starts at the request, not at the turn: what is measured is
      // how long this round has been waiting for its first byte.
      if (awaitingFirstRequest) {
        awaitingFirstRequest = false;
        watch?.unhold();
      }
      watch?.beat();
      round += 1;
      requestAt = Date.now();
      heard = false;
      if (round <= maxRounds) wait({ kind: "first-byte", round });
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
    on("after_response", async ({ message }) => {
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
    on("before_compaction", () => ({ decline: true }));

    listen("message_update", ({ event }) => {
      // Any update at all is the provider still talking, thinking included: a
      // long think is not a stall (watchdog.ts holds the same line).
      watch?.beat();
      if (!heard) {
        heard = true;
        note({ event: "first-byte", round, ms: Date.now() - requestAt });
      }
      if (event.type === "text_delta") onDelta(event.delta);
      else if (event.type === "thinking_delta") onThinking?.(event.delta);
    });
    // The round is recorded either way: an abort and a provider failure both
    // leave the tokens the request already cost, and pi fills the usage it had
    // at message_start. A recovery message is the harness's own stand-in for
    // a request that never went out, and is not a round.
    //
    // A message_end is not a request either. The harness emits one for every
    // message it appends to the session, and the prompt this turn accepts is
    // the whole conversation — every assistant turn replayed into it included,
    // each of them announced here before the first request goes out. What
    // tells a round from a replay is the run: a message the harness streamed
    // carries the id of the operation that asked for it, and a message merely
    // written down carries none.
    listen("message_end", ({ message, recovery, runId }) => {
      if (recovery || message.role !== "assistant") return;
      if (runId === undefined || runId !== operationId) return;
      recordRound(message, message.stopReason !== "error" && message.stopReason !== "aborted");
      note({ event: "round", round, stop: message.stopReason, ms: Date.now() - requestAt });
    });
    listen("tool_start", ({ toolName, args }) => {
      // Nothing is waiting on the provider while a tool runs, and a sub-agent
      // or a page fetch can take minutes without a word.
      watch?.hold();
      const tool = byName.get(toolName);
      const a = args as Record<string, any>;
      onToolStart({
        name: toolName,
        args: a,
        label: tool ? toolLabel(tool, a) : toolName,
        ...(tool?.quiet ? { quiet: true as const } : {}),
      });
    });
    listen("tool_end", ({ toolCallId, toolName, result, isError }) => {
      watch?.unhold();
      // Let go of because the reader stopped the turn: as silent as the rest
      // of a Stop. Let go of for a stall or the time limit, the line says so.
      if (letGo.has(toolCallId) && signal?.aborted) return;
      // A failure's text is the message the tool threw, which is what the reader
      // is shown in place of the line that was running; a success carries the
      // receipt the adapter parked in `details` and no text (the text is the
      // model's to read).
      const receipt = result.details as Receipt | undefined;
      onToolEnd({
        name: toolName,
        isError,
        ...(isError ? { error: preview(contentText(result.content)) } : {}),
        ...(!isError && receipt ? { receipt } : {}),
      });
    });
    listen("handler_error", ({ error }) => {
      handlerError ??= new Error(error);
    });
    // A queued steer that reached the transcript. The harness writes the
    // pending entry under the id it was queued with (planBoundaryInbox), so
    // matching the ids this turn holds is exact — no other lane's traffic and
    // no replayed history can be mistaken for one.
    listen("entry_added", ({ entry }) => {
      if (!queuedSteer.delete(entry.id)) return;
      if (internalSteer.delete(entry.id)) onDelivered?.([entry.id]);
      else onSteered?.([entry.id]);
    });

    signal?.addEventListener("abort", onAbort, { once: true });

    let record: OperationResultRecord;
    if (params.resume !== undefined) {
      // The run is already on the lane: it was admitted by the process that
      // died, its prompt is in the session, and its id is known before a line
      // of it is driven — so the listeners above can tell its messages from the
      // replayed history from the first one.
      operationId = params.resume;
      if (params.limitMs !== undefined) watch?.limit(params.limitMs);
      if (signal?.aborted) await abortRun();
      onSteerable?.(steer);
      const resumed = await lane.resume(ctx);
      ended = true;
      if (!resumed.ok) {
        ending("error", resumed.error.message);
        onError(resumed.error.message);
        return;
      }
      if (resumed.value.status === "suspended") {
        ending("error", "suspended");
        onError("the model turn stopped to wait on deferred");
        return;
      }
      if (handlerError) throw handlerError;
      record = resumed.value;
    } else {
      // The stamp goes on before the prompt, so a run found open later is never
      // without one. Only on a borrowed lane: a turn with a session of its own
      // has nobody coming back for it.
      if (borrowed && params.deliverTo !== undefined) {
        await lane.appendCustomEntry(DELIVERY_ENTRY, params.deliverTo as JsonValue, ctx);
      }
      const admitted = await lane.accept({ kind: "prompt", prompt: params.messages as AgentMessage[] }, ctx);
      if (!admitted.ok) {
        ended = true;
        ending("error", admitted.error.message);
        onError(admitted.error.message);
        return;
      }
      operationId = admitted.value.operationId;
      // Armed once there is a run to abort, so running out can always stop it.
      if (params.limitMs !== undefined) watch?.limit(params.limitMs);
      // The signal may have fired between the check above and the run existing.
      if (signal?.aborted) await abortRun();
      // There is a run to queue into from here until it settles below.
      onSteerable?.(steer);

      const driven = await lane.drive({ operationId, waitForRetry: true }, ctx);
      ended = true;
      if (!driven.ok) {
        ending("error", driven.error.message);
        onError(driven.error.message);
        return;
      }
      if (driven.value.kind !== "settled") {
        ending("error", driven.value.reason);
        onError(`the model turn stopped to wait on ${driven.value.reason}`);
        return;
      }
      if (handlerError) throw handlerError;
      record = driven.value.outcome;
    }
    if (record.status === "aborted") {
      if (refusal) {
        ending("refused", refusal.message);
        refuse(refusal.message);
      }
      // Nobody asked for this one. The caller is told, and told what kind of
      // failure it was, so a surface that can ask again knows it is worth it.
      else if (stalled) {
        ending("stalled");
        onError(STALL_MESSAGE, undefined, new StallError());
      } else if (timedOut) {
        ending("timed-out");
        onError(TURN_LIMIT_MESSAGE, undefined, new TurnLimitError());
      } else ending("aborted");
      return;
    }
    if (signal?.aborted) {
      ending("aborted");
      return;
    }
    if (record.status === "failed") {
      if (thrown !== undefined) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        ending("error", message);
        onError(message, undefined, thrown);
      } else {
        const message = last?.errorMessage || record.error?.message || "stream error";
        ending("error", message);
        onError(message, last);
      }
      return;
    }
    if (!last) {
      ending("error", "no final message");
      onError("model stream ended without a final message");
      return;
    }
    const text = assistantText(last);
    ending("done");
    onDone(text, last, joinRoundTexts([...written, text]));
  } catch (e) {
    ended = true;
    if (signal?.aborted) {
      ending("aborted");
      return;
    }
    ending("error", errMsg(e));
    onError(errMsg(e), undefined, e);
  } finally {
    ended = true;
    note({
      event: "end",
      reason: endReason ?? "aborted",
      ms: Date.now() - begunAt,
      ...(endError !== undefined ? { error: endError } : {}),
    });
    // What the stall window has to clear, measured on a real turn. Development
    // only: nothing in a release build reads it, and the point of it is to be
    // read back off a device that has just been made to think for a while.
    if (watch && import.meta.env?.DEV) {
      const ms = watch.longestSilence();
      recordLongestSilence({ surface: telemetry?.surface ?? "turn", ms, at: Date.now() });
      console.log(`[stall] ${telemetry?.surface ?? "turn"} longest silence ${ms}ms`);
    }
    watch?.stop();
    signal?.removeEventListener("abort", onAbort);
    for (const off of subscriptions) off();
    borrowed?.release();
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
    harness,
    deliverTo,
    resume,
    stallMs,
    onDelta,
    onWait,
    onThinking,
    onResponse,
    onRound,
    onToolStart,
    onToolEnd,
    onSteerable,
    onSteered,
    onDelivered,
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
      // A held lane is shared by the conversation's turns, so one that never
      // ends would hold up every turn after it: there it gets an allowance. The
      // conversation is the thread, the same id the cache accounting and the
      // provider's session already go by.
      ...(harness
        ? { held: harness, conversation: telemetry.thread, limitMs: turnLimitFor(telemetry.surface) }
        : {}),
      ...(deliverTo ? { deliverTo } : {}),
      ...(stallMs === undefined ? {} : { stallMs }),
      ...(resume === undefined ? {} : { resume }),
      log: appTurnLog,
      onDelta,
      onWait,
      onThinking,
      onResponse,
      onRound,
      onToolStart,
      onToolEnd,
      onSteerable,
      onSteered,
      onDelivered,
      onDone,
      onError,
      onRefusal,
    });
  } catch (e) {
    onError(errMsg(e), undefined, e);
  }
}
