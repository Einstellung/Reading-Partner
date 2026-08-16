// Hold-to-talk on a touch screen as a pure state machine (docs/15), the
// on-device dictation counterpart to press-machine.ts. Hold the bar and speak,
// slide to a landing zone and release: the transcript is sent, dropped, or put
// in the composer to edit.
//
// The races, the same ones the desktop press paid for, plus one this path has
// and that one does not:
//   1. A release before the recognizer is running must let it start and then
//      cancel it immediately — `arming` / `aborting`.
//   2. Finishing is asynchronous: stop() waits for the recognizer to flush what
//      it had not settled yet. `finishing` owns that wait, and no press,
//      release or slide restarts anything until it resolves.
//   3. Unmounting mid-listen cancels exactly once.
//   4. The flush can take an unknown time — seconds on a long hold. If it has
//      not come back by FINISH_TIMEOUT_MS, the text streamed so far is used and
//      the late answer is ignored (`idle` drops it).
//
// The component keeps pointer capture, the zone hit-test and JSX.

import {
  EMPTY_TRANSCRIPT,
  applyDictationEvent,
  transcriptText,
  type DictationEvent,
  type Transcript,
} from "./dictation";
import { NO_SPEECH_HINT } from "./press-machine";

// Where a release lands. The default is `send`, the finger where it went down;
// the other two are reached by sliding up-left and up-right.
export type Zone = "send" | "cancel" | "edit";

export type HoldStatus =
  | "idle"
  // pressed; the recognizer is starting.
  | "arming"
  // released (or gone) while still arming: cancel whatever arming produces.
  | "aborting"
  | "listening"
  // released; waiting for stop() to flush the last words.
  | "finishing";

export interface HoldState {
  status: HoldStatus;
  zone: Zone;
  // What has arrived over the event stream so far. It is not displayed while the
  // finger is down (docs/15); it is what the timeout path falls back to.
  transcript: Transcript;
  // Last input level 0..1, for the meter.
  level: number;
}

export const INITIAL_HOLD_STATE: HoldState = {
  status: "idle",
  zone: "send",
  transcript: EMPTY_TRANSCRIPT,
  level: 0,
};

export type HoldEvent =
  | { type: "down" }
  // the finger moved into a different landing zone.
  | { type: "zone"; zone: Zone }
  | { type: "up" }
  // the recognizer is running.
  | { type: "started" }
  | { type: "event"; event: DictationEvent }
  // stop() came back with the full transcript.
  | { type: "finished"; text: string }
  // the flush took too long; go with what streamed in.
  | { type: "timeout" }
  // `message` is the hint to show, or null to give up silently.
  | { type: "failed"; message: string | null }
  | { type: "unmount" };

export type HoldEffect =
  | { type: "start" }
  // stop the recognizer and collect the text.
  | { type: "stop" }
  | { type: "cancel" }
  // send the text as a message, with no review step.
  | { type: "send"; text: string }
  // put the text in the composer instead, for the user to fix first.
  | { type: "insert"; text: string }
  | { type: "hint"; message: string | null };

export interface HoldResult extends HoldState {
  effects: HoldEffect[];
}

// How long a release waits for the recognizer's flush before going with the text
// it already has. A guess pending a measurement on device: the flush is one
// finalization pass over audio already captured, seen at up to two seconds in
// the reports this was written against, and nothing in the API bounds it. Too
// short truncates the last words; too long is a bar that sits there saying
// "Finishing…" after the user is done. Measure a real device before moving it.
export const FINISH_TIMEOUT_MS = 2500;

// The same line the desktop press shows for the same outcome; both paths end in
// "you held the button and nothing came out".
export { NO_SPEECH_HINT };

function next(state: HoldState, patch: Partial<HoldState>, effects: HoldEffect[] = []): HoldResult {
  return { ...state, ...patch, effects };
}

function stay(state: HoldState): HoldResult {
  return { ...state, effects: [] };
}

// Back to rest, keeping nothing: a new hold starts its own transcript.
function done(effects: HoldEffect[] = []): HoldResult {
  return { ...INITIAL_HOLD_STATE, effects };
}

// Where a finished hold's text goes. `cancel` never gets here — it is handled at
// the release, before anything is asked for.
function deliver(zone: Zone, text: string): HoldResult {
  const trimmed = text.trim();
  if (!trimmed) return done([{ type: "hint", message: NO_SPEECH_HINT }]);
  return done([{ type: zone === "edit" ? "insert" : "send", text: trimmed }]);
}

export function holdReducer(state: HoldState, event: HoldEvent): HoldResult {
  if (event.type === "unmount") {
    // Only a live recognizer owns something the app must release.
    if (state.status === "listening") return done([{ type: "cancel" }]);
    // Still arming: stay in aborting so the run that is about to start gets
    // cancelled when it does.
    if (state.status === "arming" || state.status === "aborting") {
      return { ...INITIAL_HOLD_STATE, status: "aborting", effects: [] };
    }
    // Finishing: stop() is already on its way; a cancel on top of it would be a
    // second command against a recognizer that is shutting down anyway.
    return done();
  }

  switch (state.status) {
    case "idle":
      if (event.type === "down") {
        return next(
          INITIAL_HOLD_STATE,
          { status: "arming" },
          [{ type: "hint", message: null }, { type: "start" }],
        );
      }
      // A `finished` or `timeout` arriving here is the loser of race 4.
      return stay(state);

    case "arming":
      switch (event.type) {
        // Released before the recognizer came up; the cancel waits for `started`.
        case "up":
          return next(state, { status: "aborting" });
        case "started":
          return next(state, { status: "listening" });
        case "zone":
          // A slide during arming still counts — the finger is where it is.
          return next(state, { zone: event.zone });
        case "failed":
          return done(event.message === null ? [] : [{ type: "hint", message: event.message }]);
        default:
          return stay(state);
      }

    case "aborting":
      switch (event.type) {
        case "started":
          return done([{ type: "cancel" }]);
        case "failed":
          return done(event.message === null ? [] : [{ type: "hint", message: event.message }]);
        default:
          return stay(state);
      }

    case "listening":
      switch (event.type) {
        case "zone":
          return next(state, { zone: event.zone });
        case "event":
          return event.event.kind === "level"
            ? next(state, { level: event.event.value })
            : next(state, { transcript: applyDictationEvent(state.transcript, event.event) });
        case "up":
          // Cancel asks for nothing back; the other two wait for the flush.
          return state.zone === "cancel"
            ? done([{ type: "cancel" }])
            : next(state, { status: "finishing", level: 0 }, [{ type: "stop" }]);
        case "failed":
          return done(event.message === null ? [] : [{ type: "hint", message: event.message }]);
        default:
          return stay(state);
      }

    case "finishing":
      switch (event.type) {
        case "finished":
          // The recognizer's own answer wins; the streamed text stands in when it
          // comes back empty-handed.
          return deliver(state.zone, event.text.trim() || transcriptText(state.transcript));
        case "timeout":
          return deliver(state.zone, transcriptText(state.transcript));
        case "failed": {
          // Words already streamed are the user's; a failed flush does not make
          // them the machine's to throw away.
          const streamed = transcriptText(state.transcript);
          if (streamed) return deliver(state.zone, streamed);
          return done(event.message === null ? [] : [{ type: "hint", message: event.message }]);
        }
        // A press, a release or a slide during the flush does nothing: race 2.
        default:
          return stay(state);
      }
  }
}
