// Background passes on the device's Harness (docs/soul/87, "第三阶段"):
// distillation, chapter notes, paper digests — work a program starts and no
// reader watches. Each run is an ownerless conversation of its own with one
// user message, the pass's system prompt and the pass's tools, and leaves no
// live task once it settles, so it holds up a generation swap only while it
// runs.
//
// A pass's tools are built per run and their descriptions and schemas vary
// with the run (the observation tools print the rows they accept), so they
// cannot come from the process-wide catalog. Each run installs an extension of
// its own holding exactly those tools, selected beside ours in its
// conversation only (the host default selects ours alone), and uninstalls it
// when it settles.
//
// Killed mid-pass, the run is not resumed: recovery aborts every background
// conversation (recover.ts), and the pass runs again from its own files the
// next time its trigger fires — the distillation cursor, the prep note not yet
// written.

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelThinkingLevel, ThinkingLevel } from "@earendil-works/pi-ai";
import { defineExtension, type Conversation, type EntryRecord, type ToolRegistration } from "@earendil-works/pi-durable";
import { resolveModel } from "../../ai/model-call";
import type { BudgetPurpose } from "../../budget";
import { newRunId, type AiSurface } from "../../platform/app/cache-telemetry";
import type { AgentTool } from "../execute/contract";
import { StoppedError } from "../stop";
import type { PlaceFactory } from "./device";
import { DeskDoc, ThreadDoc, type ThreadOrigin, type TurnResult } from "./extension";
import type { DurableRuntime } from "./harness";
import { executeTool } from "./tools";
import { textOf } from "./turn";

export const BACKGROUND_PLACE = "background";
export const BACKGROUND_REQUEST_PREFIX = "background:";

/** `rp.thread` of a background conversation: the pass, its log surface and the run. */
export type BackgroundOrigin = ThreadOrigin & { place: typeof BACKGROUND_PLACE; name: string; surface: AiSurface; run: string };

export function isBackground(origin: ThreadOrigin | null | undefined): origin is BackgroundOrigin {
  return origin?.place === BACKGROUND_PLACE;
}

/** Same shape as legion/subagent's SubagentTurnRequest, plus the progress the prep pipelines' watchdogs run on. */
export interface BackgroundTurnRequest {
  /** The pass, for the conversation's `rp.thread`. */
  name: string;
  systemPrompt: string;
  /** The one user message the run starts from. */
  task: string;
  tools: readonly AgentTool[];
  maxRounds: number;
  purpose: BudgetPurpose;
  /** Absent: the background-pipeline setting (`prep`). */
  model?: { providerId: string; modelId: string; reasoning?: ThinkingLevel };
  signal?: AbortSignal;
  /** Who its requests are logged under; `subagent` unless said. */
  surface?: AiSurface;
  onRound?(info: { round: number; rounds: number }): void;
  /** Characters of answer and thinking received so far, as they arrive. */
  onProgress?(chars: number): void;
}

export type BackgroundTurnOutcome =
  | { kind: "answer"; text: string }
  | { kind: "refusal"; message: string }
  | { kind: "error"; message: string; name?: string };

/** What a run needs from the device runtime; `ended` closes the run's turn-log entry. */
export interface BackgroundHost {
  runtime: DurableRuntime;
  ended?(key: string, result: TurnResult): void;
}

export function backgroundKey(origin: BackgroundOrigin): string {
  return `${BACKGROUND_PLACE}:${origin.name}:${origin.run}`;
}

/** The place every device runtime has for background conversations: logs only, nothing to land or read back. */
export const backgroundPlace: PlaceFactory = () => ({
  key: (origin) => backgroundKey(origin as BackgroundOrigin),
  address: () => {
    throw new Error("a background conversation has no thread file");
  },
  resolve: async () => {
    throw new Error("a background conversation's tools are its run's own");
  },
  land: async () => {},
  readHistory: async () => [],
  telemetry: (origin) => ({ surface: (origin as BackgroundOrigin).surface, thread: (origin as BackgroundOrigin).run }),
});

function registration(tool: AgentTool): ToolRegistration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: (args, _api, context) => executeTool(tool, args, context),
  };
}

type Part = { type?: string; text?: string; thinking?: string };

function received(message: unknown): number {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return (content as Part[]).reduce((n, part) => n + (part.text?.length ?? 0) + (part.thinking?.length ?? 0), 0);
}

function assistants(entries: readonly EntryRecord[]): EntryRecord[] {
  return entries.filter((entry) => entry.kind === "pi.assistant");
}

/** Feed onRound and onProgress from the conversation's view until the returned function is called. */
async function follow(conversation: Conversation, request: BackgroundTurnRequest, context: Context): Promise<() => void> {
  if (!request.onRound && !request.onProgress) return () => {};
  const view = await conversation.viewState(context);
  let round = 0;
  let chars = 0;
  const seen = (value: { entries: readonly EntryRecord[]; docs: Record<string, unknown> }) => {
    const done = assistants(value.entries);
    const live = (value.docs["pi.live"] as { generation?: { message?: unknown } } | undefined)?.generation;
    const next = done.length + (live ? 1 : 0);
    if (next > round) {
      round = next;
      request.onRound?.({ round, rounds: request.maxRounds });
    }
    const total = done.reduce((n, entry) => n + received(entry.model?.[0]), 0) + received(live?.message);
    if (total > chars) {
      chars = total;
      request.onProgress?.(chars);
    }
  };
  const unsubscribe = view.subscribe((value) => seen(value));
  if (view.value) seen(view.value);
  return () => {
    unsubscribe();
    view.dispose();
  };
}

/** One background run on `host`'s runtime, to its end. A cancelled run rejects with StoppedError. */
export async function runBackgroundTurnOn(host: BackgroundHost, request: BackgroundTurnRequest): Promise<BackgroundTurnOutcome> {
  const { runtime } = host;
  const { signal } = request;
  const context = BACKGROUND_CONTEXT;
  if (signal?.aborted) throw new StoppedError();
  const model = request.model ?? (await resolveModel("prep"));
  if (signal?.aborted) throw new StoppedError();
  const run = newRunId();
  const origin: BackgroundOrigin = { place: BACKGROUND_PLACE, name: request.name, surface: request.surface ?? "subagent", run };
  const tools = request.tools.map(registration);
  const own = defineExtension({ name: `rp.background:${run}`, tools });
  runtime.install(own);
  let conversation: Conversation | undefined;
  let stopFollowing = () => {};
  const stop = () => void conversation?.abort(context).catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  let result: TurnResult = { status: "unanswered", landed: false };
  try {
    conversation = await runtime.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: model.providerId, modelId: model.modelId },
          thinkingLevel: (model.reasoning ?? "off") as ModelThinkingLevel,
          extensions: [runtime.extension, own],
          tools,
        },
        init: async (tx, id) => {
          (await tx.doc(ThreadDoc, id)).origin = origin;
          const desk = await tx.doc(DeskDoc, id);
          desk.sections = { [runtime.sectionKeys[0] ?? "turn"]: request.systemPrompt };
          desk.purpose = request.purpose;
          desk.maxRounds = request.maxRounds;
          desk.excludeTs = null;
          desk.turn = run;
        },
      },
      context,
    );
    stopFollowing = await follow(conversation, request, context);
    if (signal?.aborted) stop();
    const submission = await conversation.submit(
      { type: "input", content: request.task, requestId: `${BACKGROUND_REQUEST_PREFIX}${run}` },
      context,
    );
    const record = await submission.wait(context);
    const ended = record as { reason?: string; detail?: unknown };
    result = {
      status: record.status,
      landed: false,
      ...(ended.reason ? { reason: ended.reason } : {}),
      ...(typeof ended.detail === "string" ? { detail: ended.detail } : {}),
    };
    const refusal = runtime.takeRefusal(conversation.id);
    if (refusal !== undefined) {
      result.refusal = refusal;
      return { kind: "refusal", message: refusal };
    }
    if (signal?.aborted) throw new StoppedError();
    const said = assistants((await conversation.context(context)).entries);
    const last = said[said.length - 1]?.model?.[0] as { stopReason?: string; errorMessage?: string } | undefined;
    request.onRound?.({ round: said.length, rounds: request.maxRounds });
    if (record.status !== "done") {
      return { kind: "error", message: result.detail ?? last?.errorMessage ?? result.reason ?? "the run ended without an answer" };
    }
    if (last?.stopReason === "error") return { kind: "error", message: last.errorMessage ?? "the model call failed" };
    return { kind: "answer", text: textOf(last) };
  } finally {
    signal?.removeEventListener("abort", stop);
    stopFollowing();
    runtime.uninstall(own);
    if (conversation) {
      runtime.takeRefusal(conversation.id);
      runtime.forgetStubs(conversation.id);
    }
    host.ended?.(backgroundKey(origin), result);
    await runtime.maybeRotate(context).catch(() => false);
  }
}

// The device runtime as the shell opened it. A pass that starts before the
// runtime is up waits for it.
let source: (() => Promise<BackgroundHost> | undefined) | undefined;
let announce: () => void = () => {};
let provided = new Promise<void>((resolve) => (announce = resolve));

/** The shell says where the device runtime is (reading/turn/durable-runtime.ts). */
export function provideBackgroundHost(get: () => Promise<BackgroundHost> | undefined): void {
  source = get;
  announce();
  provided = Promise.resolve();
}

async function backgroundHost(signal?: AbortSignal): Promise<BackgroundHost> {
  for (;;) {
    const pending = source?.();
    if (pending) return pending;
    if (signal?.aborted) throw new StoppedError();
    await provided;
    if (!source?.()) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** One background run on the device runtime: what distillation, chapter notes and digests run on. */
export async function runBackgroundTurn(request: BackgroundTurnRequest): Promise<BackgroundTurnOutcome> {
  return runBackgroundTurnOn(await backgroundHost(request.signal), request);
}
