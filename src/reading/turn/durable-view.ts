// A durable conversation's view state as the rows of the running turn
// (docs/soul/87, "一个回合" step 4; docs/72 for what the rows mean).
//
// The committed part of the run is projected by the same function the landing
// step uses (legion/durable/turn.ts projectRun), so every row on screen has the
// timestamp it will have in the thread file and the landed file replaces the
// live rows without a re-render. On top of that: `pi.live`'s half sentence goes
// into the row being written, its tool slots become the row's tool lines, and
// `pi.inbox`'s steers are the reader's queued lines under it.
//
// The splitting rules fall out of projectRun: a steer the model was handed
// closes the row above it when that row produced something (words or a tool
// call, docs/pitfall/510) and the answer opens a new row after the steer; a row
// that produced nothing is not there at all (docs/pitfall/360); and a tool call
// never wipes the words written before it (docs/pitfall/291).

import type { EntryId, EntryRecord } from "@earendil-works/pi-durable";
import { projectRun, textOf, type LandedRow } from "../../legion/durable/turn";

export type ViewToolState = "pending" | "running" | "done" | "error";

export interface ViewTool {
  callId: string;
  name: string;
  label: string;
  state: ViewToolState;
  quiet?: true;
  receipt?: unknown;
}

export type TurnViewRow =
  | { role: "ai"; ts: number; text: string; tools: ViewTool[]; streaming: boolean }
  | { role: "user"; ts: number; text: string; queued: boolean };

export type TurnViewPhase = "thinking" | "writing" | "tool" | null;

export interface TurnView {
  /** The run's rows after the reader's opening line, in order. */
  rows: TurnViewRow[];
  phase: TurnViewPhase;
  /** A run is going: Stop and steering apply. */
  busy: boolean;
}

/** The parts of a conversation view this reads (pi-durable's ConversationView). */
export interface ViewSource {
  readonly entries: readonly EntryRecord[];
  readonly docs: Readonly<Record<string, unknown>>;
}

type LiveSlot = { callId: string; name: string; status: "pending" | "running" | "done"; details?: unknown };
type Live = {
  run?: { inputs: number[] };
  generation?: { message?: unknown };
  tools?: LiveSlot[];
};
type InboxItem = { id: number; mode: string; content?: unknown };

export interface ProjectViewOptions {
  /** `rp.turn`'s start time. */
  startedAt: number;
  /** The reader's row timestamps of the steers the model was handed, by their `pi.user` entry. */
  steerTs: ReadonlyMap<EntryId, number>;
  /** The reader's row timestamps of the steers still in the inbox, by submission id. */
  queuedTs: ReadonlyMap<number, number>;
  describe(name: string, args: unknown): { label: string; quiet?: true };
}

type ToolCallPart = { type?: string; id?: string; name?: string; arguments?: unknown };

function toolCalls(message: unknown): ToolCallPart[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? (content as ToolCallPart[]).filter((p) => p.type === "toolCall") : [];
}

/** The run's opening `pi.user` entry: every turn starts from a reset, so it is the first one active. */
export function runStart(entries: readonly EntryRecord[]): EntryId | undefined {
  return entries.find((e) => e.kind === "pi.user")?.id;
}

export function projectView(view: ViewSource, options: ProjectViewOptions): TurnView {
  const live = view.docs["pi.live"] as Live | undefined;
  const inbox = (view.docs["pi.inbox"] as { items?: InboxItem[] } | undefined)?.items ?? [];
  const from = runStart(view.entries);
  const landed: LandedRow[] =
    from === undefined ? [] : projectRun(view.entries, from, { startedAt: options.startedAt, steerTs: options.steerTs });
  // Results already in the transcript, for the state of a tool line.
  const results = new Map<string, boolean>();
  for (const e of view.entries) {
    const m = e.model?.[0] as { role?: string; toolCallId?: string; isError?: boolean } | undefined;
    if (e.kind === "pi.tool-result" && m?.toolCallId) results.set(m.toolCallId, m.isError === true);
  }
  const busy = live?.run !== undefined;
  const slots = new Map((live?.tools ?? []).map((slot) => [slot.callId, slot]));

  const rows: TurnViewRow[] = landed.map((row) => {
    if (row.role === "user") return { role: "user", ts: row.ts, text: row.text, queued: false };
    const tools = row.tools.map((tool): ViewTool => {
      const { label, quiet } = options.describe(tool.name, tool.args);
      const done = results.has(tool.callId);
      const slot = slots.get(tool.callId);
      const state: ViewToolState = done
        ? results.get(tool.callId)
          ? "error"
          : "done"
        : slot?.status === "pending"
          ? "pending"
          : "running";
      const receipt = done ? tool.details : slot?.details;
      return {
        callId: tool.callId,
        name: tool.name,
        label,
        state,
        ...(quiet ? { quiet } : {}),
        ...(receipt !== undefined ? { receipt } : {}),
      };
    });
    return { role: "ai", ts: row.ts, text: row.text, tools, streaming: false };
  });

  const lastTs = () => rows[rows.length - 1]?.ts ?? options.startedAt;
  const writing = (): Extract<TurnViewRow, { role: "ai" }> => {
    const last = rows[rows.length - 1];
    if (last?.role === "ai") return last;
    const row: Extract<TurnViewRow, { role: "ai" }> = { role: "ai", ts: lastTs() + 1, text: "", tools: [], streaming: true };
    rows.push(row);
    return row;
  };

  let phase: TurnViewPhase = null;
  if (busy) {
    const row = writing();
    row.streaming = true;
    const half = textOf(live?.generation?.message);
    if (half) row.text = row.text ? `${row.text}\n\n${half}` : half;
    for (const call of toolCalls(live?.generation?.message)) {
      if (row.tools.some((t) => t.callId === call.id)) continue;
      const { label, quiet } = options.describe(call.name ?? "", call.arguments);
      row.tools.push({ callId: call.id ?? "", name: call.name ?? "", label, state: "pending", ...(quiet ? { quiet } : {}) });
    }
    const toolRunning = row.tools.some((t) => (t.state === "running" || t.state === "pending") && !t.quiet);
    phase = live?.generation ? (half ? "writing" : "thinking") : toolRunning ? "tool" : "thinking";
  }

  for (const item of inbox) {
    if (item.mode !== "steer") continue;
    const ts = Math.max(options.queuedTs.get(item.id) ?? lastTs() + 1, lastTs() + 1);
    rows.push({ role: "user", ts, text: textOf({ content: item.content }), queued: true });
  }
  return { rows, phase, busy };
}
