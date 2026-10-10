// One reading turn on the durable runtime (docs/soul/87, "一个回合", "落盘"):
// starting it, the landing step of `rp.turn`, steering, stopping, and marking a
// submission superseded for the stall watchdog.
//
// Landing is the only place a run becomes conversation-file messages. It reads
// the run's entries from the submission's `pi.user` on, splits them at the
// steers, and hands the rows to the lander registered for the thread's place,
// which writes the file and skips a message whose timestamp is already there.

import type { Context } from "@earendil-works/chord";
import type { AssistantMessage, ModelThinkingLevel, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  configure,
  InboxDoc,
  LiveDoc,
  type Conversation,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type ModelRef,
  type Storage,
  type SubmissionId,
  type TaskId,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { BudgetPurpose } from "../../budget";
import {
  DeskDoc,
  PartialDoc,
  RecoveryDoc,
  ThreadDoc,
  type LandStep,
  type ThreadOrigin,
  type TurnResult,
} from "./extension";
import type { DurableRuntime } from "./harness";

export const DEFAULT_MAX_ROUNDS = 8;
export const STEER_REQUEST_PREFIX = "steer:";

export type LandedTool = { callId: string; name: string; args: unknown; isError: boolean; details?: unknown };
export type LandedRow =
  | { role: "assistant"; ts: number; text: string; tools: LandedTool[] }
  | { role: "user"; ts: number; text: string };

/**
 * One settled turn for the conversation file. `done` answered; `unanswered`
 * stopped, refused or given up, and what was said before that is in `rows`.
 */
export type LandedTurn = {
  conversationId: ConversationId;
  status: "done" | "unanswered";
  rows: LandedRow[];
  refusal?: string;
};

/** Writes a turn into the place's conversation file; a message whose `ts` is already there is skipped. */
export type Lander = (origin: ThreadOrigin, turn: LandedTurn, context: Context) => Promise<void>;

type Part = { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };

function parts(message: unknown): Part[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Part[]) : [];
}

export function textOf(message: unknown): string {
  return parts(message)
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("");
}

export interface ProjectOptions {
  /** `rp.turn`'s start time: the first row's timestamp is after it. */
  startedAt: number;
  /** Timestamps of the reader's rows for steers, by the steer's `pi.user` entry. */
  steerTs: ReadonlyMap<EntryId, number>;
  /** `rp.partial`'s half sentence, used when the run did not end in an aborted entry of its own. */
  partial?: string;
}

/**
 * The run's entries after its `pi.user` as rows. An aborted `pi.assistant`
 * followed by another answer is a killed half sentence that was asked again
 * (docs/pitfall/511) and is left out; the run's last one is what was said.
 * Timestamps are fixed by the order and the steers, so a rerun lands the same.
 */
export function projectRun(entries: readonly EntryRecord[], from: EntryId, options: ProjectOptions): LandedRow[] {
  const start = entries.findIndex((e) => e.id === from);
  const run = start < 0 ? [] : entries.slice(start + 1);
  let lastAssistant = -1;
  run.forEach((e, i) => {
    if (e.kind === "pi.assistant") lastAssistant = i;
  });
  const rows: LandedRow[] = [];
  let ts = options.startedAt;
  let current: Extract<LandedRow, { role: "assistant" }> | undefined;
  const open = () => {
    if (!current) {
      ts += 1;
      current = { role: "assistant", ts, text: "", tools: [] };
      rows.push(current);
    }
    return current;
  };
  const say = (text: string) => {
    if (!text) return;
    const row = open();
    row.text = row.text ? `${row.text}\n\n${text}` : text;
  };
  let endedAborted = false;
  run.forEach((entry, i) => {
    const message = entry.model?.[0];
    if (entry.kind === "pi.assistant") {
      const assistant = message as AssistantMessage | undefined;
      if (assistant?.stopReason === "aborted" && i !== lastAssistant) return;
      if (assistant?.stopReason === "aborted") endedAborted = true;
      say(textOf(assistant));
      for (const part of parts(assistant)) {
        if (part.type === "toolCall") {
          open().tools.push({ callId: part.id ?? "", name: part.name ?? "", args: part.arguments, isError: false });
        }
      }
    } else if (entry.kind === "pi.tool-result") {
      const result = message as ToolResultMessage | undefined;
      const call = current?.tools.find((t) => t.callId === result?.toolCallId);
      if (call && result) {
        call.isError = result.isError === true;
        if (result.details !== undefined) call.details = result.details;
      }
    } else if (entry.kind === "pi.user") {
      current = undefined;
      ts = Math.max(options.steerTs.get(entry.id) ?? ts + 1, ts + 1);
      rows.push({ role: "user", ts, text: textOf(message) });
    }
  });
  if (!endedAborted && options.partial) say(options.partial);
  return rows.filter((row) => row.role === "user" || row.text !== "" || row.tools.length > 0);
}

/** Entry id to the reader's row timestamp, from the steer submissions' request ids. */
export async function steerTimestamps(
  storage: Storage,
  conversationId: ConversationId,
  context: Context,
): Promise<Map<EntryId, number>> {
  const page = await storage.scanSubmissions({ conversationId, order: "descending" }, 200, undefined, context);
  const out = new Map<EntryId, number>();
  for (const record of page.items) {
    if (record.entry === undefined || !record.requestId?.startsWith(STEER_REQUEST_PREFIX)) continue;
    const ts = Number(record.requestId.slice(STEER_REQUEST_PREFIX.length));
    if (Number.isFinite(ts)) out.set(record.entry, ts);
  }
  return out;
}

export interface LandDeps {
  landers: Readonly<Record<string, Lander>>;
  storage(): Storage;
  takeRefusal(conversationId: ConversationId): string | undefined;
}

export function createLandStep(deps: LandDeps): LandStep {
  return async (task, runtime, record, context) => {
    if (record.type !== "input" || (record.status !== "done" && record.status !== "unanswered")) return false;
    const recovery = await runtime.snapshot(RecoveryDoc, task.conversationId, context);
    if (recovery?.submissions[String(record.id)]?.superseded) return false;
    const refusal = deps.takeRefusal(task.conversationId);
    let rows: LandedRow[] = [];
    if (record.entry !== undefined) {
      const view = await runtime.context(task.conversationId, context);
      const partial = await runtime.snapshot(PartialDoc, task.conversationId, context);
      const steerTs = await steerTimestamps(deps.storage(), task.conversationId, context);
      rows = projectRun(view.entries, record.entry, {
        startedAt: task.input.startedAt,
        steerTs,
        ...(record.status === "unanswered" && partial?.submission === record.id ? { partial: partial.text } : {}),
      });
    }
    if (rows.length === 0 && refusal === undefined) return false;
    const origin = (await runtime.snapshot(ThreadDoc, task.conversationId, context))?.origin;
    if (!origin) return false;
    const lander = deps.landers[origin.place];
    if (!lander) throw new Error(`no lander for place "${origin.place}"`);
    const turn: LandedTurn = { conversationId: task.conversationId, status: record.status, rows };
    await lander(origin, refusal === undefined ? turn : { ...turn, refusal }, context);
    return true;
  };
}

export interface TurnRequest {
  /** The thread's key in `rp.conversations`. */
  key: string;
  origin: ThreadOrigin;
  /** The reader's line, already written to the conversation file. */
  content: string;
  /** The turn's system prompt, by section key. */
  sections: Readonly<Record<string, string>>;
  tools: readonly string[];
  model: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
  purpose?: BudgetPurpose;
  maxRounds?: number;
  /** Timestamp of the reader's line in the file, which the history reader leaves out. */
  excludeTs?: number;
}

export interface StartedTurn {
  conversation: Conversation;
  taskId: TaskId<TurnResult>;
  /** Resolves once `rp.turn` is terminal; the outcome's result when it completed. */
  settled: Promise<TurnResult | undefined>;
  /** `rp.turn`'s start time: the landed rows are stamped after it. */
  startedAt: number;
}

export class TurnBusy extends Error {
  constructor() {
    super("a turn is already running in this conversation");
  }
}

async function isBusy(runtime: DurableRuntime, conversationId: ConversationId, context: Context): Promise<boolean> {
  const live = await runtime.harness.snapshot(LiveDoc, conversationId, context);
  return live?.run !== undefined;
}

/**
 * Reset the conversation, write `rp.desk`, configure the model, thinking level
 * and tools, and create `rp.turn` in that same commit. A busy conversation is
 * refused: a reset placed during a run would end it.
 */
export async function startTurn(runtime: DurableRuntime, request: TurnRequest, context: Context): Promise<StartedTurn> {
  const conversation = await runtime.conversationFor(request.key, request.origin, context);
  if (await isBusy(runtime, conversation.id, context)) throw new TurnBusy();
  const tools: ToolRegistration[] = request.tools.map((name) => {
    const tool = runtime.registrations.get(name);
    if (!tool) throw new Error(`no tool registered as "${name}"`);
    return tool;
  });
  runtime.desks.forget(conversation.id);
  const startedAt = runtime.now();
  await conversation.reset(undefined, context);
  const taskId = await conversation.commit(async (tx) => {
    const desk = await tx.doc(DeskDoc, conversation.id);
    desk.sections = { ...request.sections };
    desk.purpose = request.purpose ?? "chat";
    desk.maxRounds = request.maxRounds ?? DEFAULT_MAX_ROUNDS;
    desk.excludeTs = request.excludeTs ?? null;
    await configure(tx, conversation.id, {
      model: request.model,
      thinkingLevel: request.thinkingLevel ?? null,
      tools,
    });
    return tx.createTask(
      runtime.turnTask,
      { content: request.content, startedAt },
      { ownership: { kind: "conversation" }, background: true },
    );
  }, context);
  const harness = runtime.harness;
  const settled = harness.waitForTask(taskId, context).then(async (task) => {
    runtime.forgetStubs(conversation.id);
    await runtime.maybeRotate(context);
    return task.state.outcome.status === "completed" ? task.state.outcome.result : undefined;
  });
  return { conversation, taskId, settled, startedAt };
}

/** A reader's line while the run goes; false when nothing is running to take it. */
export async function steerTurn(
  runtime: DurableRuntime,
  conversation: Conversation,
  text: string,
  ts: number,
  context: Context,
): Promise<boolean> {
  if (!(await isBusy(runtime, conversation.id, context))) return false;
  const request = { type: "input", content: text, whenBusy: "steer", requestId: `${STEER_REQUEST_PREFIX}${ts}` } as const;
  await conversation.submit(request, context);
  return true;
}

export type WithdrawnSteer = { ts?: number; text: string };

/**
 * Stop: take the steers the run never placed, then abort. `rp.turn` is a
 * background task, so it outlives the abort and lands what was said. The
 * returned steers open the next turn.
 */
export async function stopTurn(
  runtime: DurableRuntime,
  conversation: Conversation,
  context: Context,
): Promise<WithdrawnSteer[]> {
  const harness = runtime.harness;
  const inbox = await harness.snapshot(InboxDoc, conversation.id, context);
  const steers: WithdrawnSteer[] = [];
  for (const item of inbox?.items ?? []) {
    if (item.mode !== "steer") continue;
    const record = await (await harness.submission(item.id, context))?.status(context);
    const ts = Number(record?.requestId?.slice(STEER_REQUEST_PREFIX.length));
    steers.push({ ...(Number.isFinite(ts) ? { ts } : {}), text: textOf({ content: item.content }) });
  }
  await conversation.abort(context);
  return steers;
}

/**
 * The stall watchdog's way out: mark the submission superseded, so its
 * `rp.turn` lands nothing, and stop. The watchdog asks again with a new turn,
 * opened with the steers this hands back.
 */
export async function supersede(
  runtime: DurableRuntime,
  conversation: Conversation,
  submission: SubmissionId,
  context: Context,
): Promise<WithdrawnSteer[]> {
  await conversation.commit(async (tx) => {
    const recovery = await tx.doc(RecoveryDoc, conversation.id);
    const key = String(submission);
    recovery.submissions[key] = { attempts: recovery.submissions[key]?.attempts ?? 0, superseded: true };
  }, context);
  return stopTurn(runtime, conversation, context);
}
