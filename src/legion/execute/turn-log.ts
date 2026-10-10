// What each turn did, one line per moment, kept on the device that ran it.
//
// A turn that never ends shows the reader one word, "Thinking", and leaves
// nothing behind to say where it stopped: queued behind another turn, waiting
// on a provider that never answered, inside a tool that never returned. This
// is the record that tells them apart, written as it happens so a process that
// is killed mid-turn still leaves the lines before it.
//
// Local and append-only (palace kind "turn-log", sync "local"): nothing leaves
// the device, nothing in the app reads it back to decide anything, and the
// housekeeper keeps its tail. `readTurnLog` is what an export reads.

import { appData } from "../../platform/app/appdata";
import type { AiSurface } from "../../platform/app/cache-telemetry";

/** The file, under the app data dir. */
export const TURN_LOG = "turn-log.jsonl";

/** How a turn ended. */
export type TurnEnd =
  | "done"
  // The reader's Stop, leaving the page, or an abort the stream reported itself.
  | "aborted"
  // The stream went silent (stall.ts).
  | "stalled"
  // The turn's whole allowance ran out (stall.ts, TURN_LIMIT_MS).
  | "timed-out"
  // A refusal: the window or the round cap (contract.ts).
  | "refused"
  | "error";

interface LineHead {
  /** Wall-clock ms. */
  at: number;
  /** One id per turn, shared by all of its lines. */
  turn: string;
}

export type TurnLogLine = LineHead & TurnLogEvent;

/** One moment of a turn, before the log stamps it. */
export type TurnLogEvent =
  (
    | {
        event: "start";
        surface?: AiSurface;
        /** The conversation the turn continues: which lane it queues on. */
        conversation?: string;
        provider: string;
        model: string;
        /** On a held lane (the soul's) rather than a session of its own. */
        held: boolean;
      }
    // Another turn of the same conversation holds the lane.
    | { event: "queued" }
    // The lane is this turn's; `waitMs` since start.
    | { event: "lane"; waitMs: number }
    // The first event of a round's stream; `ms` since its request went out.
    | { event: "first-byte"; round: number; ms: number }
    // A round's answer came back; `ms` since its request went out.
    | { event: "round"; round: number; stop: string; ms: number }
    // `ms` since start. `conversation` only on the end of a turn a killed process
    // began: its start line is under another turn id.
    | { event: "end"; reason: TurnEnd; ms: number; error?: string; conversation?: string }
  );

export type TurnLogSink = (line: TurnLogLine) => void;

/**
 * The app's sink. `appendText` is a true append, so two turns writing at once
 * both land (docs/pitfall/338 is the read-modify-write kind, which this is not).
 * A line that fails to land is dropped: the turn it describes goes on.
 */
export const appTurnLog: TurnLogSink = (line) => {
  void appData.appendText(TURN_LOG, `${JSON.stringify(line)}\n`).catch(() => {});
};

/** The log as it stands; empty when no turn has written one yet. */
export async function readTurnLog(): Promise<string> {
  if (!(await appData.exists(TURN_LOG))) return "";
  return appData.readText(TURN_LOG);
}
