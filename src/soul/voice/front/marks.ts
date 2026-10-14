// Timing marks for every front turn (docs/companion/136 一期: the iPad run lines
// these up against the native RP-CALL log). One monotonic clock, milliseconds;
// each mark is written once per turn, the first time it happens.

export type FrontMarkName =
  | "speech-end"
  | "request-sent"
  | "first-byte"
  | "first-sentence-to-tts"
  | "delegate-sent";

export interface FrontTurnMarks {
  turn: number;
  /** Absent on a program turn (a notice or a read-out). */
  program?: "notify" | "read-out";
  marks: Partial<Record<FrontMarkName, number>>;
}

export type MarkSink = (entry: FrontTurnMarks) => void;

/** performance.now where there is one: it does not jump with the wall clock. */
export function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Number(process.hrtime.bigint() / 1_000_000n);
}

export interface FrontMarks {
  mark(turn: number, name: FrontMarkName): void;
  /** The turn is over; its marks go to the sink. */
  flush(turn: number, program?: FrontTurnMarks["program"]): void;
}

export function frontMarks(sink: MarkSink, now: () => number = monotonicNow): FrontMarks {
  const open = new Map<number, FrontTurnMarks["marks"]>();
  return {
    mark(turn, name) {
      const marks = open.get(turn) ?? {};
      if (marks[name] === undefined) marks[name] = now();
      open.set(turn, marks);
    },
    flush(turn, program) {
      const marks = open.get(turn);
      if (!marks) return;
      open.delete(turn);
      sink({ turn, ...(program ? { program } : {}), marks });
    },
  };
}

/** The console line the device log is grepped for, next to RP-CALL. */
export function logMarks(entry: FrontTurnMarks): void {
  console.info(`RP-FRONT ${JSON.stringify(entry)}`);
}
