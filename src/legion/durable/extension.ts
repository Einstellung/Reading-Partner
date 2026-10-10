// Our pi-durable extension (docs/soul/87): the documents a reading turn keeps
// in the database, the system prompt sections that read `rp.desk`, the
// generation hooks that assemble every request's context and record usage, and
// the `rp.turn` task that submits the reader's input, waits for it and lands it.
//
// Nothing here knows a place: the history reader, the usage recorder, the
// landing step and the refusal path are handed in when the Harness opens.

import type { Context } from "@earendil-works/chord";
import { awaitWithContext } from "@earendil-works/chord/context";
import type { AssistantMessage, ImageContent, Message, TextContent, Tool } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  defineDoc,
  defineExtension,
  defineTask,
  GenerationTask,
  hook,
  section,
  type ConversationId,
  type Extension,
  type HookApi,
  type JsonObject,
  type SubmissionRecord,
  type Task,
  type TaskRuntime,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { fitRoundToBudget, type BudgetPurpose } from "../../budget";
import { REFUSE_MIDTURN, REFUSE_ROUNDS } from "../execute/contract";

/** Where a conversation's turns land: today's BoxOrigin, opaque here except for `place`. */
export type ThreadOrigin = { place: string } & JsonObject;

/** `rp.thread`: written once, by `init`, when the conversation is created. */
export type ThreadState = { origin: ThreadOrigin | null };
export const ThreadDoc = defineDoc<ThreadState>({
  kind: "rp.thread",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ origin: null }),
});

/**
 * `rp.desk`: what the current turn was assembled with. `sections` by section
 * key; `excludeTs` is the reader's line of this turn in the conversation file,
 * which the history reader leaves out because the run already holds it.
 */
export type DeskState = {
  sections: Record<string, string>;
  purpose: BudgetPurpose;
  maxRounds: number;
  excludeTs: number | null;
};
export const DeskDoc = defineDoc<DeskState>({
  kind: "rp.desk",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ sections: {}, purpose: "chat", maxRounds: 8, excludeTs: null }),
});

/** `rp.partial`: the half sentence `pi.live` held when the process died, saved before the abort. */
export type PartialState = { submission: number | null; text: string };
export const PartialDoc = defineDoc<PartialState>({
  kind: "rp.partial",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ submission: null, text: "" }),
});

/** `rp.recovery`: per submission, how many processes started with it unsettled, and whether it was superseded. */
export type RecoveryState = { submissions: Record<string, { attempts: number; superseded: boolean }> };
export const RecoveryDoc = defineDoc<RecoveryState>({
  kind: "rp.recovery",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ submissions: {} }),
});

/** `rp.conversations`: thread key to conversation id. Empty after a generation swap. */
export type ConversationsState = { threads: Record<string, number> };
export const ConversationsDoc = defineDoc<ConversationsState>({
  kind: "rp.conversations",
  version: 1,
  scope: "session",
  initial: () => ({ threads: {} }),
});

/** The conversation file's history before this turn, as model messages (HISTORY_KEEP applied by the reader). */
export type HistoryReader = (
  origin: ThreadOrigin,
  options: { excludeTs?: number },
  context: Context,
) => Promise<Message[]>;

/** One provider message that came back, for `recordModelCall`. */
export type ResponseRecorder = (
  message: AssistantMessage,
  about: { conversationId: ConversationId; origin: ThreadOrigin; round: number },
) => void;

/** The reader's line as the model gets it: text, or text and the page window's images. */
export type TurnContent = string | (TextContent | ImageContent)[];
/** The bell a turn answers (soul/bell.ts): found again after a restart so it is not answered twice. */
export type TurnBell = { id: string; runId?: string };
export type TurnInput = { content: TurnContent; startedAt: number; bell?: TurnBell };
export type TurnCheckpoint = { phase: "submit" } | { phase: "wait" } | { phase: "land" };
/**
 * How the turn's last run settled. `reason` and `detail` are the submission's
 * when it went unanswered (`aborted`, `model_error`, ...); `refusal` is the
 * request the turn declined to send (docs/pitfall/516).
 */
export type TurnResult = {
  status: SubmissionRecord["status"];
  landed: boolean;
  reason?: string;
  detail?: string;
  refusal?: string;
};

/**
 * The landing step of `rp.turn`, implemented in turn.ts. `record` is the
 * turn's own submission; the result's `status` is how the turn's last run
 * ended, `landed` whether something was written.
 */
export type LandStep = (
  task: { id: number; conversationId: ConversationId; input: TurnInput },
  runtime: TaskRuntime<TurnInput, TurnCheckpoint, TurnResult, object>,
  record: SubmissionRecord,
  context: Context,
) => Promise<TurnResult>;

export interface ExtensionDeps {
  sectionKeys: readonly string[];
  readHistory: HistoryReader;
  recordResponse?: ResponseRecorder;
  land: LandStep;
  /** Tool registrations by name, for sizing a request's tool schemas. */
  registrations: ReadonlyMap<string, ToolRegistration>;
  /**
   * A request that must not be sent: remember `message` for the landing step
   * and abort the conversation. The hook then waits for the abort.
   */
  refuse(conversationId: ConversationId, message: string): void;
  /** After `rp.turn` landed: the conversation is free for the next turn. */
  settled?(conversationId: ConversationId, result: TurnResult): void;
}

export const TURN_REQUEST_PREFIX = "turn:";

export function turnRequestId(taskId: number): string {
  return `${TURN_REQUEST_PREFIX}${taskId}`;
}

function textOf(message: Message): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}


/** Hold the request until the abort `refuse` asked for cancels this context. */
function refused(deps: ExtensionDeps, api: HookApi, message: string, context: Context): Promise<never> {
  deps.refuse(api.conversationId, message);
  return awaitWithContext(new Promise<never>(() => {}), context);
}

export interface DurableExtension {
  extension: Extension;
  turnTask: Task<TurnInput, TurnCheckpoint, TurnResult, object>;
  /** Forget the stubs of a conversation's turn; called when it settles. */
  forgetStubs(conversationId: ConversationId): void;
}

export function durableExtension(deps: ExtensionDeps): DurableExtension {
  // Stubbed tool results of the conversation's turn, so a result stubbed in
  // one round stays a stub in the next, including the runs a steer started
  // (docs/pitfall/519). Forgotten when the turn settles. In memory only: a
  // restarted process measures again from the start.
  const stubsByTurn = new Map<ConversationId, Map<string, Message>>();
  // The round of the request each conversation sent last, for its response's usage line.
  const rounds = new Map<ConversationId, number>();

  const turn = defineTask<TurnInput, TurnCheckpoint, TurnResult>({
    name: "rp.turn",
    version: 1,
    initial: () => ({ phase: "submit" }),
    phases: {
      submit: async (task, runtime, context) => {
        const handle = (await runtime.conversation(task.conversationId, context))!;
        const request = { type: "input", content: task.input.content, requestId: turnRequestId(task.id) } as const;
        await handle.submit(request, context);
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "wait" } }), context);
      },
      wait: async (task, runtime, context) => {
        const handle = (await runtime.conversation(task.conversationId, context))!;
        const request = { type: "input", content: task.input.content, requestId: turnRequestId(task.id) } as const;
        await (await handle.submit(request, context)).wait(context);
        // A steer taken at the final boundary starts the next run, and the
        // submission above settles with the run before it (docs/pitfall/519).
        // That run answers the steer within this turn; wait for every such run
        // (`waitForIdle` leaves out background tasks, so not this one).
        await handle.waitForIdle(context);
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "land" } }), context);
      },
      land: async (task, runtime, context) => {
        const handle = (await runtime.conversation(task.conversationId, context))!;
        const request = { type: "input", content: task.input.content, requestId: turnRequestId(task.id) } as const;
        const record = await (await handle.submit(request, context)).status(context);
        let result = await runtime.memo<TurnResult>("landing", context);
        if (!result) {
          // The file first, then the memo: killed in between, the rerun's
          // writes are skipped by timestamp.
          result = await runtime.memo("landing", await deps.land(task, runtime, record, context), context);
        }
        const settled = result;
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: settled } }), context);
        deps.settled?.(task.conversationId, settled);
      },
    },
    abort: async (_task, runtime, context) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });

  const sections = deps.sectionKeys.map((key) =>
    section(
      key,
      async (input, context) => {
        const desk = await input.read.snapshot(DeskDoc, input.conversationId, context);
        return desk?.sections[key] || undefined;
      },
      { tag: false },
    ),
  );

  const beforeRequest = async (request: { readonly messages: readonly Message[] }, api: HookApi, context: Context) => {
    const desk = await api.snapshot(DeskDoc, api.conversationId, context);
    const origin = (await api.snapshot(ThreadDoc, api.conversationId, context))?.origin;
    if (!desk || !origin) return undefined;
    const system = request.messages.filter((m) => m.role === "system");
    const stubs = stubsByTurn.get(api.conversationId) ?? new Map<string, Message>();
    stubsByTurn.set(api.conversationId, stubs);
    // Every turn starts from a reset, so what the request holds besides the
    // system entries is this turn: the reader's line, the rounds, the steers.
    const run = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => (m.role === "toolResult" ? (stubs.get(m.toolCallId) ?? m) : m));
    const round = run.filter((m) => m.role === "assistant").length + 1;
    rounds.set(api.conversationId, round);
    if (round > desk.maxRounds) return refused(deps, api, REFUSE_ROUNDS, context);
    const history = await deps.readHistory(origin, desk.excludeTs === null ? {} : { excludeTs: desk.excludeTs }, context);
    const messages = [...history, ...run];
    const agent = await api.snapshot(AgentDoc, api.conversationId, context);
    const model = agent?.model ? api.models.getModel(agent.model.provider, agent.model.modelId) : undefined;
    if (!model) return { messages: [...system, ...messages] };
    const names = Array.isArray(agent?.tools) ? agent.tools : [];
    const tools: Tool[] = names.flatMap((name) => {
      const tool = deps.registrations.get(name);
      return tool ? [{ name: tool.name, description: tool.description, parameters: tool.parameters }] : [];
    });
    const systemPrompt = system.map(textOf).join("\n\n");
    const fit = fitRoundToBudget({ model, systemPrompt, messages, tools, purpose: desk.purpose });
    fit.messages.forEach((m, i) => {
      if (m !== messages[i] && m.role === "toolResult") stubs.set(m.toolCallId, m);
    });
    if (!fit.fits) return refused(deps, api, REFUSE_MIDTURN, context);
    return { messages: [...system, ...fit.messages] };
  };

  const afterResponse = async (message: AssistantMessage, api: HookApi, context: Context) => {
    if (!deps.recordResponse) return;
    const origin = (await api.snapshot(ThreadDoc, api.conversationId, context))?.origin;
    if (!origin) return;
    // A hook rerun after a crash sees the same message again; a re-ask is a
    // new message with its own timestamp, and is recorded (it was paid for).
    const name = `usage:${message.timestamp}:${message.responseId ?? ""}`;
    if ((await api.memo<boolean>(name, context)) !== undefined) return;
    deps.recordResponse(message, { conversationId: api.conversationId, origin, round: rounds.get(api.conversationId) ?? 1 });
    await api.memo(name, true, context);
  };

  const extension = defineExtension({
    name: "rp",
    tools: [...deps.registrations.values()],
    sections,
    hooks: [hook(GenerationTask, { beforeRequest, afterResponse })],
    tasks: [turn],
  });
  const forgetStubs = (conversationId: ConversationId) => {
    stubsByTurn.delete(conversationId);
    rounds.delete(conversationId);
  };
  return { extension, turnTask: turn, forgetStubs };
}
