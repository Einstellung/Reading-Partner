import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as os from "@tauri-apps/plugin-os";
import { hasNativeSpeech, hasOnDeviceDictation } from "../../../src/platform/app/platform";
import {
  VOICE_CAPABILITY_COMMAND,
  androidVoiceCapable,
  loadVoiceCapability,
  resetVoiceCapability,
  subscribeVoiceCapability,
  voiceCallCapable,
} from "../../../src/platform/app/voice-capability";

// A spy on the namespace, not a module swap (docs/pitfall/119); the preload
// restores it between cases, so it goes up in beforeEach (docs/pitfall/171).
let host: string = "android";

beforeEach(() => {
  resetVoiceCapability();
  host = "android";
  spyOn(os, "platform").mockImplementation((() => {
    if (host === "throws") throw new Error("not under Tauri");
    return host;
  }) as typeof os.platform);
});

afterEach(() => resetVoiceCapability());

function asking(answer: () => Promise<unknown>) {
  const calls: string[] = [];
  const call = (async (command: string) => {
    calls.push(command);
    return answer();
  }) as <T>(command: string) => Promise<T>;
  return { calls, call };
}

test("iOS can always call, without asking the plugin", async () => {
  host = "ios";
  const { calls, call } = asking(async () => ({ call: false }));
  await loadVoiceCapability(call);
  expect(calls).toEqual([]);
  expect(voiceCallCapable()).toBe(true);
  expect(hasNativeSpeech()).toBe(true);
});

test("desktop and a plain browser can never call", async () => {
  for (const h of ["linux", "macos", "windows", "throws"]) {
    host = h;
    const { calls, call } = asking(async () => ({ call: true }));
    await loadVoiceCapability(call);
    expect(calls).toEqual([]);
    expect(voiceCallCapable()).toBe(false);
    expect(hasNativeSpeech()).toBe(false);
  }
});

test("Android is false until the command answers, then follows the answer", async () => {
  const { calls, call } = asking(async () => ({ call: true }));
  expect(hasNativeSpeech()).toBe(false);
  const loading = loadVoiceCapability(call);
  expect(hasNativeSpeech()).toBe(false);
  await loading;
  expect(calls).toEqual([VOICE_CAPABILITY_COMMAND]);
  expect(hasNativeSpeech()).toBe(true);
});

test("Android with a device that says no stays false", async () => {
  await loadVoiceCapability(asking(async () => ({ call: false })).call);
  expect(androidVoiceCapable()).toBe(false);
  expect(hasNativeSpeech()).toBe(false);
});

test("a failing command, or an answer of the wrong shape, is false", async () => {
  await loadVoiceCapability(asking(async () => Promise.reject(new Error("not allowed"))).call);
  expect(hasNativeSpeech()).toBe(false);

  resetVoiceCapability();
  await loadVoiceCapability(asking(async () => null).call);
  expect(hasNativeSpeech()).toBe(false);

  resetVoiceCapability();
  await loadVoiceCapability(asking(async () => ({ call: "yes" })).call);
  expect(hasNativeSpeech()).toBe(false);
});

test("subscribers hear a late answer, once, and only when it changes things", async () => {
  let release!: (v: unknown) => void;
  const { call } = asking(() => new Promise((r) => (release = r)));
  let heard = 0;
  const unsubscribe = subscribeVoiceCapability(() => heard++);
  const loading = loadVoiceCapability(call);
  expect(heard).toBe(0);
  release({ call: true });
  await loading;
  expect(heard).toBe(1);
  expect(hasNativeSpeech()).toBe(true);

  unsubscribe();
  resetVoiceCapability();
  const quiet = subscribeVoiceCapability(() => heard++);
  await loadVoiceCapability(asking(async () => ({ call: false })).call);
  expect(heard).toBe(1);
  quiet();
});

test("an unsubscribed listener is not called", async () => {
  let heard = 0;
  subscribeVoiceCapability(() => heard++)();
  await loadVoiceCapability(asking(async () => ({ call: true })).call);
  expect(heard).toBe(0);
});

test("the command is asked once", async () => {
  const { calls, call } = asking(async () => ({ call: true }));
  await loadVoiceCapability(call);
  await loadVoiceCapability(call);
  expect(calls).toHaveLength(1);
});

test("Android still has no on-device dictation", async () => {
  await loadVoiceCapability(asking(async () => ({ call: true })).call);
  expect(hasOnDeviceDictation()).toBe(false);
});
