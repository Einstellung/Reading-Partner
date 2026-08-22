// Which audio front end a hold opens the microphone on.
//
// Press to first audio buffer is 1090-1315 ms on an iPhone 16 running iOS 26.6,
// and the recogniser is not what is slow: the voice-processing IO unit is
// rebuilt and restarted on every single press, including the fifth one in a
// row. Not opening it at all took 300-450 ms back when the four settings were
// held on 2026-08-22 — 790-870 ms from press to first buffer — which is the size
// of what there is to win. Two things could win it, and they are independent:
// keeping the engine between presses instead of rebuilding it, and asking the
// session for echo cancellation without the voice-processing unit at all. So
// there are four settings and one build can be held five times on each.
//
// This is a measurement knob, not a preference. `current` is what the app did
// before any of this existed and is what every caller that says nothing gets;
// the native side treats an unknown name the same way. Nothing outside the bench
// changes it, and nothing persists it — a relaunch is back on the baseline,
// which is the right default for a knob whose winner has not been chosen yet.

export const AUDIO_PROFILES = [
  "current",
  "reuse",
  "echoCancelledInput",
  "reuseEchoCancelledInput",
] as const;

export type AudioProfile = (typeof AUDIO_PROFILES)[number];

export const DEFAULT_AUDIO_PROFILE: AudioProfile = "current";

/// Label for a segmented control, note for the line under it. Both are short
/// because they are read on a phone, one-handed, between holds.
export interface AudioProfileOption {
  value: AudioProfile;
  label: string;
  note: string;
}

export const AUDIO_PROFILE_OPTIONS: readonly AudioProfileOption[] = [
  {
    value: "current",
    label: "Current",
    note: "voice processing, rebuilt every press — the baseline",
  },
  {
    value: "reuse",
    label: "Reuse",
    note: "voice processing, engine paused between presses instead of stopped",
  },
  {
    value: "echoCancelledInput",
    label: "AEC input",
    note: "echo-cancelled input instead of voice processing, rebuilt every press",
  },
  {
    value: "reuseEchoCancelledInput",
    label: "Both",
    note: "echo-cancelled input, engine kept between presses",
  },
];

export function isAudioProfile(value: unknown): value is AudioProfile {
  return typeof value === "string" && (AUDIO_PROFILES as readonly string[]).includes(value);
}

// The bench sets it, `nativeDictation()` reads it at the moment a hold begins.
// A module-level value rather than a prop because the bench drives the shipped
// Composer without modifying it, and the Composer builds its own source: a prop
// would be production surface that exists for one screen. Read per press, so a
// switch applies to the next hold with no remount.
let chosen: AudioProfile = DEFAULT_AUDIO_PROFILE;

export function chooseAudioProfile(next: AudioProfile): void {
  chosen = next;
}

export function chosenAudioProfile(): AudioProfile {
  return chosen;
}
