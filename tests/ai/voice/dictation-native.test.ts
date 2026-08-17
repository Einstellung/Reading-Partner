// The wire contract with the iOS voice plugin: three command strings, two
// argument keys, one plugin event name, and the `{transcript}` return shape.
// None of it is checked by anything else — nativeDictation() answers null off
// iOS, so under bun the class is never built — and every one of these strings
// has to match a Swift selector or a Rust command name that no compiler
// compares it to. A typo here is a device build to find out.
//
// The bridge is a parameter rather than a mocked module on purpose: mock.module
// rewrites the whole worker's registry and does not roll back
// (docs/pitfall/119), and @tauri-apps/api/core is imported by half the app.
//
// Run: bun test tests/ai/voice/dictation-native.test.ts

import { expect, test } from "bun:test";
import {
  createNativeDictation,
  type DictationBridge,
  type DictationEvent,
} from "../../../src/ai/voice/dictation";

interface Call {
  command: string;
  args?: Record<string, unknown>;
}

function bridge(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const subscriptions: { plugin: string; event: string }[] = [];
  let unregistered = 0;
  let emit: ((e: DictationEvent) => void) | null = null;

  const it: DictationBridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args });
      if (answers[command] instanceof Error) throw answers[command];
      return answers[command] as T;
    },
    async subscribe(plugin, event, cb) {
      subscriptions.push({ plugin, event });
      emit = cb;
      return {
        async unregister() {
          unregistered += 1;
        },
      };
    },
  };

  return {
    it,
    calls,
    subscriptions,
    fire: (e: DictationEvent) => emit?.(e),
    unregistered: () => unregistered,
  };
}

test("start subscribes to the plugin's dictation event before it invokes", async () => {
  const b = bridge();
  const source = createNativeDictation({}, b.it);
  await source.start(() => {});

  expect(b.subscriptions).toEqual([{ plugin: "voice", event: "dictation" }]);
  expect(b.calls[0].command).toBe("plugin:voice|start_dictation");
});

test("start passes locale and contextualStrings under exactly those keys", async () => {
  const b = bridge();
  const source = createNativeDictation(
    { locale: "zh-CN", contextualStrings: ["注意力", "Transformer"] },
    b.it,
  );
  await source.start(() => {});

  expect(b.calls[0].args).toEqual({
    locale: "zh-CN",
    contextualStrings: ["注意力", "Transformer"],
  });
});

// The composer never passes a locale and passes contextualStrings: undefined on
// a book with no glossary. The IPC payload is JSON.stringify'd, so both keys
// vanish and the native side receives {} — it has to treat them as absent, not
// null.
test("both start arguments are undefined when the composer omits them", async () => {
  const b = bridge();
  const source = createNativeDictation({}, b.it);
  await source.start(() => {});

  const args = b.calls[0].args as Record<string, unknown>;
  expect(args.locale).toBeUndefined();
  expect(args.contextualStrings).toBeUndefined();
  expect(JSON.stringify(args)).toBe("{}");
});

test("events reach the callback as the payload itself", async () => {
  const b = bridge();
  const seen: DictationEvent[] = [];
  const source = createNativeDictation({}, b.it);
  await source.start((e) => seen.push(e));

  b.fire({ kind: "volatile", text: "attention is all" });
  b.fire({ kind: "level", value: 0.4 });
  expect(seen).toEqual([
    { kind: "volatile", text: "attention is all" },
    { kind: "level", value: 0.4 },
  ]);
});

test("stop reads transcript off the returned object and drops the listener", async () => {
  const b = bridge({ "plugin:voice|stop_dictation": { transcript: "Attention is all you need." } });
  const source = createNativeDictation({}, b.it);
  await source.start(() => {});

  expect(await source.stop()).toBe("Attention is all you need.");
  expect(b.calls[1]).toEqual({ command: "plugin:voice|stop_dictation", args: undefined });
  expect(b.unregistered()).toBe(1);
});

// A bare string would degrade to "" here and the hold would quietly fall back to
// the streamed text, which is the bug that never announces itself.
test("stop answers empty when the native side returns the wrong shape", async () => {
  const b = bridge({ "plugin:voice|stop_dictation": "Attention is all you need." });
  const source = createNativeDictation({}, b.it);
  await source.start(() => {});

  expect(await source.stop()).toBe("");
});

test("stop drops the listener even when the flush rejects", async () => {
  const b = bridge({ "plugin:voice|stop_dictation": new Error("Dictation stopped unexpectedly.") });
  const source = createNativeDictation({}, b.it);
  await source.start(() => {});

  await expect(source.stop()).rejects.toThrow("Dictation stopped unexpectedly.");
  expect(b.unregistered()).toBe(1);
});

test("cancel unsubscribes before it invokes, so a late event reaches nobody", async () => {
  const b = bridge();
  const seen: DictationEvent[] = [];
  const source = createNativeDictation({}, b.it);
  await source.start((e) => seen.push(e));

  await source.cancel();
  expect(b.unregistered()).toBe(1);
  expect(b.calls[1]).toEqual({ command: "plugin:voice|cancel_dictation", args: undefined });
});

test("a failed start drops the listener rather than leaking one per press", async () => {
  const b = bridge({
    "plugin:voice|start_dictation": new Error("Microphone access is off. Turn it on in Settings."),
  });
  const source = createNativeDictation({}, b.it);

  await expect(source.start(() => {})).rejects.toThrow("Microphone access is off.");
  expect(b.unregistered()).toBe(1);
});
