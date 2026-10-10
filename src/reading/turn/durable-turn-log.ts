// The turn log (legion/execute/turn-log.ts) for book turns on the durable
// runtime: the lines the old turn loop wrote, with the same meanings, keyed by
// the thread's conversation key.
//
// - start: when a turn is started here, or at the first request this process
//   sees of a turn it did not start (one recovery resumed after a restart).
// - first-byte: the first partial of a round's answer on the conversation's
//   view, so only while someone follows the turn (durable-turn.ts).
// - round: each answer that came back (the runtime's response recorder).
// - end: when `rp.turn` settles, or when the follower sees it end; once.
//
// There is no lane on the durable runtime (a busy conversation is steered,
// not queued), so `queued` and `lane` are never written and `held` is false.

import type { TurnResult } from "../../legion/durable/extension";
import type { TurnEnd, TurnLogEvent, TurnLogSink } from "../../legion/execute/turn-log";
import { newRunId, type AiSurface } from "../../platform/app/cache-telemetry";

export interface TurnLogStart {
  surface: AiSurface;
  /** The thread the turn continues. */
  conversation: string;
  provider: string;
  model: string;
}

interface OpenTurn {
  turn: string;
  begunAt: number;
  round: number;
  requestAt?: number;
  /** Waiting for the current round's first partial. */
  awaiting: boolean;
  /** The timestamp of the partial last heard, so a round's leftover partial is not heard again. */
  heardStamp?: number;
  stalled: boolean;
}

/** How a settled `rp.turn` reads in the log; no result is an abort, as the old loop's default. */
export function turnLogEnd(result: TurnResult | undefined, stalled: boolean): { reason: TurnEnd; error?: string } {
  if (stalled) return { reason: "stalled" };
  if (!result) return { reason: "aborted" };
  if (result.refusal !== undefined) return { reason: "refused", error: result.refusal };
  if (result.status === "done") return { reason: "done" };
  if (result.reason === "aborted") return { reason: "aborted" };
  return { reason: "error", error: result.detail ?? result.reason ?? "the turn ended without an answer" };
}

export class BookTurnLog {
  private readonly open = new Map<string, OpenTurn>();
  /** Threads a turn began on in this process. */
  private readonly begun = new Set<string>();

  constructor(
    private readonly sink: TurnLogSink,
    private readonly now: () => number = Date.now,
  ) {}

  private note(entry: OpenTurn, event: TurnLogEvent): void {
    this.sink({ at: this.now(), turn: entry.turn, ...event });
  }

  /** A turn begins on `key`; a turn already open there is kept. */
  begin(key: string, start: TurnLogStart): void {
    if (this.open.has(key)) return;
    this.begun.add(key);
    const entry: OpenTurn = { turn: newRunId(), begunAt: this.now(), round: 0, awaiting: false, stalled: false };
    this.open.set(key, entry);
    this.note(entry, { event: "start", ...start, held: false });
  }

  /** A request goes out; a turn not begun here begins with it. */
  request(key: string, round: number, start: TurnLogStart): void {
    this.begin(key, start);
    const entry = this.open.get(key)!;
    entry.round = round;
    entry.requestAt = this.now();
    entry.awaiting = true;
  }

  /** A partial of the answer is on the view; `stamp` is its message's timestamp. */
  heard(key: string, stamp: number): void {
    const entry = this.open.get(key);
    if (!entry?.awaiting || entry.requestAt === undefined || stamp === entry.heardStamp) return;
    entry.awaiting = false;
    entry.heardStamp = stamp;
    this.note(entry, { event: "first-byte", round: entry.round, ms: this.now() - entry.requestAt });
  }

  /** An answer came back. */
  response(key: string, round: number, stop: string): void {
    const entry = this.open.get(key);
    if (!entry || entry.requestAt === undefined) return;
    entry.awaiting = false;
    this.note(entry, { event: "round", round, stop, ms: this.now() - entry.requestAt });
  }

  /** The stall watch cut the turn: it ends stalled whatever it settles with. */
  stalled(key: string): void {
    const entry = this.open.get(key);
    if (entry) entry.stalled = true;
  }

  /** The turn settled; the first of the two reports writes the line. */
  end(key: string, result: TurnResult | undefined): void {
    const entry = this.open.get(key);
    if (!entry) return;
    this.open.delete(key);
    const { reason, error } = turnLogEnd(result, entry.stalled);
    this.note(entry, { event: "end", reason, ms: this.now() - entry.begunAt, ...(error !== undefined ? { error } : {}) });
  }

  /**
   * A turn settled on a thread no turn began on in this process: one the last
   * process was killed in, settled by recovery. Its start line is the dead
   * process's, so the end names the conversation to pair with it.
   */
  endUnbegun(key: string, result: TurnResult | undefined, conversation: string, startedAt: number): void {
    if (this.begun.has(key)) return;
    this.begun.add(key);
    const { reason, error } = turnLogEnd(result, false);
    this.sink({
      at: this.now(),
      turn: newRunId(),
      event: "end",
      reason,
      ms: this.now() - startedAt,
      conversation,
      ...(error !== undefined ? { error } : {}),
    });
  }
}
