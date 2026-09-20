// The tool-calling turn as its callers see it: the tool shape they mount, the
// callbacks they are answered through, and the two sentences the turn says when
// it gives up. turn.ts runs it on the durable harness; nothing here knows how.
//
// Kept apart from turn.ts so a module that only mounts a tool (a domain's tool
// file, the soul's catalogue) imports a file with no runtime in it.

import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
  TSchema,
} from "@earendil-works/pi-ai";
import type { BudgetPurpose } from "../../budget";
import type { AiSurface, TurnTelemetry } from "../../platform/app/cache-telemetry";
import type { ModelCallAbout } from "../../ai/model-usage";
import type { ChatMessage, ProviderId, ResponseHead, StreamOutcome } from "../../ai/providers";
import type { Receipt } from "../../ai/tool-status";
import type { HeldHarness } from "./held";

// An image block a tool can return alongside its text (e.g. view_figure hands
// the model a cropped figure). `data` is bare base64, `mimeType` the MIME type;
// pi-ai carries these to the provider as tool-result image content (verified for
// the Anthropic path — see docs/12 landing note).
export interface ToolResultImage {
  data: string;
  mimeType: string;
}

// A write's receipt lives with the chat row that shows it (ai/tool-status.ts),
// so it is declared there and named here.
export type { Receipt, ReceiptLink } from "../../ai/tool-status";

// A richer tool result: text (also used as the UI trace preview) plus optional
// images and, for a write, its receipt. A tool may still return a plain string,
// which becomes { text }.
export interface ToolResult {
  text: string;
  images?: ToolResultImage[];
  // A write says what it did, or says null when this call wrote nothing (the id
  // named nothing, a run was already going). Leaving it out is the one thing a
  // write may not do: turn.ts turns that into an error, so a write can never be
  // added without the reader being told about it.
  receipt?: Receipt | null;
}

// What a tool does to the world. A read leaves a trace line and nothing else; a
// write must come back with a receipt (turn.ts throws when it does not).
export type ToolEffect = "read" | "write";

// The gate a write goes through before it lands (docs/21, soul/roles.ts):
// "card" — the tool pushes a card the reader confirms; "trial" — it runs a trial
// the reader looks at first; "instruction" — it only runs on an explicit
// instruction. Absent means the tool lands the write itself and the receipt is
// the whole of its visibility.
export type ToolGate = "card" | "trial" | "instruction";

// A tool the model can call. `parameters` is a TypeBox schema (e.g.
// Type.Object({...}) / StringEnum(...)) — the same shape pi's Tool expects.
// `execute` receives arguments already validated/coerced against that schema and
// returns the tool result: a string, or { text, images } to attach pictures.
export interface AgentTool {
  name: string;
  // For the model.
  description: string;
  parameters: TSchema;
  // For the reader, while the call runs: "Reading pages 41–44". Called with the
  // validated arguments — and with {} by the completeness test and by the SDK
  // fallback, so it must not depend on any argument being there. One short
  // clause, no trailing period.
  label(args: Record<string, any>): string;
  // A read leaves a trace line; a write must come back with a receipt.
  effect: ToolEffect;
  // The gate a write goes through. Reads leave it unset.
  gate?: ToolGate;
  // Safe to run a second time when a process died with this call in flight. A
  // turn finished by a later process (src/soul/recover.ts) runs such a call
  // again; every other tool is handed pi's synthetic "execution was
  // interrupted" result instead, whatever it had already done. Only for tools
  // that read: running one twice must cost nothing but the read.
  replay?: "safe";
  // The reader is not shown this call: no phase, no trace line, no receipt; it
  // stays in the stored trace. For bookkeeping the app does on its own behalf —
  // the memory writes — which is a record of the turn and not something the
  // reader came here to read. A quiet tool is still a write with a receipt: the
  // record is complete, it is only unshown, and a quiet call that fails keeps
  // its red line like any other.
  quiet?: true;
  execute(args: Record<string, any>): Promise<string | ToolResult>;
}

export interface AgentToolStart {
  name: string;
  args: Record<string, any>;
  // `tool.label(args)`, computed once here so no surface has to keep its own
  // table of tool names to say what is running.
  label: string;
  // `tool.quiet`, carried the same way, so a surface decides what to draw from
  // the call in front of it and never from a list of tool names.
  quiet?: true;
}

export interface AgentToolEnd {
  name: string;
  isError: boolean;
  // What the write did, when the tool reported one.
  receipt?: Receipt;
  // The sentence the tool threw, when it failed: what the reader is shown in
  // place of the line that was running.
  error?: string;
}

// Something said into a turn that is already streaming (docs/72). The reader
// talking mid-answer is not an interruption: the message joins the queue and
// the model is handed it at the end of the round in flight.
export interface SteerMessage {
  text: string;
  // Not the reader's words but the app's — a delegated run coming back while
  // the turn that asked for it is still running (soul/bell.ts). It goes into
  // the model's context and nowhere else: no row on screen, no line in the
  // thread file. Which is why its landing is reported through `onDelivered`
  // and never `onSteered`: a caller that draws the reader's rows off the
  // steered ids would otherwise draw a row for a message the reader never said.
  internal?: boolean;
}

// What became of one steer. A turn that has ended says so rather than dropping
// the message: the caller still holds the reader's sentence and has to decide
// what to do with it (reading/session: it opens the next turn).
export type SteerOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "ended" | "rejected"; message: string };

// Queue one message into the turn in flight. The id it returns is the id
// `onSteered` reports back when the model is actually handed it.
export type SteerPort = (message: string | SteerMessage) => Promise<SteerOutcome>;

// A turn that has already settled, or had not started when the port was used.
export const STEER_ENDED = "the turn had already ended";

export interface AgentCallbacks {
  onDelta(text: string): void;
  // The turn can be steered from here on: it has a run of its own to queue
  // into. Fires at most once, before any round's output. A caller with no use
  // for steering leaves it out and nothing is queued.
  onSteerable?(steer: SteerPort): void;
  // The queue was drained: these steered messages are in the model's context
  // as of now, and the reply that follows is an answer to them. Ids are the
  // ones `steer` handed back. Fires once per drained message. Internal
  // messages are not among them — see `onDelivered`.
  onSteered?(ids: string[]): void;
  // The same moment for an internal steer (`SteerMessage.internal`): the model
  // has been handed something the app put there, not something the reader said.
  onDelivered?(ids: string[]): void;
  // Reasoning/thinking deltas, kept separate from onDelta so thinking is never
  // rendered as the reply; the unattended digest wires it as watchdog liveness.
  onThinking?(delta: string): void;
  onToolStart(info: AgentToolStart): void;
  onToolEnd(info: AgentToolEnd): void;
  // A model turn is about to be streamed: `round` is 1-based, `rounds` the cap.
  // Fires after the round has passed its budget check, so it counts turns that
  // were really sent — which is what a caller reporting "3 of 6 turns used" has
  // to mean. Optional; the conversational paths have no use for it, the
  // sub-agent runner (legion/subagent) reports its turn count from it.
  onRound?(info: { round: number; rounds: number }): void;
  // The HTTP response head of each round, before its body is read: request id
  // and rate-limit headers. Fires once per streamed model turn.
  onResponse?: ResponseHead;
  // The answering round's text, plus pi's AssistantMessage for that round —
  // usage, responseId, stopReason. A caller that only wants the text ignores it.
  //
  // `turnText` is every round's text joined with a blank line (ai/turn-rows.ts):
  // a round that calls a tool may write a sentence before it, and the chat
  // surfaces keep that sentence on screen, so it is part of the reply they
  // persist. A caller whose turn produces an artifact — a note, a sub-agent's
  // result — wants the answer alone and reads `finalText`. Tool results are in
  // neither: they never go in the reply.
  onDone(finalText: string, assistant?: StreamOutcome, turnText?: string): void;
  // `thrown` is what was actually caught, when a throw is what ended the turn.
  // The message alone loses the error's own type, and a caller that records the
  // failure (the sub-agent runner, memory/live) can then only say "unknown"
  // about every one of them. Optional: nothing has to look at it.
  onError(message: string, assistant?: StreamOutcome, thrown?: unknown): void;
  // The turn gave up for a reason it can state, with nothing having failed: the
  // call outgrew the model's window mid-turn, or the round cap ran out. Every
  // request that went out was answered, so presenting this as a failed call
  // tells the user to check a connection that is fine. Separate from onError
  // because the two ask for different things — an error is worth another press,
  // a refusal gives the same answer every time. Unset falls back to onError, for
  // callers with no use for the distinction (the unattended pipelines turn
  // either one into a rejected promise).
  onRefusal?(message: string): void;
}

// Which lane of which session group a turn runs on.
//
// Unset is the reader's turn: lane "turn" in the "turn" group, one fresh
// session per turn. A sub-agent names both (legion/subagent), because a worker
// is not a turn of the conversation: its lane says which worker it is, and its
// session belongs beside the other workers' rather than among the reader's.
export interface TurnLane {
  // The lane inside the session. Non-empty; anything but a NUL is allowed.
  name: string;
  // The session group the session file is filed under (the repo's `cwd`).
  sessions: string;
}

export interface RunAgentTurnOptions extends AgentCallbacks {
  providerId: ProviderId;
  modelId: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  // Extended-thinking effort. undefined = off. Omitted silently on models whose
  // metadata says reasoning:false.
  reasoning?: ThinkingLevel;
  // Max streamed model turns that request tools before the turn gives up.
  // Default 8. Exceeding it is a refusal, not an error.
  maxRounds?: number;
  // What the answer is for, which sets how much output room each round must
  // leave (src/budget). "chat" when unset.
  purpose?: BudgetPurpose;
  // What the turn is about, for the model-call log (src/memory/usage): the book
  // being read, the topic being discussed. Absent on a turn that is about
  // neither; the surface below says who spent it either way.
  about?: ModelCallAbout;
  // Which face of the app this turn is, and the conversation it continues, so
  // each round's cache accounting can be attributed and dated
  // (platform/app/cache-telemetry.ts). Required: an unlabelled turn is missing
  // from the measurement without saying so. `thread` may be left out by a run
  // that has no conversation of its own — a fresh id stands in, which is what a
  // one-off run is.
  telemetry: { surface: AiSurface; thread?: string; inline?: TurnTelemetry["inline"] };
  // The lane and session group this turn runs on; the reader's turn when unset.
  lane?: TurnLane;
  // A harness that outlives the turn, whose lane the turn runs on instead of a
  // session of its own (legion/execute/held.ts). The soul's turns all name the
  // soul's (src/soul/harness.ts); a worker or a background pass leaves it
  // unset and gets a harness to itself. `lane` is ignored when this is set.
  harness?: HeldHarness;
  // Where this turn's reply goes, written to the session beside the run it
  // belongs to. Opaque to legion: it is stored and handed back, never read.
  // What it is for is a process that finds this run still open after this one
  // died — it can rebuild the receiver and finish the turn (src/soul/recover.ts).
  deliverTo?: Record<string, unknown>;
  // Finish this operation instead of starting one: the harness above is the
  // dead process's, standing where its run stopped, and `messages` is not sent
  // because the prompt is already in that session (src/soul/recover.ts).
  resume?: string;
}

// The two things the turn says when it gives up. Both are refusals rather than
// errors, and both are written for someone who does not know what a token is:
// they say what happened to the reading, not what happened to the arithmetic.
//
// Kept here rather than beside the ladder's refusals (src/budget) because only
// a turn in flight can reach either state — the planner sizes a turn before it
// is sent and never sees one in flight.

// A turn that started with room and ran out of it partway through, after the one
// reduction available mid-flight (stubbing the tool results it already
// collected). Worded to hold whether or not anything was actually stubbed.
export const REFUSE_MIDTURN =
  "I've taken in more of this material than I can hold at once, and setting aside what I can spare still doesn't leave room to answer. Ask about a narrower part of it and I can.";

// The model spent the whole round cap calling tools and never wrote an answer.
export const REFUSE_ROUNDS =
  "I kept looking things up without getting to an answer, so I've stopped rather than go around again. Ask something more specific and I can.";

// The provider-agnostic stream contract, matched by Provider.streamSimple and by
// a scripted fake in tests. The harness is handed one of these, so a turn can be
// driven without any real provider, auth, or network.
//
// `options` is optional because pi-agent-core declares its own StreamFn that
// way, and under strictFunctionTypes a required parameter is not assignable to
// an optional one. The harness always passes an object.
export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;
