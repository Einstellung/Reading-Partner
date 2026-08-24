// The wire contract with src-tauri/src/voice.rs: seven command strings, one
// argument key, and the number-array-to-Uint8Array conversion. Nothing else
// compares these strings to the Rust command names, and a typo is a desktop
// build to find out.
//
// Spies rather than mock.module, which rewrites the registry for every file
// loaded afterwards and does not roll back (docs/pitfall/119).
//
// Run: bun test tests/ai/voice/recorder.test.ts

import { beforeEach, expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import {
  cancelRecording,
  cancelSession,
  cutSession,
  startRecording,
  startSession,
  stopRecording,
  stopSession,
} from "../../../src/ai/voice/recorder";

interface Call {
  command: string;
  args?: Record<string, unknown>;
}

let calls: Call[] = [];
let answer: unknown = null;

beforeEach(() => {
  calls = [];
  answer = null;
  spyOn(core, "invoke").mockImplementation((async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return answer;
  }) as typeof core.invoke);
});

test("push-to-talk invokes the recording commands", async () => {
  await startRecording();
  await cancelRecording();
  expect(calls.map((c) => c.command)).toEqual(["start_voice_recording", "cancel_voice_recording"]);
});

test("stopRecording wraps the byte array Tauri sends back", async () => {
  answer = [82, 73, 70, 70];
  const bytes = await stopRecording();
  expect(calls[0]?.command).toBe("stop_voice_recording");
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(Array.from(bytes)).toEqual([82, 73, 70, 70]);
});

test("startSession passes the fallback cut interval through", async () => {
  await startSession({ maxSegmentSeconds: 30 });
  expect(calls[0]).toEqual({
    command: "start_voice_session",
    args: { maxSegmentSeconds: 30 },
  });
});

test("startSession with no options leaves the interval to Rust", async () => {
  await startSession();
  expect(calls[0]?.command).toBe("start_voice_session");
  expect(calls[0]?.args).toEqual({ maxSegmentSeconds: undefined });
});

test("cutSession and stopSession both come back as bytes", async () => {
  answer = [1, 2, 3];
  expect(Array.from(await cutSession())).toEqual([1, 2, 3]);
  answer = [];
  const tail = await stopSession();
  expect(tail).toBeInstanceOf(Uint8Array);
  expect(tail.length).toBe(0);
  await cancelSession();
  expect(calls.map((c) => c.command)).toEqual([
    "cut_voice_session",
    "stop_voice_session",
    "cancel_voice_session",
  ]);
});
