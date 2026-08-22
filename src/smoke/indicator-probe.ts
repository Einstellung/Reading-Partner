// The orange microphone indicator, asked one step at a time.
//
// Apple documents what the indicator means and never what turns it on, so the
// only way to know which part of opening a microphone lights it is to stop at
// each part and look at the status bar. The plugin can park the audio stack at
// four places and stay there — session active, engine running, tap installed,
// buffers read — and this is the webview's side of that: five buttons, one
// answer each, and a person holding the phone.
//
// Nothing here transcribes and nothing keeps audio. The recording stage reads
// each buffer's samples and drops them, which is the only way it differs from
// the tap stage; what comes back is counts, flags and a level.
//
// The answer is an observation about one iOS version, not a contract. Whatever
// it says, a later release may light the indicator a step earlier without
// telling anybody, so this measures rather than establishes.

import { invoke } from "@tauri-apps/api/core";

export const INDICATOR_STAGES = ["off", "session", "engine", "tap", "recording"] as const;

export type IndicatorStage = (typeof INDICATOR_STAGES)[number];

export interface IndicatorStageOption {
  value: IndicatorStage;
  label: string;
  note: string;
}

export const INDICATOR_STAGE_OPTIONS: readonly IndicatorStageOption[] = [
  { value: "off", label: "Off", note: "nothing held — the session is deactivated" },
  { value: "session", label: "Session", note: "the audio session is active, and nothing else" },
  { value: "engine", label: "Engine", note: "the engine is running with no tap on it" },
  { value: "tap", label: "Tap", note: "a tap is installed and every buffer is dropped" },
  { value: "recording", label: "Recording", note: "the buffers are read, then dropped" },
];

/// What the native side answers with: where it stopped, and enough state to
/// show it stopped there. `buffers` is the one that separates a tap that exists
/// from a tap that is being called.
export interface IndicatorProbeState {
  stage: IndicatorStage;
  sessionActive: boolean;
  engineRunning: boolean;
  tapInstalled: boolean;
  buffers: number;
  level: number;
  inputs: string;
}

/// A probe and a run of holds cannot be interleaved, and the plugin refuses the
/// first hold after any probe call. The reason it is any call and not "while one
/// is parked": every one of them, `off` included, tears the whole audio stack
/// down on its way in. Pressing Off is therefore itself what destroys the engine
/// a reusing profile was keeping, and a hold served after it would report a cold
/// build with nothing standing where the third hold of a warm run should be
/// (docs/pitfall/168).
///
/// So the refusal is read off the plugin's own flag, never off the stage.
/// `probeStage` is in the signature and deliberately not read: it is there so
/// that anyone reaching for it finds this comment instead.
export function probeRefusedTheHold(
  timing: { probeStage?: string; probeTouched?: boolean } | null | undefined,
): boolean {
  return timing?.probeTouched === true;
}

/// What the person is told, in the one place the strip above the bar and the
/// refused row both read it from. It does not say "put it back on Off", which is
/// the action that does the damage; it says the run is over.
export const PROBE_ENDS_THE_RUN =
  "The probe has had the audio stack. The next hold is refused and puts it back to nothing — " +
  "the holds before it are not a run any more. Start the run over after that.";

/// The same fact, sized for a row in the list.
export const PROBE_REFUSED_THE_HOLD =
  "refused — the probe had been in the audio stack since the last hold, and this press put it " +
  "back to nothing; the holds before it are not a run";

/// The command string and the argument key, which no compiler compares against
/// the Swift selector and the Rust command name they have to match.
export const INDICATOR_PROBE_COMMAND = "plugin:voice|set_indicator_probe";

export type ProbeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function createIndicatorProbe(
  call: ProbeInvoke,
): (stage: IndicatorStage) => Promise<IndicatorProbeState> {
  return (stage) => call<IndicatorProbeState>(INDICATOR_PROBE_COMMAND, { stage });
}

export const setIndicatorProbe = createIndicatorProbe((command, args) => invoke(command, args));
