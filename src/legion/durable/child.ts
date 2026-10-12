// Child conversations: a sub-agent's run as a conversation of its own in the
// device Harness (docs/soul/87, 第三阶段). The child gets its own system prompt
// (`instructions`), model and tools; the caller sees nothing of its entries,
// only what `settleChild` reads back out of them.
//
// A tool call owns the child it creates (`ownership: task`): the child dies
// with the call, and after a restart the replay-safe call finds the same child
// and the same submission again.
//
// A child's tools are the caller's own AgentTools, built with the caller's
// deps. Registration is per name and per process, so each definition gets an
// extension of its own (`rp-agent-<name>`) whose calls look the conversation's
// tools up in `ChildDesks`, filled by whoever drives the child.

import type { Context } from "@earendil-works/chord";
import { awaitWithContext } from "@earendil-works/chord/context";
import type { AssistantMessage, ModelThinkingLevel, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  configure,
  defineDoc,
  defineExtension,
  type AgentChange,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type Extension,
  type SettledSubmissionRecord,
  type ToolExecutionApi,
  type ToolRegistration,
  type Tx,
} from "@earendil-works/pi-durable";
import type { BudgetPurpose } from "../../budget";
import type { AgentTool } from "./contract";
import type { DurableRuntime } from "./harness";
import { executeTool } from "./tools";

/** `rp.subagent`: marks a conversation as a sub-agent's child; the round cap and budget purpose its requests keep. */
export type SubagentState = { name: string; maxRounds: number; purpose: BudgetPurpose };
export const SubagentDoc = defineDoc<SubagentState>({
  kind: "rp.subagent",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ name: "", maxRounds: 0, purpose: "chat" }),
});

/** The conversation's `rp.subagent`, when it is a child. */
export function childState(state: SubagentState | undefined): SubagentState | undefined {
  return state?.name ? state : undefined;
}

export const SUBAGENT_REQUEST_PREFIX = "subagent:";
const EXTENSION_PREFIX = "rp-agent-";

/** The tools of each running child, by conversation. A call that comes before its driver waits for it. */
export class ChildDesks {
  private readonly desks = new Map<ConversationId, { tools: Promise<readonly AgentTool[]>; provide(tools: readonly AgentTool[]): void }>();

  private slot(id: ConversationId) {
    let slot = this.desks.get(id);
    if (!slot) {
      let provide!: (tools: readonly AgentTool[]) => void;
      const tools = new Promise<readonly AgentTool[]>((resolve) => (provide = resolve));
      slot = { tools, provide };
      this.desks.set(id, slot);
    }
    return slot;
  }

  provide(id: ConversationId, tools: readonly AgentTool[]): void {
    this.slot(id).provide(tools);
  }

  /**
   * After a restart a child's replayed call can run before the parent's call
   * that drives it reruns; it waits here, and an abort of either lets go.
   */
  tools(id: ConversationId, context: Context): Promise<readonly AgentTool[]> {
    return awaitWithContext(this.slot(id).tools, context);
  }

  forget(id: ConversationId): void {
    this.desks.delete(id);
  }

  clear(): void {
    this.desks.clear();
  }
}

function childRegistration(spec: AgentTool, children: ChildDesks): ToolRegistration {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    ...(spec.replay === "safe" ? { replay: "safe" as const } : {}),
    async execute(args, api, context) {
      const tools = await children.tools(api.conversationId, context);
      const tool = tools.find((t) => t.name === spec.name);
      if (!tool) throw new Error(`${spec.name} is not available here`);
      return executeTool(tool, args, context);
    },
  };
}

export interface ChildExtension {
  extension: Extension;
  tools: ToolRegistration[];
}

/** The extension a definition's children run with; installing it again replaces it in place. */
export function childExtension(name: string, tools: readonly AgentTool[], children: ChildDesks): ChildExtension {
  const registrations = tools.map((tool) => childRegistration(tool, children));
  return { extension: defineExtension({ name: `${EXTENSION_PREFIX}${name}`, tools: registrations }), tools: registrations };
}

/** What a child runs with and is asked. */
export interface ChildSpec {
  /** The definition's name: the extension, the logs. */
  name: string;
  instructions: string;
  tools: readonly AgentTool[];
  model: { provider: string; modelId: string };
  thinkingLevel?: ModelThinkingLevel;
  maxRounds: number;
  purpose: BudgetPurpose;
  task: string;
}

export type ChildEnd =
  | { kind: "answer"; text: string }
  | { kind: "error"; message: string; name?: string }
  | { kind: "refusal"; message: string }
  | { kind: "aborted" };

export interface ChildToolFailure {
  name: string;
  reason: string;
  count: number;
}

/** Counted from the child's entries, so a run that spans a restart counts every round and call. */
export interface ChildStats {
  rounds: number;
  toolCalls: number;
  toolSuccesses: number;
  toolFailures: ChildToolFailure[];
}

export interface ChildResult {
  conversationId: ConversationId;
  end: ChildEnd;
  stats: ChildStats;
}

function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

function resultText(result: ToolResultMessage): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** Rounds and tool outcomes of the run that starts after `from` (the task's `pi.user`). */
export function childStats(entries: readonly EntryRecord[], from: EntryId): ChildStats {
  const start = entries.findIndex((e) => e.id === from);
  const run = start < 0 ? [] : entries.slice(start + 1);
  const stats: ChildStats = { rounds: 0, toolCalls: 0, toolSuccesses: 0, toolFailures: [] };
  const names = new Map<string, string>();
  for (const entry of run) {
    const message = entry.model?.[0];
    if (entry.kind === "pi.assistant") {
      const assistant = message as AssistantMessage | undefined;
      // A half sentence killed with the process and asked again is not a round of its own.
      if (assistant?.stopReason !== "aborted") stats.rounds++;
      for (const part of assistant?.content ?? []) if (part.type === "toolCall") names.set(part.id, part.name);
    } else if (entry.kind === "pi.tool-result") {
      const result = message as ToolResultMessage | undefined;
      if (!result) continue;
      stats.toolCalls++;
      if (!result.isError) {
        stats.toolSuccesses++;
        continue;
      }
      const name = names.get(result.toolCallId) ?? result.toolName;
      const failure = stats.toolFailures.find((f) => f.name === name);
      // The first reason is kept: later attempts often fail as a consequence of it.
      if (failure) failure.count++;
      else stats.toolFailures.push({ name, reason: resultText(result), count: 1 });
    }
  }
  return stats;
}

async function entriesOf(runtime: DurableRuntime, conversationId: ConversationId, context: Context): Promise<EntryRecord[]> {
  const entries: EntryRecord[] = [];
  let cursor: Parameters<DurableRuntime["storage"]["scanEntries"]>[2];
  do {
    const page = await runtime.storage.scanEntries({ conversationId, order: "ascending" }, 500, cursor, context);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return entries;
}

/** Read how the child's submission ended and what it did on the way. */
async function settleChild(
  runtime: DurableRuntime,
  conversationId: ConversationId,
  record: SettledSubmissionRecord,
  context: Context,
): Promise<ChildResult> {
  const entries = await entriesOf(runtime, conversationId, context);
  const stats = childStats(entries, record.entry as EntryId);
  const refusal = runtime.takeRefusal(conversationId);
  let end: ChildEnd;
  if (record.status === "done") {
    const answer = entries.find((e) => e.id === record.answer);
    end = { kind: "answer", text: textOf(answer?.model?.[0] as AssistantMessage | undefined) };
  } else if (refusal !== undefined) {
    end = { kind: "refusal", message: refusal };
  } else if (record.reason === "aborted") {
    end = { kind: "aborted" };
  } else {
    const detail = typeof record.detail === "string" ? record.detail : record.detail === undefined ? "" : JSON.stringify(record.detail);
    end = { kind: "error", message: detail || record.reason || "the sub-agent's run failed" };
  }
  return { conversationId, end, stats };
}

function agentOf(runtime: DurableRuntime, spec: ChildSpec): AgentChange {
  const child = runtime.installChild(spec.name, spec.tools);
  return {
    model: { provider: spec.model.provider, modelId: spec.model.modelId },
    ...(spec.thinkingLevel ? { thinkingLevel: spec.thinkingLevel } : {}),
    extensions: [runtime.extension, child.extension],
    tools: child.tools,
    instructions: spec.instructions,
  };
}

async function initChild(tx: Tx, conversationId: ConversationId, spec: ChildSpec) {
  Object.assign(await tx.doc(SubagentDoc, conversationId), {
    name: spec.name,
    maxRounds: spec.maxRounds,
    purpose: spec.purpose,
  });
}

async function submitAndSettle(
  runtime: DurableRuntime,
  conversationId: ConversationId,
  submit: () => Promise<SettledSubmissionRecord>,
  context: Context,
): Promise<ChildResult> {
  try {
    const record = await submit();
    return await settleChild(runtime, conversationId, record, context);
  } finally {
    runtime.children.forget(conversationId);
    runtime.forgetStubs(conversationId);
  }
}

/**
 * Run `spec` as the child of the calling tool. A rerun of the call after a
 * restart finds the child and its submission again (the ownership index and
 * the requestId), so the tool declares `replay: "safe"`.
 */
export async function runTaskChild(
  runtime: DurableRuntime,
  api: ToolExecutionApi,
  spec: ChildSpec,
  context: Context,
): Promise<ChildResult> {
  const agent = agentOf(runtime, spec);
  const child = await api.commit(async (tx) => {
    const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
    if (existing !== undefined) return existing.id;
    const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
    await configure(tx, created.id, agent);
    await initChild(tx, created.id, spec);
    return created.id;
  }, context);
  runtime.children.provide(child, spec.tools);
  return submitAndSettle(
    runtime,
    child,
    async () => {
      const handle = (await api.conversation(child, context))!;
      const request = { type: "input", content: spec.task, requestId: `${SUBAGENT_REQUEST_PREFIX}${api.taskId}` } as const;
      return (await handle.submit(request, context)).wait(context);
    },
    context,
  );
}
