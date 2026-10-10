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
  type SubmissionRecord,
  type TaskId,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { BudgetPurpose } from "../../budget";
import {
  ConversationsDoc,
  DeskDoc,
  PartialDoc,
  RecoveryDoc,
  ThreadDoc,
  type LandStep,
  type ThreadOrigin,
  type TurnBell,
  type TurnContent,
  type TurnInput,
  type TurnResult,
} from "./extension";
import type { DurableRuntime } from "./harness";

export const DEFAULT_MAX_ROUNDS = 8;
export const STEER_REQUEST_PREFIX = "steer:";
const TURN_TASK = "rp.turn";

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
  /** The bell this turn answered, when a bell started it. */
  bell?: TurnBell;
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

function steerTs(records: readonly SubmissionRecord[]): Map<EntryId, number> {
  const out = new Map<EntryId, number>();
  for (const record of records) {
    if (record.entry === undefined || !record.requestId?.startsWith(STEER_REQUEST_PREFIX)) continue;
    const ts = Number(record.requestId.slice(STEER_REQUEST_PREFIX.length));
    if (Number.isFinite(ts)) out.set(record.entry, ts);
  }
  return out;
}

async function recentSubmissions(storage: Storage, conversationId: ConversationId, context: Context) {
  return (await storage.scanSubmissions({ conversationId, order: "descending" }, 200, undefined, context)).items;
}

/** Entry id to the reader's row timestamp, from the steer submissions' request ids. */
export async function steerTimestamps(
  storage: Storage,
  conversationId: ConversationId,
  context: Context,
): Promise<Map<EntryId, number>> {
  return steerTs(await recentSubmissions(storage, conversationId, context));
}

export interface LandDeps {
  landers: Readonly<Record<string, Lander>>;
  storage(): Storage;
  takeRefusal(conversationId: ConversationId): string | undefined;
}

export function createLandStep(deps: LandDeps): LandStep {
  return async (task, runtime, record, context) => {
    if (record.type !== "input" || (record.status !== "done" && record.status !== "unanswered")) {
      return { status: record.status, landed: false };
    }
    const recent = await recentSubmissions(deps.storage(), task.conversationId, context);
    // The turn's runs: its own, then one per steer the final boundary took
    // (docs/pitfall/519). The last one says how the turn ended.
    const runs = recent
      .filter(
        (r) =>
          r.id === record.id ||
          (r.id > record.id && r.entry !== undefined && r.requestId?.startsWith(STEER_REQUEST_PREFIX) === true),
      )
      .sort((x, y) => x.id - y.id);
    const last = runs[runs.length - 1] ?? record;
    const status = last.status === "done" || last.status === "unanswered" ? last.status : record.status;
    const ids = new Set(runs.map((r) => String(r.id)));
    const ended = last as { reason?: string; detail?: unknown };
    const why: Omit<TurnResult, "landed"> = {
      status,
      ...(status === "unanswered" && ended.reason ? { reason: ended.reason } : {}),
      ...(status === "unanswered" && typeof ended.detail === "string" ? { detail: ended.detail } : {}),
    };
    const recovery = await runtime.snapshot(RecoveryDoc, task.conversationId, context);
    if ([...ids].some((id) => recovery?.submissions[id]?.superseded)) return { ...why, landed: false };
    const refusal = deps.takeRefusal(task.conversationId);
    if (refusal !== undefined) why.refusal = refusal;
    let rows: LandedRow[] = [];
    if (record.entry !== undefined) {
      const view = await runtime.context(task.conversationId, context);
      const partial = await runtime.snapshot(PartialDoc, task.conversationId, context);
      const half = status === "unanswered" && partial && ids.has(String(partial.submission)) ? partial.text : "";
      rows = projectRun(view.entries, record.entry, {
        startedAt: task.input.startedAt,
        steerTs: steerTs(recent),
        ...(half ? { partial: half } : {}),
      });
    }
    if (rows.length === 0 && refusal === undefined) return { ...why, landed: false };
    const origin = (await runtime.snapshot(ThreadDoc, task.conversationId, context))?.origin;
    if (!origin) return { ...why, landed: false };
    const lander = deps.landers[origin.place];
    if (!lander) throw new Error(`no lander for place "${origin.place}"`);
    const turn: LandedTurn = {
      conversationId: task.conversationId,
      status,
      rows,
      ...(task.input.bell ? { bell: task.input.bell } : {}),
    };
    await lander(origin, refusal === undefined ? turn : { ...turn, refusal }, context);
    return { ...why, landed: true };
  };
}

export interface TurnRequest {
  /** The thread's key in `rp.conversations`. */
  key: string;
  origin: ThreadOrigin;
  /** The reader's line, already written to the conversation file. */
  content: TurnContent;
  /** The turn's system prompt, by section key. */
  sections: Readonly<Record<string, string>>;
  tools: readonly string[];
  model: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
  purpose?: BudgetPurpose;
  maxRounds?: number;
  /** Timestamp of the reader's line in the file, which the history reader leaves out. */
  excludeTs?: number;
  /** The bell this turn answers; `content` is then the bell, which is never written to the file. */
  bell?: TurnBell;
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

async function isRunning(runtime: DurableRuntime, conversationId: ConversationId, context: Context): Promise<boolean> {
  const live = await runtime.harness.snapshot(LiveDoc, conversationId, context);
  return live?.run !== undefined;
}

/**
 * A run is going, or the conversation's `rp.turn` has not settled: one that is
 * landing has no run left, and a reset then would land under the next turn.
 * `startTurn` refuses while busy, so only the newest `rp.turn` can be live.
 */
async function isBusy(runtime: DurableRuntime, conversationId: ConversationId, context: Context): Promise<boolean> {
  if (await isRunning(runtime, conversationId, context)) return true;
  const task = await latestTurn(runtime, conversationId, context);
  return task !== undefined && task.state.status !== "terminal";
}

async function latestTurn(runtime: DurableRuntime, conversationId: ConversationId, context: Context) {
  const page = await runtime.storage.scanTasks(
    { conversationId, kind: TURN_TASK, order: "descending" },
    1,
    undefined,
    context,
  );
  return page.items[0];
}

/** Resolves once `rp.turn` is terminal, with its result when it completed. */
function turnSettled(
  runtime: DurableRuntime,
  conversationId: ConversationId,
  taskId: TaskId<TurnResult>,
  context: Context,
): Promise<TurnResult | undefined> {
  return runtime.harness.waitForTask(taskId, context).then(async (task) => {
    runtime.forgetStubs(conversationId);
    await runtime.maybeRotate(context);
    return task.state.outcome.status === "completed" ? task.state.outcome.result : undefined;
  });
}

/**
 * Reset the conversation, write `rp.desk`, configure the model, thinking level
 * and tools, and create `rp.turn` in that same commit. A busy conversation is
 * refused: a reset placed during a run would end it, and one placed while the
 * last turn lands would land in its place.
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
      { content: request.content, startedAt, ...(request.bell ? { bell: request.bell } : {}) },
      { ownership: { kind: "conversation" }, background: true },
    );
  }, context);
  const settled = turnSettled(runtime, conversation.id, taskId, context);
  return { conversation, taskId, settled, startedAt };
}

/**
 * The turn in flight in a thread's conversation: a run going or `rp.turn`
 * still landing. After a restart it is the one recovery resumed, which nothing
 * on screen started (docs/soul/87, "被杀之后"). Undefined when the thread has
 * no conversation in this generation or its last turn has settled; looking
 * creates nothing.
 */
export async function turnInFlight(
  runtime: DurableRuntime,
  key: string,
  context: Context,
): Promise<Omit<StartedTurn, "taskId"> | undefined> {
  const id = (await runtime.harness.snapshot(ConversationsDoc, context))?.threads[key] as ConversationId | undefined;
  if (id === undefined) return undefined;
  const task = await latestTurn(runtime, id, context);
  if (!task || task.state.status === "terminal") return undefined;
  const conversation = await runtime.harness.conversation(id, context);
  if (!conversation) return undefined;
  return {
    conversation,
    startedAt: (task.input as TurnInput).startedAt,
    settled: turnSettled(runtime, id, task.id as TaskId<TurnResult>, context),
  };
}

/** A reader's line while the run goes; false when nothing is running to take it. */
export async function steerTurn(
  runtime: DurableRuntime,
  conversation: Conversation,
  text: string,
  ts: number,
  context: Context,
): Promise<boolean> {
  if (!(await isRunning(runtime, conversation.id, context))) return false;
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

/**
 * The `rp.turn` a bell started in this conversation, and its end. A process
 * killed mid-answer leaves the bell unacked and the turn resumed, so the next
 * pass waits for that turn instead of starting a second one.
 */
export async function bellTurn(
  runtime: DurableRuntime,
  conversationId: ConversationId,
  bellId: string,
  context: Context,
): Promise<Promise<TurnResult | undefined> | undefined> {
  const page = await runtime.storage.scanTasks(
    { conversationId, kind: TURN_TASK, order: "descending" },
    50,
    undefined,
    context,
  );
  const task = page.items.find((t) => (t.input as TurnInput | null)?.bell?.id === bellId);
  if (!task) return undefined;
  return runtime.harness
    .waitForTask(task.id as TaskId<TurnResult>, context)
    .then((done) => (done.state.outcome.status === "completed" ? done.state.outcome.result : undefined));
}
