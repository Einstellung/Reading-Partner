// The push-to-talk gesture as a pure state machine (docs/15). The mic button
// used to carry this as five mutable refs poked from six places, with the race
// rules written only in comments; they are transitions here, and tested.
//
// The races this exists to pin down:
//   1. A release during arming (recording asked for, not running yet) must let
//      the recording start and then immediately cancel it — see `aborting`.
//   2. A missing STT key is reported even when the press was already released,
//      so a quick tap still points at Settings. `beginPress` loads the config
//      before it looks at the release, and `aborting` still emits the hint.
//   3. Leaving the button arms cancel only while actually recording; during
//      arming a leave means nothing.
//   4. Unmounting mid-recording cancels exactly once.
//
// The component keeps pointer binding, the elapsed-seconds timer and JSX.

export type PressStatus =
  | "idle"
  // pressed; config load / recorder start in flight.
  | "arming"
  // released (or gone) while still arming: tear down whatever arming produces.
  | "aborting"
  | "recording"
  | "transcribing";

export interface PressState {
  status: PressStatus;
  cancelArmed: boolean;
}

export const INITIAL_PRESS_STATE: PressState = { status: "idle", cancelArmed: false };

export type PressEvent =
  | { type: "down" }
  | { type: "up" }
  | { type: "leave" }
  | { type: "enter" }
  | { type: "escape" }
  // the recorder is running.
  | { type: "started" }
  // the press or the pipeline gave up; `message` is the hint to show, or null
  // for a silent give-up.
  | { type: "failed"; message: string | null }
  | { type: "transcribed"; text: string }
  | { type: "unmount" };

export type PressEffect =
  // start the pipeline: load the STT config, then the recorder.
  | { type: "begin" }
  | { type: "cancel" }
  // stop the recorder and run STT + cleanup.
  | { type: "transcribe" }
  | { type: "insert"; text: string }
  | { type: "hint"; message: string | null };

export interface PressResult extends PressState {
  effects: PressEffect[];
}

export const NEEDS_KEY_HINT = "Add a voice input STT key in Settings to use the mic.";
export const NO_SPEECH_HINT = "No speech detected.";

function next(status: PressStatus, cancelArmed: boolean, effects: PressEffect[] = []): PressResult {
  return { status, cancelArmed, effects };
}

function stay(state: PressState): PressResult {
  return { status: state.status, cancelArmed: state.cancelArmed, effects: [] };
}

// A failure anywhere in the press reports its hint and returns to idle — including
// from `aborting`, which is what keeps a keyless quick tap from failing silently.
function failed(message: string | null): PressResult {
  return next("idle", false, message === null ? [] : [{ type: "hint", message }]);
}

export function pressReducer(state: PressState, event: PressEvent): PressResult {
  if (event.type === "unmount") {
    // Only a live recording owns something the app must release.
    if (state.status === "recording") return next("idle", false, [{ type: "cancel" }]);
    // Still arming: stay in aborting so the recording that is about to start
    // gets cancelled when it does.
    if (state.status === "arming" || state.status === "aborting") return next("aborting", false);
    return next("idle", false);
  }

  switch (state.status) {
    case "idle":
      if (event.type === "down") {
        return next("arming", false, [{ type: "hint", message: null }, { type: "begin" }]);
      }
      return stay(state);

    case "arming":
      switch (event.type) {
        // Released before the recorder came up; the cancel waits for `started`.
        case "up":
        case "escape":
          return next("aborting", false);
        // Whatever arming decided about cancel carries over — nothing here sets
        // it, because a leave arms cancel only while recording.
        case "started":
          return next("recording", state.cancelArmed);
        case "failed":
          return failed(event.message);
        default:
          return stay(state);
      }

    case "aborting":
      switch (event.type) {
        case "started":
          return next("idle", false, [{ type: "cancel" }]);
        case "failed":
          return failed(event.message);
        default:
          return stay(state);
      }

    case "recording":
      switch (event.type) {
        case "up":
          return state.cancelArmed
            ? next("idle", false, [{ type: "cancel" }])
            : next("transcribing", false, [{ type: "transcribe" }]);
        case "escape":
          return next("idle", false, [{ type: "cancel" }]);
        case "leave":
          return next("recording", true);
        case "enter":
          return next("recording", false);
        default:
          return stay(state);
      }

    case "transcribing":
      switch (event.type) {
        case "transcribed": {
          const text = event.text.trim();
          return next("idle", false, [
            text ? { type: "insert", text } : { type: "hint", message: NO_SPEECH_HINT },
          ]);
        }
        case "failed":
          return failed(event.message);
        default:
          return stay(state);
      }
  }
}

// The arming half of a press, split out because rule 2 lives in its ordering:
// the config load and its missing-key report come before the released check, so
// a tap too quick to record still says where the key goes. `aborted` reads the
// machine's current status.
export interface BeginPressDeps<C> {
  loadConfig(): Promise<C | null>;
  aborted(): boolean;
  startRecording(): Promise<void>;
}

export type BeginOutcome<C> =
  | { type: "started"; config: C }
  | { type: "failed"; message: string | null };

export async function beginPress<C>(deps: BeginPressDeps<C>): Promise<BeginOutcome<C>> {
  let config: C | null;
  try {
    config = await deps.loadConfig();
  } catch (e) {
    return { type: "failed", message: errMsg(e) };
  }
  if (!config) return { type: "failed", message: NEEDS_KEY_HINT };
  // Released during the load: give up without a hint, nothing was started.
  if (deps.aborted()) return { type: "failed", message: null };
  try {
    await deps.startRecording();
  } catch (e) {
    return { type: "failed", message: errMsg(e) };
  }
  return { type: "started", config };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
