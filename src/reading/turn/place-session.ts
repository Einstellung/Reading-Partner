// One conversation's turns on the durable runtime, for a chat surface that is
// not a book (docs/soul/87, 第二阶段; docs/72): the door now, info, meals, the
// coach and the retell as they move over. The book's two surfaces do the same
// in React (session/use-call.ts, phone/lesson/use-lesson-call.ts); this is
// that logic without React, so it can be tested and shared.
//
// A turn starts from the reader's line already in the conversation file and
// draws its rows after that line as the runtime projects them. What the reader
// says while it runs goes into it as a steer; what no run took is filed when
// it ends and, after an answer or a stop, opens the next turn. A stop keeps the
// half sentence and the receipts (the runtime lands them). A stall cuts the
// turn, which lands nothing, and it is asked again once. A turn in flight when
// the conversation is opened — after a restart, the one recovery resumed — is
// followed the same way. Leaving stops the turn; its half sentence lands, and
// nothing more is drawn.
//
// A bell rung for the conversation while it is open runs here too
// (place-bell.ts): its turn streams in the open conversation, can be stopped
// and talked into, and what the reader said into it opens the next turn as
// after any answer. Only a stall ends a bell's turn differently: it is not
// asked again here, the bell stays queued.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { applyRowChange } from "../../ai/turn-view/turn-rows";
import { catalogDescribe, type DeviceDurable } from "../../legion/durable/device";
import type { AiSurface } from "../../platform/app/cache-telemetry";
import { afterStall, drivePlaceTurn, resumedPlaceRows, type BookTurnEnd, type DrivenBookTurn } from "./book-turn-rows";
import { mergeTurnRows, type CallRow } from "./call-state";
import type { PlaceTurnRequest, StallOptions } from "./durable-turn";

/** A turn assembled over the conversation as it stands. */
export type PlaceAssembled =
  | {
      kind: "turn";
      request: Omit<PlaceTurnRequest, "onView" | "describe" | "watches" | "stallMs">;
      /** What the turn had to leave out, shown under the answer and never filed. */
      notice?: string;
    }
  /** Not sent: the sentence stands in a failure row (no model set up, …). */
  | { kind: "failed"; message: string }
  /** Too big to leave the model room to answer. */
  | { kind: "refused"; message: string }
  /** Stopped while it was being assembled. */
  | { kind: "aborted" };

export interface PlaceSessionDeps {
  /** The device runtime, once started. */
  durable(): Promise<DeviceDurable> | undefined;
  /** The conversation's key in `rp.conversations`, to find a turn in flight. */
  key: string;
  surface: AiSurface;
  /** Assemble a turn; the reader's line is already in the conversation file. */
  assemble(signal: AbortSignal): Promise<PlaceAssembled>;
  /** The newest reader line's timestamp in the conversation file: the turn's rows come after it. */
  lastLine(): number;
  /** Replace the rows after `after` with these. */
  draw(after: number, rows: CallRow[]): void;
  /** Lines the reader said that no run took, into the conversation file at their own timestamps. */
  file(lines: readonly { text: string; ts: number }[]): void;
  streaming(on: boolean): void;
  stall?: StallOptions;
  now?: () => number;
}

export interface PlaceSession {
  /** A turn on the conversation as it stands. */
  ask(): void;
  /** The reader said `text` at `ts`: into the running turn. False when none is running. */
  say(text: string, ts: number): boolean;
  stop(): void;
  /** The surface is going away: the turn is stopped and nothing more is drawn. */
  leave(): void;
  /** Follow the turn in flight on the conversation, if there is one. */
  resume(): Promise<boolean>;
  running(): boolean;
  /**
   * Run a bell's turn here, its rows after `after`. Null when a turn is
   * running; rejects when the turn could not start (the runtime is busy).
   */
  bell(after: number, request: PlaceBellRequest): Promise<BookTurnEnd> | null;
  /** Resolves once no turn is running here. */
  idle(): Promise<void>;
}

/** A bell's turn, assembled; the line is the bell and carries no timestamp. */
export type PlaceBellRequest = Omit<PlaceTurnRequest, "onView" | "watches" | "stallMs">;

const openSessions = new Map<string, PlaceSession>();

/** A surface has the conversation `key` open in `session`. The returned function says it closed. */
export function registerOpenSession(key: string, session: PlaceSession): () => void {
  openSessions.set(key, session);
  return () => {
    if (openSessions.get(key) === session) openSessions.delete(key);
  };
}

/** The session a surface has open on the conversation `key`, if any. */
export function openPlaceSession(key: string): PlaceSession | undefined {
  return openSessions.get(key);
}

interface Live {
  after: number;
  placeholder: CallRow;
  controller: AbortController;
  rows: CallRow[];
  unsent: { text: string; ts: number }[];
  /** Steers on their way into the run: a stop waits for them, or it would read the inbox before they are in it (docs/pitfall/528). */
  steering: Promise<void>[];
  driven?: DrivenBookTurn;
  settled: boolean;
  gone: boolean;
  /** A bell's turn: who waits on its ending. */
  bell?: { resolve(end: BookTurnEnd): void; reject(e: unknown): void };
}

/** The rows after `after` replaced with a turn's, the rows `keep` names (cards raised during the turn) kept above them. */
export function withPlaceTurnRows<M extends CallRow>(
  messages: readonly M[],
  after: number,
  rows: readonly M[],
  keep: (m: M) => boolean = () => false,
): M[] {
  const before = messages.filter((m) => m.ts <= after);
  const turn = messages.filter((m) => m.ts > after);
  const kept = turn.filter((m) => keep(m) && !rows.some((r) => r.role === m.role && r.ts === m.ts));
  return [...before, ...kept, ...mergeTurnRows(turn, rows)];
}

/** A turn that ended without a reply leaves a row of its own under what it wrote. */
function failureRow(kind: "refusal" | "error", message: string, ts: number): CallRow {
  return applyRowChange<CallRow>(
    { role: "ai", text: "", ts },
    kind === "refusal" ? { kind: "refusal", text: message } : { kind: "error", text: `⚠️ Couldn't reach the model. ${message}` },
  );
}

export function createPlaceSession(deps: PlaceSessionDeps): PlaceSession {
  const now = deps.now ?? Date.now;
  let live: Live | null = null;
  const waiters = new Set<() => void>();
  const notifyIdle = () => {
    if (live) return;
    for (const wake of waiters) wake();
    waiters.clear();
  };

  const queued = (lines: Live["unsent"]): CallRow[] => lines.map((u) => ({ role: "user", text: u.text, ts: u.ts, queued: true }));
  const plain = (lines: Live["unsent"]): CallRow[] => lines.map((u) => ({ role: "user", text: u.text, ts: u.ts }));
  const drawLive = (turn: Live) => {
    const rows = turn.rows.length > 0 ? turn.rows : [turn.placeholder];
    const unsent = turn.unsent.filter((u) => !rows.some((r) => r.role === "user" && r.ts === u.ts));
    deps.draw(turn.after, [...rows, ...queued(unsent)]);
  };

  const steerIn = (turn: Live, line: { text: string; ts: number }) => {
    const going = turn.driven
      ?.steer(line.text, line.ts)
      .then((taken) => {
        if (taken) turn.unsent = turn.unsent.filter((u) => u.ts !== line.ts);
      })
      // A steer that would not go is not taken: it stays to be filed.
      .catch(() => {});
    if (going) turn.steering.push(going);
  };

  // The runtime's stop withdraws the steers already in the run's inbox; one
  // still being submitted would be taken after the run ended and lost.
  const stopDriven = (turn: Live) => {
    const driven = turn.driven;
    if (!driven) return;
    void Promise.all(turn.steering).then(() => driven.stop());
  };

  const finish = (turn: Live, attempt: number, notice: string | undefined, end: BookTurnEnd) => {
    turn.bell?.resolve(end);
    settle(turn, attempt, notice, end);
    notifyIdle();
  };

  const settle = (turn: Live, attempt: number, notice: string | undefined, end: BookTurnEnd) => {
    if (turn.settled) return;
    turn.settled = true;
    const withdrawn = end.kind === "stopped" || end.kind === "stalled" ? end.steers : [];
    const steers = withdrawn.map((steer) => ({ text: steer.text, ts: steer.ts ?? now() }));
    // Everything the reader said that no run took, in the order it was said.
    const owed = [...steers, ...turn.unsent.filter((u) => !steers.some((steer) => steer.ts === u.ts))].sort(
      (a, b) => a.ts - b.ts,
    );
    if (owed.length > 0) deps.file(owed);
    if (live === turn) live = null;
    if (turn.gone) return;
    deps.streaming(false);
    const lines = plain(owed);

    if (end.kind === "stalled" && turn.bell) {
      deps.draw(turn.after, lines);
      return;
    }
    if (end.kind === "stalled") {
      // Nothing landed; the half-written rows go and the question is asked
      // again once (docs/pitfall/390). A second stall is a failure.
      const next = afterStall(attempt);
      if (next.askAgain) {
        deps.draw(turn.after, lines);
        start(attempt + 1);
      } else {
        deps.draw(turn.after, [...lines, failureRow("error", next.message, turn.placeholder.ts)]);
      }
      return;
    }
    const rows = [...end.rows];
    const tail = lines.filter((line) => !rows.some((r) => r.role === "user" && r.ts === line.ts));
    if (end.kind === "answered") {
      const last = rows.map((r) => r.role).lastIndexOf("ai");
      if (notice && last >= 0) rows[last] = { ...rows[last]!, notice };
      deps.draw(turn.after, [...rows, ...tail]);
      // The model finished before a run took what the reader said: it opens the next turn.
      if (owed.length > 0) start(0);
      return;
    }
    // What a stopped or failed turn produced stays; a row that produced nothing is not a row.
    const kept = rows.filter((r) => r.role === "user" || r.text !== "" || (r.tools?.length ?? 0) > 0);
    if (end.kind === "stopped") {
      deps.draw(turn.after, [...kept, ...tail]);
      // Stopping cuts off the answer, not the reader (docs/72).
      if (owed.length > 0) start(0);
      return;
    }
    // A bell's turn that failed leaves no row: the bell stays queued.
    if (turn.bell) {
      deps.draw(turn.after, [...kept, ...tail]);
      return;
    }
    const at = Math.max(turn.placeholder.ts, ...kept.map((r) => r.ts + 1));
    // Retry and asking again are for the turn that failed: nothing is started on what was said into it.
    deps.draw(turn.after, [...kept, failureRow(end.kind === "refused" ? "refusal" : "error", end.message, at), ...tail]);
  };

  const open = (after: number): Live => {
    const turn: Live = {
      after,
      placeholder: { role: "ai", text: "", ts: Math.max(now(), after + 1), streaming: true },
      controller: new AbortController(),
      rows: [],
      unsent: [],
      steering: [],
      settled: false,
      gone: false,
    };
    live = turn;
    deps.streaming(true);
    drawLive(turn);
    return turn;
  };

  const follow = (
    turn: Live,
    attempt: number,
    notice: string | undefined,
    begin: (onRows: (rows: CallRow[]) => void) => Promise<DrivenBookTurn>,
  ) => {
    const onRows = (rows: CallRow[]) => {
      if (live !== turn) return;
      turn.rows = rows;
      drawLive(turn);
    };
    begin(onRows)
      .then(async (driven) => {
        turn.driven = driven;
        // Stopped, or the surface left, while the turn was starting.
        if (live !== turn) driven.stop();
        // Lines said while the turn was being assembled go in now.
        else for (const line of turn.unsent) steerIn(turn, line);
        finish(turn, attempt, notice, await driven.ended);
      })
      .catch((e: unknown) => {
        turn.bell?.reject(e);
        finish(turn, attempt, notice, { kind: "failed", rows: turn.rows, message: e instanceof Error ? e.message : String(e) });
      });
  };

  const start = (attempt: number) => {
    if (live) return;
    const turn = open(deps.lastLine());
    void (async () => {
      let assembled: PlaceAssembled;
      try {
        assembled = await deps.assemble(turn.controller.signal);
      } catch (e) {
        assembled = { kind: "failed", message: e instanceof Error ? e.message : String(e) };
      }
      // A stop while assembling has already put things right.
      if (turn.settled || turn.controller.signal.aborted) return;
      if (assembled.kind === "aborted") return;
      if (assembled.kind !== "turn") {
        finish(turn, attempt, undefined, { kind: assembled.kind, rows: [], message: assembled.message });
        return;
      }
      const durable = deps.durable();
      if (!durable) {
        finish(turn, attempt, undefined, { kind: "failed", rows: [], message: "the turn runtime has not started" });
        return;
      }
      const runtime = await durable;
      const request = { ...assembled.request, describe: catalogDescribe(assembled.request.tools), ...deps.stall };
      follow(turn, attempt, assembled.notice, (onRows) => drivePlaceTurn(runtime, request, onRows));
    })();
  };

  const session: PlaceSession = {
    ask: () => start(0),
    say(text, ts) {
      const turn = live;
      if (!turn) return false;
      const line = { text, ts };
      turn.unsent.push(line);
      drawLive(turn);
      steerIn(turn, line);
      return true;
    },
    stop() {
      const turn = live;
      if (!turn) return;
      if (turn.driven) {
        // The ending comes from the runtime: the half sentence and receipts land, and are drawn then.
        stopDriven(turn);
        return;
      }
      // Still being assembled: nothing was sent.
      turn.settled = true;
      turn.controller.abort();
      live = null;
      deps.streaming(false);
      if (turn.unsent.length > 0) deps.file(turn.unsent);
      deps.draw(turn.after, plain(turn.unsent));
      if (turn.unsent.length > 0) start(0);
      notifyIdle();
    },
    leave() {
      const turn = live;
      if (!turn) return;
      turn.gone = true;
      if (turn.driven) {
        stopDriven(turn);
        return;
      }
      turn.settled = true;
      turn.controller.abort();
      live = null;
      if (turn.unsent.length > 0) deps.file(turn.unsent);
      notifyIdle();
    },
    async resume() {
      if (live) return false;
      const durable = deps.durable();
      if (!durable) return false;
      const found = await resumedPlaceRows(await durable, deps.key, deps.surface, BACKGROUND_CONTEXT, deps.stall);
      if (!found || live) return false;
      const turn = open(found.after);
      follow(turn, 0, undefined, (onRows) => found.follow(onRows));
      return true;
    },
    running: () => live !== null,
    bell(after, request) {
      if (live) return null;
      const turn = open(after);
      const ended = new Promise<BookTurnEnd>((resolve, reject) => (turn.bell = { resolve, reject }));
      const durable = deps.durable();
      follow(turn, 0, undefined, async (onRows) => {
        if (!durable) throw new Error("the turn runtime has not started");
        return drivePlaceTurn(await durable, { ...request, ...deps.stall }, onRows);
      });
      return ended;
    },
    idle() {
      if (!live) return Promise.resolve();
      return new Promise((resolve) => waiters.add(resolve));
    },
  };
  return session;
}
