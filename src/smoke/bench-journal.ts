// The bench's durable record (dictation-bench.tsx). Every hold that lands on
// screen also lands in a file, one appended line at a time.
//
// Why a file at all: the rows are the measurement, and rows held in React state
// are gone the moment the app is. A bench is held on a phone for twenty minutes
// of trying things; somewhere in there is a backgrounded process, a reload, or
// the fault being hunted taking the page down with it — and the run that dies is
// the run worth reading. The same lesson as the long harness (docs/pitfall/165):
// a probe's persistence has to survive the failure it was built to observe.
//
// Appended rather than rewritten, for the reason stated there: an append that
// has returned from the IPC is already in the file, while a whole-document
// rewrite has a window in which the file is neither state. One JSON object per
// line, so a truncated tail costs the last line and nothing before it.
//
// It carries more than the screen does. The row says what happened; the line
// says when, in what order, in which language, and what the plugin streamed
// while the finger was down — which is what it takes to line the file up
// afterwards against a console log, a syslog, or someone's memory of what they
// said. The index and the session line are what keep that readable across
// relaunches: the file outlives the process, the numbering does not.

import { mkdir, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { HoldOutcome, Heard } from "./hold-outcome";

export const BENCH_JOURNAL_DIR = "smoke";
/// One JSON object per line, appended, never rewritten. Pulled off the device
/// from the app container, same place as the long harness's journal.
export const BENCH_JOURNAL_FILE = "smoke/dictation-bench.jsonl";

/// The five a hold can end in, plus the one that is not a hold at all.
export type BenchOutcome = HoldOutcome | "typed";

/// A row as the bench made it, before it becomes a line.
export interface BenchEntry {
  /// The row's number on screen. Restarts at 1 with the process, which is why
  /// every session opens with a line of its own.
  index: number;
  outcome: BenchOutcome;
  text: string;
  /// What the plugin streamed during the hold; null for a typed line, which had
  /// no hold.
  heard: Heard | null;
  locale: string;
}

/// A wall clock on every line, so a gap in the file reads as a gap rather than
/// as an absence. `at` is the same instant spelled out, because the file is read
/// by a person next to a phone, not only by a parser.
function stamp(wall: number): { wall: number; at: string } {
  return { wall, at: new Date(wall).toISOString() };
}

/** The line that opens a session: everything after it belongs to one process. */
export function benchSessionLine(wall: number): string {
  return JSON.stringify({ kind: "session", ...stamp(wall) }) + "\n";
}

/** One hold, as it goes into the file. */
export function benchHoldLine(entry: BenchEntry, wall: number): string {
  return (
    JSON.stringify({
      kind: "hold",
      ...stamp(wall),
      index: entry.index,
      outcome: entry.outcome,
      locale: entry.locale,
      // Both, deliberately: the count is what a scan of the file is read for,
      // the text is what a disagreement about a transcript is settled with.
      chars: entry.text.length,
      text: entry.text,
      heard: entry.heard,
    }) + "\n"
  );
}

export interface BenchJournal {
  /** Open the file for this process. */
  session(): void;
  /** Put one row in the file. Returns immediately; the write is queued. */
  hold(entry: BenchEntry): void;
  /** Resolves when everything handed over so far has been written. Tests. */
  idle(): Promise<void>;
}

/**
 * Serialise the writes. The rows arrive from pointer handlers and a send
 * callback, which do not wait for each other, and two appends in flight at once
 * are two IPC calls racing for the end of the same file. Chaining them keeps the
 * file in the order the holds happened, which is most of what it is for.
 *
 * A write that fails is dropped rather than raised: the bench is a person
 * holding a phone, and a file that cannot be written is not a reason to
 * interrupt them or to take the next hold down with it. The clock is read when
 * the row is made, not when it reaches the disk, so a queue that falls behind
 * still timestamps truthfully.
 */
export function createBenchJournal(
  append: (line: string) => Promise<void>,
  now: () => number = Date.now,
): BenchJournal {
  let tail: Promise<void> = Promise.resolve();
  const queue = (line: string) => {
    tail = tail.then(() => append(line)).catch(() => {});
  };
  return {
    session: () => queue(benchSessionLine(now())),
    hold: (entry) => queue(benchHoldLine(entry, now())),
    idle: () => tail,
  };
}

// The directory is asked for once per process. `recursive` makes an existing one
// a success, so this is a no-op after the first hold.
let directory: Promise<unknown> | null = null;

async function appendLine(line: string): Promise<void> {
  directory ??= mkdir(BENCH_JOURNAL_DIR, { baseDir: BaseDirectory.AppData, recursive: true }).catch(
    () => {
      // Let the write report the real problem; a mkdir that failed on an
      // existing directory did not fail.
    },
  );
  await directory;
  await writeTextFile(BENCH_JOURNAL_FILE, line, {
    baseDir: BaseDirectory.AppData,
    append: true,
  });
}

export const benchJournal = createBenchJournal(appendLine);
