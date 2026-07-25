import { expect, test } from "bun:test";
import { probeVoiceCapabilities } from "./voice-probe";

// The probe rides along in the iOS smoke gate, so the property that matters off
// the device is that it cannot throw, whatever the host lacks or misbehaves at.

test("returns a full shape outside a browser instead of throwing", () => {
  const caps = probeVoiceCapabilities();
  expect(caps.hasMediaDevices).toBe(false);
  expect(caps.hasMediaRecorder).toBe(false);
  expect(caps.mediaRecorderTypes).toEqual({});
  expect(caps.hasAudioContext).toBe(false);
  expect(caps.audioContextState).toBeNull();
  expect(typeof caps.isSecureContext).toBe("boolean");
});

test("survives globals whose getters throw", () => {
  const hostile = {
    get: () => {
      throw new Error("nope");
    },
    configurable: true,
  };
  const names = ["MediaRecorder", "AudioContext", "speechSynthesis", "isSecureContext"];
  for (const n of names) Object.defineProperty(globalThis, n, hostile);
  try {
    const caps = probeVoiceCapabilities();
    expect(caps.hasMediaRecorder).toBe(false);
    expect(caps.hasSpeechSynthesis).toBe(false);
    expect(caps.isSecureContext).toBe(false);
    expect(caps.speechVoices).toBeNull();
  } finally {
    for (const n of names) delete (globalThis as Record<string, unknown>)[n];
  }
});
