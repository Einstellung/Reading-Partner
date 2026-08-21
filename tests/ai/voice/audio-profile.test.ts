// src/ai/voice/audio-profile.ts: the measurement knob and its default.
//
// What matters here is that the default is the shipping path and that a caller
// who says nothing gets it. The whole point of the switch is to compare four
// settings against a baseline, and a baseline that had quietly become one of the
// other three would make every number meaningless without anything failing.
//
// Run: bun test tests/ai/voice/audio-profile.test.ts

import { afterEach, expect, test } from "bun:test";
import {
  AUDIO_PROFILES,
  AUDIO_PROFILE_OPTIONS,
  DEFAULT_AUDIO_PROFILE,
  chooseAudioProfile,
  chosenAudioProfile,
  isAudioProfile,
} from "../../../src/ai/voice/audio-profile";

afterEach(() => chooseAudioProfile(DEFAULT_AUDIO_PROFILE));

test("the default is the shipping path", () => {
  expect(DEFAULT_AUDIO_PROFILE).toBe("current");
  expect(chosenAudioProfile()).toBe("current");
});

test("a choice applies to whatever asks next", () => {
  chooseAudioProfile("reuseEchoCancelledInput");
  expect(chosenAudioProfile()).toBe("reuseEchoCancelledInput");
});

// The tag crosses to Swift as a bare string and is matched there against an enum
// with these exact spellings. Nothing compares the two, so the list is the
// contract.
test("the tags are the ones the native side knows", () => {
  expect([...AUDIO_PROFILES]).toEqual([
    "current",
    "reuse",
    "echoCancelledInput",
    "reuseEchoCancelledInput",
  ]);
  expect(AUDIO_PROFILE_OPTIONS.map((o) => o.value)).toEqual([...AUDIO_PROFILES]);
});

test("every setting has something for the person holding the phone to read", () => {
  for (const option of AUDIO_PROFILE_OPTIONS) {
    expect(option.label.length).toBeGreaterThan(0);
    expect(option.note.length).toBeGreaterThan(0);
  }
});

test("a tag from outside is checked rather than trusted", () => {
  expect(isAudioProfile("reuse")).toBe(true);
  expect(isAudioProfile("Reuse")).toBe(false);
  expect(isAudioProfile(undefined)).toBe(false);
  expect(isAudioProfile(2)).toBe(false);
});
