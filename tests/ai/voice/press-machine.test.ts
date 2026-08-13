// The push-to-talk gesture machine (src/ai/voice/press-machine.ts). These cover
// the four races that used to live only as comments in MicButton.tsx: a release
// during arming cancels the recording that arming started, a missing STT key is
// reported even after that release, leaving the button arms cancel only while
// recording, and an unmount mid-recording cancels once. Run: bun test.

import { test, expect } from "bun:test";
import {
  INITIAL_PRESS_STATE,
  NEEDS_KEY_HINT,
  NO_SPEECH_HINT,
  beginPress,
  pressReducer,
  type PressEffect,
  type PressEvent,
  type PressState,
} from "../../../src/ai/voice/press-machine";

// Feed a gesture through the machine and collect everything it asked for.
function run(events: PressEvent[], from: PressState = INITIAL_PRESS_STATE) {
  let state = from;
  const effects: PressEffect[] = [];
  for (const event of events) {
    const result = pressReducer(state, event);
    state = { status: result.status, cancelArmed: result.cancelArmed };
    effects.push(...result.effects);
  }
  return { ...state, effects, kinds: effects.map((e) => e.type) };
}

const count = (kinds: string[], kind: string) => kinds.filter((k) => k === kind).length;
const last = (effects: PressEffect[]) => effects[effects.length - 1];

test("a press asks to begin and clears any stale hint", () => {
  const r = run([{ type: "down" }]);
  expect(r.status).toBe("arming");
  expect(r.effects).toEqual([{ type: "hint", message: null }, { type: "begin" }]);
});

test("a full press records, transcribes and inserts the trimmed text", () => {
  const r = run([
    { type: "down" },
    { type: "started" },
    { type: "up" },
    { type: "transcribed", text: "  hello there\n" },
  ]);
  expect(r.status).toBe("idle");
  expect(r.kinds).toEqual(["hint", "begin", "transcribe", "insert"]);
  expect(last(r.effects)).toEqual({ type: "insert", text: "hello there" });
});

// Rule 1: releasing during arming must make the started recording cancel itself.
test("releasing before `started` arrives cancels the recording and never transcribes", () => {
  const r = run([{ type: "down" }, { type: "up" }, { type: "started" }]);
  expect(r.status).toBe("idle");
  expect(count(r.kinds, "cancel")).toBe(1);
  expect(r.kinds).not.toContain("transcribe");
  expect(r.kinds).not.toContain("insert");
});

test("a release during arming is not undone by a later transcribed event", () => {
  const r = run([
    { type: "down" },
    { type: "up" },
    { type: "started" },
    { type: "transcribed", text: "ghost" },
  ]);
  expect(r.kinds).not.toContain("insert");
});

// Rule 2, machine half: the failure hint still fires after the press was released.
test("a missing key still reports its hint when the press was already released", () => {
  const r = run([{ type: "down" }, { type: "up" }, { type: "failed", message: NEEDS_KEY_HINT }]);
  expect(r.status).toBe("idle");
  expect(r.effects).toContainEqual({ type: "hint", message: NEEDS_KEY_HINT });
});

test("a silent give-up after a release says nothing", () => {
  const r = run([{ type: "down" }, { type: "up" }, { type: "failed", message: null }]);
  expect(r.status).toBe("idle");
  expect(r.kinds).toEqual(["hint", "begin"]); // only the pointerdown's clear
});

// Rule 3: leave arms cancel only while actually recording.
test("leaving during arming does not arm cancel, so the press still transcribes", () => {
  const r = run([{ type: "down" }, { type: "leave" }, { type: "started" }, { type: "up" }]);
  expect(r.cancelArmed).toBe(false);
  expect(r.kinds).toContain("transcribe");
  expect(r.kinds).not.toContain("cancel");
});

test("leaving while recording arms cancel and releasing outside cancels", () => {
  const r = run([{ type: "down" }, { type: "started" }, { type: "leave" }, { type: "up" }]);
  expect(r.status).toBe("idle");
  expect(count(r.kinds, "cancel")).toBe(1);
  expect(r.kinds).not.toContain("transcribe");
});

test("leave then enter then release still transcribes", () => {
  const r = run([
    { type: "down" },
    { type: "started" },
    { type: "leave" },
    { type: "enter" },
    { type: "up" },
  ]);
  expect(r.status).toBe("transcribing");
  expect(r.cancelArmed).toBe(false);
  expect(r.kinds).toContain("transcribe");
  expect(r.kinds).not.toContain("cancel");
});

test("entering while idle does not disturb anything", () => {
  const r = run([{ type: "enter" }, { type: "leave" }]);
  expect(r).toMatchObject({ status: "idle", cancelArmed: false, effects: [] });
});

test("Escape while recording cancels and never inserts", () => {
  const r = run([
    { type: "down" },
    { type: "started" },
    { type: "escape" },
    { type: "up" },
    { type: "transcribed", text: "hello" },
  ]);
  expect(r.status).toBe("idle");
  expect(count(r.kinds, "cancel")).toBe(1);
  expect(r.kinds).not.toContain("insert");
  expect(r.kinds).not.toContain("transcribe");
});

// Rule 4: an unmount mid-recording releases the recorder, exactly once.
test("unmounting while recording emits exactly one cancel", () => {
  const r = run([
    { type: "down" },
    { type: "started" },
    { type: "unmount" },
    { type: "unmount" },
    { type: "up" },
  ]);
  expect(count(r.kinds, "cancel")).toBe(1);
  expect(r.status).toBe("idle");
});

test("unmounting while arming cancels the recording that arrives afterwards", () => {
  const r = run([{ type: "down" }, { type: "unmount" }, { type: "started" }]);
  expect(count(r.kinds, "cancel")).toBe(1);
});

test("unmounting with nothing recorded cancels nothing", () => {
  expect(run([{ type: "unmount" }]).kinds).toEqual([]);
  const mid = run([{ type: "down" }, { type: "started" }, { type: "up" }, { type: "unmount" }]);
  expect(mid.kinds).toEqual(["hint", "begin", "transcribe"]);
});

test("a second pointerup during transcription does not re-run the pipeline", () => {
  const r = run([{ type: "down" }, { type: "started" }, { type: "up" }, { type: "up" }]);
  expect(count(r.kinds, "transcribe")).toBe(1);
});

test("a press is ignored until the previous one is done", () => {
  const r = run([{ type: "down" }, { type: "started" }, { type: "down" }, { type: "down" }]);
  expect(count(r.kinds, "begin")).toBe(1);
  expect(r.status).toBe("recording");
});

test("an empty transcript says so instead of inserting", () => {
  const r = run([
    { type: "down" },
    { type: "started" },
    { type: "up" },
    { type: "transcribed", text: "   " },
  ]);
  expect(last(r.effects)).toEqual({ type: "hint", message: NO_SPEECH_HINT });
  expect(r.kinds).not.toContain("insert");
});

test("a pipeline failure surfaces its message and returns to idle", () => {
  const r = run([
    { type: "down" },
    { type: "started" },
    { type: "up" },
    { type: "failed", message: "stt 401" },
  ]);
  expect(r.status).toBe("idle");
  expect(last(r.effects)).toEqual({ type: "hint", message: "stt 401" });
});

// Rule 2, pipeline half: the config load and its report come before the machine
// is asked whether the press was already released.
test("beginPress reports a missing key even when the press was already released", async () => {
  let started = false;
  const out = await beginPress({
    loadConfig: async () => null,
    aborted: () => true,
    startRecording: async () => {
      started = true;
    },
  });
  expect(out).toEqual({ type: "failed", message: NEEDS_KEY_HINT });
  expect(started).toBe(false);
});

test("beginPress gives up silently when the press was released and a key exists", async () => {
  let started = false;
  const out = await beginPress({
    loadConfig: async () => ({ key: "k" }),
    aborted: () => true,
    startRecording: async () => {
      started = true;
    },
  });
  expect(out).toEqual({ type: "failed", message: null });
  expect(started).toBe(false);
});

test("beginPress starts the recorder and hands back the config", async () => {
  const config = { key: "k" };
  const out = await beginPress({
    loadConfig: async () => config,
    aborted: () => false,
    startRecording: async () => {},
  });
  expect(out).toEqual({ type: "started", config });
});

test("beginPress reports a recorder failure", async () => {
  const out = await beginPress({
    loadConfig: async () => ({ key: "k" }),
    aborted: () => false,
    startRecording: async () => {
      throw new Error("no microphone");
    },
  });
  expect(out).toEqual({ type: "failed", message: "no microphone" });
});

test("beginPress reports a config load failure instead of hanging the button", async () => {
  const out = await beginPress({
    loadConfig: async () => {
      throw new Error("keychain locked");
    },
    aborted: () => false,
    startRecording: async () => {},
  });
  expect(out).toEqual({ type: "failed", message: "keychain locked" });
});
