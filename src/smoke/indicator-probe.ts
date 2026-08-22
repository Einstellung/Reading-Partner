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

/// The three answers to "where was the probe when the finger went down" that
/// leave the microphone free. Every hold now carries one of them
/// (DictationTiming.probeStage): `off` is a probe that was put back, `never` a
/// process nothing has probed in, `unread` a press that never reached the
/// microphone. Anything else is a stage, and a stage is parked.
const CLEAR: readonly string[] = ["off", "never", "unread"];

/// Whether a probe was holding the microphone when the press arrived, which is
/// the press the plugin refuses. It refuses rather than taking the microphone
/// back because taking it back is invisible: the teardown gets charged to the
/// press that follows, whose `session` step then comes back five to ten times
/// its usual size with nothing in the record to say why — one round of
/// twenty-one holds was lost to exactly that (docs/pitfall/168).
export function probeHoldsTheMicrophone(at: string | undefined | null): boolean {
  return typeof at === "string" && at.length > 0 && !CLEAR.includes(at);
}

/// The sentence a person reads, in one place: the strip above the bar says it
/// while a probe is parked, and a refused row says it afterwards.
export function probeRefusalNote(at: string): string {
  const label = INDICATOR_STAGE_OPTIONS.find((o) => o.value === at)?.label ?? at;
  return `The probe is parked on ${label}. Holds are refused until it is back on Off.`;
}

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
