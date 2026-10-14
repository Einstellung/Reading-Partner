import { afterEach, describe, expect, test } from "bun:test";
import {
  armVoiceTrace,
  disarmVoiceTrace,
  harnessLocale,
  onVoiceTrace,
  traceModel,
  traceSource,
  voiceTrace,
  type TraceMark,
} from "../../../../src/soul/voice/harness/trace";
import { parseScript, runScript, type VoiceScript } from "../../../../src/soul/voice/harness/script";
import {
  alignRows,
  clockOffset,
  formatReport,
  parseRows,
  percentile,
  summarize,
  turnsOf,
  type Row,
} from "../../../../src/soul/voice/harness/latency";
import type { ConversationEvent, ConversationSource } from "../../../../src/soul/voice/conversation";
import type { VoiceCallModel } from "../../../../src/soul/voice/voice-call";

afterEach(() => disarmVoiceTrace());

function fakeSource(log: string[]): ConversationSource & { emit?: (e: ConversationEvent) => void } {
  const src: ConversationSource & { emit?: (e: ConversationEvent) => void } = {
    async start(onEvent) {
      src.emit = onEvent;
    },
    async stop() {},
    async setVolume() {},
    async speakBegin() {
      log.push("begin");
      return 7;
    },
    async speakPush(text) {
      log.push(`push:${text}`);
    },
    async speakClose() {},
    async speakStop() {
      return { utterance: 7, sentence: 0, charOffset: 0, playedMs: 0 } as never;
    },
  };
  return src;
}

describe("trace", () => {
  test("disarmed: wrappers hand back the same objects and marks go nowhere", () => {
    const src = fakeSource([]);
    const model: VoiceCallModel = { ask: async () => {} };
    expect(traceSource(src)).toBe(src);
    expect(traceModel(model)).toBe(model);
    const seen: TraceMark[] = [];
    onVoiceTrace((m) => seen.push(m));
    voiceTrace("x");
    expect(seen).toEqual([]);
    expect(harnessLocale()).toBeUndefined();
  });

  test("armed: events, speech commands and the model are marked", async () => {
    const sunk: TraceMark[] = [];
    let clock = 0;
    armVoiceTrace({ mark: (m) => sunk.push(m) }, { locale: "en-US" }, () => ++clock);
    expect(harnessLocale()).toBe("en-US");
    const calls: string[] = [];
    const raw = fakeSource(calls);
    const src = traceSource(raw);
    const heard: string[] = [];
    await src.start((e) => heard.push(e.kind));
    raw.emit!({ kind: "level", turn: 1, value: 0.5 });
    raw.emit!({ kind: "speech-end", turn: 1, text: "hello", silentMs: 1250 });
    await src.speakBegin();
    await src.speakPush("One.");
    await src.speakPush("Two.");

    const model = traceModel({
      async ask(req) {
        req.onDelta("Hi");
        req.onDelta(" there");
        req.onActivity({ kind: "tool", name: "delegate", phase: "start" });
        req.onActivity({ kind: "tool", name: "delegate", phase: "end" });
      },
    });
    const deltas: string[] = [];
    await model.ask({
      turn: 1,
      text: "hello",
      onDelta: (c) => deltas.push(c),
      onActivity: () => {},
      signal: new AbortController().signal,
    });

    expect(heard).toEqual(["level", "speech-end"]);
    expect(calls).toEqual(["begin", "push:One.", "push:Two."]);
    expect(deltas).toEqual(["Hi", " there"]);
    expect(sunk.map((m) => m.name)).toEqual([
      "conv:speech-end",
      "speak-begin",
      "speak-begun",
      "speak-push-first",
      "speak-push",
      "model-ask",
      "model-first-delta",
      "tool-start",
      "tool-end",
      "model-done",
    ]);
    expect(sunk[0].data).toEqual({ turn: 1, text: "hello", silentMs: 1250 });
    expect(sunk[7].data).toEqual({ turn: 1, name: "delegate" });
    // Strictly increasing: every mark is stamped when it is made.
    expect(sunk.every((m, i) => i === 0 || m.perfMs > sunk[i - 1].perfMs)).toBe(true);
  });
});

describe("script", () => {
  test("defaults and validation", () => {
    const s = parseScript({ name: "a", locale: "zh-CN", steps: [{ clip: "x.wav" }, { clip: "y.wav", start: "reply-start", expect: "interrupt", offsetMs: 2500 }] });
    expect(s.steps[0]).toEqual({ clip: "x.wav", text: "", start: "reply-end", offsetMs: 800, timeoutMs: 90_000, expect: "turn" });
    expect(s.steps[1].offsetMs).toBe(2500);
    expect(s.finalReplies).toBe(1);
    expect(() => parseScript({ name: "a", locale: "zh-CN", steps: [{ clip: "x.mp3" }] })).toThrow("step 0");
    expect(() => parseScript({ name: "a", locale: "zh-CN", steps: [{ clip: "x.wav", start: "soon" }] })).toThrow("unknown start");
  });

  test("the driver answers after replies, barges in on a start, and waits for a later reply", async () => {
    const listeners = new Set<(m: TraceMark) => void>();
    let t = 0;
    const emit = (name: string, data?: Record<string, unknown>) => {
      for (const cb of listeners) cb({ name, perfMs: ++t, ...(data ? { data } : {}) });
    };
    const log: string[] = [];
    // The "call": each fed clip triggers what the AI would do next.
    const reactions: Record<string, () => void> = {
      "a.wav": () => setTimeout(() => {
        emit("speech:speaking", { value: 1 });
        emit("conv:spoken");
      }, 5),
      "b.wav": () => setTimeout(() => emit("speech:speaking", { value: 1 }), 5),
      "c.wav": () => setTimeout(() => {
        emit("conv:spoken");
        // A later, unprompted reply: the background result read out.
        setTimeout(() => {
          emit("speech:speaking", { value: 1 });
          emit("conv:spoken");
        }, 20);
      }, 5),
      "d.wav": () => setTimeout(() => emit("conv:spoken"), 5),
    };
    const script: VoiceScript = parseScript({
      name: "t",
      locale: "zh-CN",
      tailMs: 0,
      steps: [
        { clip: "a.wav", offsetMs: 0, timeoutMs: 1000 },
        { clip: "b.wav", offsetMs: 0, timeoutMs: 1000 },
        { clip: "c.wav", start: "reply-start", offsetMs: 0, timeoutMs: 1000, expect: "interrupt" },
        { clip: "d.wav", start: "next-reply-end", offsetMs: 0, timeoutMs: 1000 },
      ],
    });
    // The opening line.
    setTimeout(() => emit("conv:spoken"), 5);
    const outcomes = await runScript(script, {
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      feed: async (clip) => {
        log.push(clip);
        reactions[clip]?.();
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      mark: (name, data) => {
        if (name === "step-timeout") log.push(`timeout:${String(data?.clip)}`);
      },
    });
    expect(log).toEqual(["a.wav", "b.wav", "c.wav", "d.wav"]);
    expect(outcomes.every((o) => o.cued)).toBe(true);
  });

  test("a cue that never comes times out and the clip is fed anyway", async () => {
    const marks: string[] = [];
    const outcomes = await runScript(
      parseScript({ name: "t", locale: "en-US", tailMs: 0, finalTimeoutMs: 10, steps: [{ clip: "a.wav", timeoutMs: 10, offsetMs: 0 }] }),
      {
        subscribe: () => () => {},
        feed: async () => {},
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        mark: (name) => marks.push(name),
      },
    );
    expect(outcomes[0].cued).toBe(false);
    expect(marks).toContain("step-timeout");
    expect(marks).toContain("final-timeout");
  });
});

describe("latency", () => {
  const n = (t: number, ev: string, extra: Record<string, unknown> = {}): Row => ({ t, src: "native", ev, ...extra });
  const r = (t: number, ev: string, extra: Record<string, unknown> = {}): Row => ({ t, src: "rust", ev, ...extra });
  // Webview rows: perf clock is native - 1000, arrival 3 ms late.
  const j = (t: number, ev: string, extra: Record<string, unknown> = {}): Row => ({ t: t + 3, src: "js", ev, perfMs: t - 1000, ...extra });

  const rows: Row[] = [
    { t: 50, src: "js", ev: "clock-sync", perf0: -960, perf1: -940, native: 50 },
    { t: 60, src: "js", ev: "clock-sync", perf0: -990, perf1: -900, native: 60 },
    j(90, "step-feed", { clip: "a.wav", text: "hi", expect: "turn" }),
    n(100, "clip-start", { name: "a.wav" }),
    n(1100, "clip-speech-end", { name: "a.wav" }),
    n(2400, "turn-end"),
    n(2450, "finalized"),
    n(2455, "conv:speech-end"),
    j(2460, "conv:speech-end"),
    j(2461, "model-ask"),
    j(2600, "model-request"),
    j(4000, "model-first-delta"),
    j(4500, "speak-push-first"),
    r(4510, "tts:started"),
    r(5100, "tts:firstAudio"),
    r(6000, "tts:queued"),
    n(6005, "enqueue"),
    n(6010, "speech:speaking", { value: 1 }),
    n(6050, "audible-start"),
    j(6900, "step-feed", { clip: "b.wav", text: "wait", expect: "interrupt" }),
    n(7000, "clip-start", { name: "b.wav" }),
    n(7100, "conv:speech-duck"),
    n(7400, "conv:speech-stop"),
    n(7450, "audible-end"),
    n(7800, "clip-speech-end", { name: "b.wav" }),
  ];

  test("parseRows skips torn lines", () => {
    expect(parseRows('{"t":1,"src":"native","ev":"a"}\n{"t":2,"src"\n\n')).toHaveLength(1);
  });

  test("the clock offset comes from the tightest round trip", () => {
    expect(clockOffset(rows)).toBe(1000);
    expect(alignRows([j(10, "x"), ...rows.slice(0, 1)]).find((x) => x.ev === "x")!.t).toBe(10);
  });

  test("a turn is cut into its segments and an interruption is timed from its clip", () => {
    const turns = turnsOf(rows);
    expect(turns).toHaveLength(2);
    const [a, b] = turns;
    expect(a.totalMs).toBe(4950);
    expect(a.segments["speechEnd→turnEnd"]).toBe(1300);
    expect(a.segments["jsHeard→ask"]).toBe(1);
    expect(a.segments["firstPush→ttsStarted"]).toBe(10);
    expect(a.segments["speaking→audible"]).toBe(40);
    expect(b.expect).toBe("interrupt");
    expect(b.duckMs).toBe(100);
    expect(b.stopMs).toBe(400);
    expect(b.silencedMs).toBe(450);
    expect(b.interrupted).toBe(true);
    const stats = summarize(turns);
    expect(stats.at(-1)).toEqual({ segment: "TOTAL speechEnd→audible", n: 1, p50: 4950, p90: 4950 });
    expect(formatReport(turns)).toContain("TOTAL speechEnd→audible");
  });

  test("percentile is nearest-rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBeNull();
  });
});
