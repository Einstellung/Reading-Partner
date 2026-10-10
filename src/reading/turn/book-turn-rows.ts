// One book turn as rows on screen (docs/soul/87, 第一阶段; docs/72): drives
// durable-turn.ts's controller, turns every projected view into call rows, and
// says how the turn ended. Shared by the reading session (session/use-call.ts)
// and the phone lesson (ui/components/phone/lesson/use-lesson-call.ts).
//
// The rows come from the conversation's view state, so the reader's lines said
// into the turn, the rows they split, and the half sentence a stop keeps are
// all the runtime's; this only maps them and reports the ending.

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Receipt, ToolStatus } from "../../ai/turn-view/tool-status";
import type { TurnResult } from "../../legion/durable/extension";
import type { WithdrawnSteer } from "../../legion/durable/turn";
import { STALL_MESSAGE } from "../../legion/execute/stall";
import type { CallRow } from "./call-state";
import type { ReadingDurable } from "./durable-runtime";
import type { BookOrigin } from "./durable-book";
import { resumedTurn, runBookTurn, type BookTurn, type BookTurnRequest } from "./durable-turn";
import type { TurnView } from "./durable-view";

export type BookTurnEnd =
  | { kind: "answered"; rows: CallRow[] }
  /** Stop, or an abort from elsewhere; `steers` are the lines the model never took. */
  | { kind: "stopped"; rows: CallRow[]; steers: WithdrawnSteer[] }
  | { kind: "refused"; rows: CallRow[]; message: string }
  | { kind: "failed"; rows: CallRow[]; message: string }
  /** The stall watch cut it: nothing landed, and the turn is asked again once. */
  | { kind: "stalled"; steers: WithdrawnSteer[] };

export interface DrivenBookTurn {
  /** A line into the running turn; false when no run is going to take it. */
  steer(text: string, ts: number): Promise<boolean>;
  stop(): void;
  ended: Promise<BookTurnEnd>;
}

/** A stalled turn is asked again once (docs/pitfall/390); a second stall is shown as a failure. */
export function afterStall(attempt: number): { askAgain: true } | { askAgain: false; message: string } {
  return attempt === 0 ? { askAgain: true } : { askAgain: false, message: STALL_MESSAGE };
}

function toolStatus(tool: TurnView["rows"][number] & { role: "ai" }): ToolStatus[] {
  return tool.tools.map((t) => ({
    name: t.name,
    label: t.label,
    state: t.state === "error" ? "error" : t.state === "done" ? "done" : "running",
    ...(t.quiet ? { quiet: true as const } : {}),
    ...(t.receipt !== undefined ? { receipt: t.receipt as Receipt } : {}),
  }));
}

/** A projected view as call rows: the streaming row carries the phase, a queued line its mark. */
export function viewRows(view: TurnView): CallRow[] {
  return view.rows.map((row): CallRow => {
    if (row.role === "user") return { role: "user", text: row.text, ts: row.ts, ...(row.queued ? { queued: true } : {}) };
    const tools = toolStatus(row);
    return {
      role: "ai",
      text: row.text,
      ts: row.ts,
      ...(tools.length > 0 ? { tools } : {}),
      ...(row.streaming ? { streaming: true, ...(view.phase ? { phase: view.phase } : {}) } : {}),
    };
  });
}

/** How the turn ended, from what `rp.turn` settled with. */
export function turnEnd(
  result: TurnResult | undefined,
  rows: CallRow[],
  stopped: WithdrawnSteer[] | undefined,
): Exclude<BookTurnEnd, { kind: "stalled" }> {
  if (result?.refusal !== undefined) return { kind: "refused", rows, message: result.refusal };
  if (stopped) return { kind: "stopped", rows, steers: stopped };
  if (!result) return { kind: "failed", rows, message: "the turn did not finish" };
  if (result.status === "done") return { kind: "answered", rows };
  if (result.reason === "aborted") return { kind: "stopped", rows, steers: [] };
  return { kind: "failed", rows, message: result.detail ?? result.reason ?? "the turn ended without an answer" };
}

/** Start a book turn and follow it as rows. `onRows` gets every view, mapped. */
export function driveBookTurn(
  durable: ReadingDurable,
  request: Omit<BookTurnRequest, "onView">,
  onRows: (rows: CallRow[]) => void,
  context: Context = BACKGROUND_CONTEXT,
): Promise<DrivenBookTurn> {
  return asRows((onView) => runBookTurn(durable, { ...request, onView }, context), onRows);
}

/** A turn in flight on a thread that nothing on screen holds, before it is followed. */
export interface ResumedBookTurn {
  /** Every row of the turn comes after this timestamp. */
  after: number;
  follow(onRows: (rows: CallRow[]) => void): Promise<DrivenBookTurn>;
}

/**
 * The turn in flight on a book thread the reader is opening — after a
 * restart, the one recovery resumed (docs/soul/87, "被杀之后") — so it can be
 * drawn, stopped and steered like one started here. Undefined when idle.
 */
export async function resumedBookTurn(
  durable: ReadingDurable,
  origin: Pick<BookOrigin, "home" | "threadId">,
  context: Context = BACKGROUND_CONTEXT,
): Promise<ResumedBookTurn | undefined> {
  const found = await resumedTurn(durable, origin, context);
  if (!found) return undefined;
  return { after: found.startedAt, follow: (onRows) => asRows((onView) => found.follow(onView), onRows) };
}

async function asRows(
  begin: (onView: (view: TurnView) => void) => Promise<BookTurn>,
  onRows: (rows: CallRow[]) => void,
): Promise<DrivenBookTurn> {
  let rows: CallRow[] = [];
  let stopping: Promise<WithdrawnSteer[]> | undefined;
  const turn = await begin((view) => {
    rows = viewRows(view);
    onRows(rows);
  });
  const ended = turn.settled.then(async ({ result, stalled }): Promise<BookTurnEnd> => {
    if (stalled) return { kind: "stalled", steers: stalled };
    // The last view before the run ended is what landed: every row committed.
    const final = rows.map((row) => (row.streaming ? { ...row, streaming: undefined, phase: undefined } : row));
    return turnEnd(result, final, stopping ? await stopping : undefined);
  });
  return {
    steer: (text, ts) => turn.steer(text, ts),
    stop() {
      stopping ??= turn.stop();
    },
    ended,
  };
}
