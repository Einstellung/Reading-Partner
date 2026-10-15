import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  tasksOf,
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
    expect(s.steps[0]).toEqual({ clip: "x.wav", text: "", start: "reply-end", offsetMs: 800, timeoutMs: 90_000, expect: "turn", minChars: 50 });
    expect(s.settleMs).toBe(60_000);
    expect(s.quietMs).toBe(2000);
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
      quietMs: 5,
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
      now: () => performance.now(),
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
        now: () => performance.now(),
        mark: (name) => marks.push(name),
      },
    );
    expect(outcomes[0].cued).toBe(false);
    expect(marks).toContain("step-timeout");
    expect(marks).toContain("final-timeout");
  });
});

describe("driver timing", () => {
  /** A call the test plays by hand: marks go in with `emit`, each fed clip is logged. */
  function call() {
    const listeners = new Set<(m: TraceMark) => void>();
    const fed: string[] = [];
    const marks: string[] = [];
    const emit = (name: string, data?: Record<string, unknown>) => {
      for (const cb of [...listeners]) cb({ name, perfMs: 0, ...(data ? { data } : {}) });
    };
    const deps = {
      subscribe: (cb: (m: TraceMark) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      feed: async (clip: string) => {
        fed.push(clip);
      },
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      now: () => performance.now(),
      mark: (name: string) => marks.push(name),
    };
    return { emit, fed, marks, deps };
  }
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  /** A reply the webview speaks: begun, pushed, heard. */
  const reply = (emit: (n: string, d?: Record<string, unknown>) => void, utterance: number, chars: number[]) => {
    emit("speak-begun", { utterance });
    chars.forEach((c, i) => emit(i === 0 ? "speak-push-first" : "speak-push", { chars: c }));
    emit("speech:speaking", { value: 1 });
  };

  test("a question waits for a result notice to be said to its end", async () => {
    const c = call();
    const done = runScript(
      parseScript({
        name: "t",
        locale: "zh-CN",
        finalReplies: 0,
        tailMs: 0,
        quietMs: 30,
        steps: [
          { clip: "a.wav", start: "clip-end", offsetMs: 0 },
          { clip: "b.wav", offsetMs: 0, timeoutMs: 2000 },
        ],
      }),
      c.deps,
    );
    // The first clip settles on a quiet call: quietMs, then fed.
    await tick(50);
    expect(c.fed).toEqual(["a.wav"]);
    c.emit("model-ask", { turn: 1 });
    c.emit("model-done", { turn: 1 });
    reply(c.emit, 1, [10]);
    // The task comes back as the answer ends; the front tells it after a gap.
    c.emit("front:note", { number: 1, status: "done" });
    c.emit("conv:spoken", { utterance: 1, reason: "done" });
    await tick(60);
    expect(c.fed).toEqual(["a.wav"]);
    c.emit("front:notify", { turn: -1, numbers: [1] });
    c.emit("model-ask", { turn: -1 });
    reply(c.emit, 2, [11, 15]);
    c.emit("model-done", { turn: -1 });
    // Ran dry and picks up again: not the end.
    c.emit("conv:spoken", { utterance: 2, reason: "underrun" });
    await tick(10);
    c.emit("speech:speaking", { value: 1 });
    await tick(60);
    expect(c.fed).toEqual(["a.wav"]);
    c.emit("conv:spoken", { utterance: 2, reason: "done" });
    await done;
    expect(c.fed).toEqual(["a.wav", "b.wav"]);
    expect(c.marks).not.toContain("settle-timeout");
  });

  test("a mark from before the previous clip does not cue the reply after it", async () => {
    const c = call();
    const done = runScript(
      parseScript({
        name: "t",
        locale: "zh-CN",
        finalReplies: 0,
        tailMs: 0,
        settleMs: 0,
        steps: [
          { clip: "a.wav", start: "clip-end", offsetMs: 0 },
          { clip: "b.wav", offsetMs: 0, timeoutMs: 2000 },
          { clip: "c.wav", after: "front:notify", offsetMs: 0, timeoutMs: 2000 },
        ],
      }),
      c.deps,
    );
    await tick();
    c.emit("front:notify", { turn: -1, numbers: [1] });
    c.emit("conv:spoken", { utterance: 1, reason: "done" });
    await tick();
    expect(c.fed).toEqual(["a.wav", "b.wav"]);
    await tick(20);
    // The reply to b has not ended yet.
    expect(c.fed).toEqual(["a.wav", "b.wav"]);
    c.emit("conv:spoken", { utterance: 2, reason: "done" });
    await done;
    expect(c.fed).toEqual(["a.wav", "b.wav", "c.wav"]);
  });

  test("a barge-in waits for a long reply to be heard, past a cue and a short answer", async () => {
    const c = call();
    const done = runScript(
      parseScript({
        name: "t",
        locale: "zh-CN",
        finalReplies: 0,
        tailMs: 0,
        settleMs: 0,
        steps: [
          { clip: "a.wav", start: "clip-end", offsetMs: 0 },
          { clip: "uh.wav", start: "long-reply", minChars: 40, offsetMs: 10, timeoutMs: 2000, expect: "none" },
          { clip: "wait.wav", start: "long-reply", minChars: 40, offsetMs: 10, timeoutMs: 2000, expect: "interrupt" },
        ],
      }),
      c.deps,
    );
    await tick();
    // The cue: heard, but nothing the webview began.
    c.emit("speech:speaking", { value: 1 });
    c.emit("conv:spoken", { utterance: 5, reason: "done" });
    // A short answer.
    reply(c.emit, 6, [12]);
    c.emit("conv:spoken", { utterance: 6, reason: "done" });
    await tick(30);
    expect(c.fed).toEqual(["a.wav"]);
    // Begun long, but not heard yet.
    reply(c.emit, 7, [13, 13, 10, 18]);
    c.emit("speech:speaking", { value: 0 });
    c.emit("speech:speaking", { value: 1 });
    await done;
    expect(c.fed).toEqual(["a.wav", "uh.wav", "wait.wav"]);
    expect(c.marks).not.toContain("step-timeout");
    expect(c.marks).not.toContain("step-late");
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
    j(2460, "front:speech-end"),
    j(2600, "front:request-sent"),
    j(4000, "front:first-byte"),
    j(4500, "front:first-sentence-to-tts"),
    n(6005, "enqueue"),
    n(6008, "tts-first", { req: 4510, firstAudio: 5100, handed: 6000 }),
    n(6010, "speech:speaking", { value: 1 }),
    n(6050, "audible-start"),
    j(6900, "step-feed", { clip: "b.wav", text: "wait", expect: "interrupt" }),
    n(7000, "clip-start", { name: "b.wav" }),
    n(7100, "conv:speech-duck"),
    n(7400, "conv:speech-stop"),
    n(7450, "audible-end"),
    n(7450, "conv:spoken", { reason: "interrupted", utterance: 1 }),
    n(7800, "clip-speech-end", { name: "b.wav" }),
    // A hard question: handed off, the cue plays, the result comes back later.
    j(8900, "step-feed", { clip: "c.wav", text: "check it", expect: "turn" }),
    n(9000, "clip-start", { name: "c.wav" }),
    n(10000, "clip-speech-end", { name: "c.wav" }),
    j(10500, "front:delegate-sent", { turn: 3 }),
    j(10900, "front:delegate-done", { turn: 3, out: "Handed over as task 2. It comes back on its own" }),
    r(10950, "cue", { id: "zh/think", premade: true }),
    n(11100, "audible-start"),
    n(11500, "tts-dry"),
    n(11700, "tts-resumed", { silentMs: 200 }),
    j(20000, "front:note", { number: 2, status: "done" }),
    j(20500, "step-feed", { clip: "d.wav", text: "go on", expect: "turn" }),
    n(20600, "clip-start", { name: "d.wav" }),
    n(21000, "clip-speech-end", { name: "d.wav" }),
    j(22000, "front:notify", { turn: -1, numbers: [2] }),
    j(22600, "front:first-byte", { turn: -1 }),
    j(22605, "speak-begun", { utterance: 3 }),
    j(22700, "model-done", { turn: -1 }),
    n(22950, "tts-first", { utterance: 3, index: 0, req: 22610, firstAudio: 22900, handed: 22940 }),
    n(23000, "audible-start"),
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
    expect(turns).toHaveLength(4);
    const [a, b] = turns;
    expect(a.totalMs).toBe(4950);
    expect(a.segments["speechEnd→turnEnd"]).toBe(1300);
    expect(a.segments["frontHeard→request"]).toBe(140);
    expect(a.segments["firstSentence→ttsRequested"]).toBe(10);
    expect(a.segments["ttsRequested→ttsFirstAudio"]).toBe(590);
    expect(a.segments["ttsHanded→enqueue"]).toBe(5);
    expect(a.segments["scheduled→audible"]).toBe(42);
    expect(a.delegateMs).toBeUndefined();
    expect(b.expect).toBe("interrupt");
    expect(b.duckMs).toBe(100);
    expect(b.stopMs).toBe(400);
    expect(b.silencedMs).toBe(450);
    expect(b.interrupted).toBe(true);
    expect(b.playing).toBe(true);
    expect(b.verdict).toBe("pass");
    const stats = summarize(turns);
    expect(stats[stats.length - 1]).toEqual({ segment: "TOTAL speechEnd→audible", n: 3, p50: 2000, p90: 4950 });
    expect(formatReport(turns)).toContain("TOTAL speechEnd→audible");
  });

  test("a handed-off question is timed to its filler, and its task to the notice", () => {
    const c = turnsOf(rows)[2];
    expect(c.delegateMs).toBe(500);
    expect(c.fillerMs).toBe(1100);
    expect(c.cue).toBe(true);
    expect(c.dry).toBe(1);
    expect(c.drySilentMs).toBe(200);
    const tasks = tasksOf(rows);
    expect(tasks).toEqual([
      { number: 2, status: "done", sent: 10500, backMs: 9500, notifyMs: 2000, heardMs: 1000, totalMs: 12500 },
    ]);
    const report = formatReport(turnsOf(rows), tasks);
    expect(report).toContain("hard question→filler heard");
    expect(report).toContain("sent→back");
    expect(report).toMatch(/task notify→heard \(own utterance\) +1 +1000 +1000/);
    expect(report).toMatch(/barge-in interrupt: pass \/ fail \/ void +1 +1 \/ 0 \/ 0/);
  });

  test("a notice cut before it was heard borrows no later sound, and a failure keeps its reason", () => {
    const cut: Row[] = [
      j(1000, "front:delegate-sent", { turn: 1 }),
      j(1010, "front:delegate-done", { turn: 1, out: "Handed over as task 1." }),
      j(1020, "front:delegate-sent", { turn: 2 }),
      j(1030, "front:delegate-done", { turn: 2, out: "Handed over as task 2." }),
      j(5000, "front:note", { number: 1, status: "done" }),
      j(6000, "front:notify", { turn: -1, numbers: [1] }),
      j(7000, "front:first-byte", { turn: -1 }),
      j(7005, "speak-begun", { utterance: 4 }),
      j(7500, "speak-stop"),
      j(7600, "model-done", { turn: -1, aborted: true }),
      // The next thing heard is a cue for another question.
      n(9000, "tts-first", { utterance: 5, index: 0 }),
      n(9050, "audible-start"),
      j(9500, "front:note", { number: 2, status: "failed", reason: "Importing a module script failed." }),
    ];
    const tasks = tasksOf(cut);
    expect(tasks[0]).toMatchObject({ number: 1, status: "done", notifyMs: 1000, heardMs: null, totalMs: null });
    expect(tasks[1]).toMatchObject({ number: 2, status: "failed", reason: "Importing a module script failed." });
    const report = formatReport([], tasks);
    expect(report).toContain("tasks 2: done 1, failed 1");
    expect(report).toMatch(/task notify→heard \(own utterance\) +0 +- +-/);
    expect(report).toContain("Importing a module script failed.");
  });

  test("every fixture script parses and its clips exist", () => {
    const dir = new URL("../../../fixtures/voice-scripts/", import.meta.url).pathname;
    const names = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(names.sort()).toEqual(["barge-in.json", "en-mixed.json", "zh-chat-then-delegate.json"]);
    for (const name of names) {
      const script = parseScript(JSON.parse(readFileSync(dir + name, "utf8")));
      for (const step of script.steps) expect(existsSync(dir + step.clip)).toBe(true);
    }
  });

  test("a step can wait for a mark that already happened, then for the reply after it", async () => {
    const listeners = new Set<(m: TraceMark) => void>();
    const emit = (name: string, data?: Record<string, unknown>) => {
      for (const cb of [...listeners]) cb({ name, perfMs: 0, ...(data ? { data } : {}) });
    };
    const fed: string[] = [];
    const script = parseScript({
      name: "s",
      locale: "zh-CN",
      finalReplies: 0,
      tailMs: 0,
      settleMs: 0,
      steps: [
        { clip: "a.wav", start: "clip-end", offsetMs: 0 },
        { clip: "b.wav", after: "front:notify", start: "reply-end", offsetMs: 0, timeoutMs: 1000 },
      ],
    });
    expect(script.steps[1].after).toBe("front:notify");
    const done = runScript(script, {
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      feed: async (clip) => {
        fed.push(clip);
        if (clip === "a.wav") {
          emit("conv:spoken");
          emit("front:notify");
          emit("speech:speaking", { value: 1 });
        }
      },
      // Timeouts never fire here; the zero tail does.
      sleep: (ms) => (ms === 0 ? Promise.resolve() : new Promise<void>(() => {})),
      now: () => 0,
      mark: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    // The reply that ended before the notice does not count.
    expect(fed).toEqual(["a.wav"]);
    emit("conv:spoken");
    const outcomes = await done;
    expect(fed).toEqual(["a.wav", "b.wav"]);
    expect(outcomes[1].cued).toBe(true);
  });

  test("percentile is nearest-rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBeNull();
  });
});
