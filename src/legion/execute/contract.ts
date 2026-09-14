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

// An image block a tool can return alongside its text (e.g. view_figure hands
// the model a cropped figure). `data` is bare base64, `mimeType` the MIME type;
// pi-ai carries these to the provider as tool-result image content (verified for
// the Anthropic path — see docs/12 landing note).
export interface ToolResultImage {
  data: string;
  mimeType: string;
}

// A richer tool result: text (also used as the UI trace preview) plus optional
// images. A tool may still return a plain string, which becomes { text }.
export interface ToolResult {
  text: string;
  images?: ToolResultImage[];
}

// A tool the model can call. `parameters` is a TypeBox schema (e.g.
// Type.Object({...}) / StringEnum(...)) — the same shape pi's Tool expects.
// `execute` receives arguments already validated/coerced against that schema and
// returns the tool result: a string, or { text, images } to attach pictures.
export interface AgentTool {
  name: string;
  description: string;
  parameters: TSchema;
  execute(args: Record<string, any>): Promise<string | ToolResult>;
}

export interface AgentToolStart {
  name: string;
  args: Record<string, any>;
}

export interface AgentToolEnd {
  name: string;
  // The tool's returned/errored text, truncated for a compact UI trace.
  resultPreview: string;
  isError: boolean;
}

export interface AgentCallbacks {
  onDelta(text: string): void;
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
