// The on-device transcript source (src/reading/rehearsal/dictated-source.ts):
// what a stretch of speech becomes, where its two ends come from, and what the
// closing answer adds once every final has already gone out.
// Run: ./scripts/t.sh
//
// No plugin and no microphone: the recognizer is a fake DictationSource, the
// same seam ai/voice/dictation.ts uses to check its own commands, and the clock
// is a variable. Under bun the host has no dictation at all, so this is the only
// place the rules can be exercised.

import { expect, test } from "bun:test";
import {
  closingTail,
  createDictatedTranscriptSource,
} from "../../../src/reading/rehearsal/dictated-source";
import type { DictationEvent, DictationSource } from "../../../src/ai/voice/dictation";
import type { Utterance } from "../../../src/reading/rehearsal/source";

interface Fake {
  source: DictationSource;
  calls: { start: number; stop: number; cancel: number };
  // What stop_dictation answers with: everything already final plus whatever the
  // recognizer flushes on the way out.
  transcript: string;
  // Set to make start() reject, the way a missing plugin or a refused
  // microphone does.
  failStart: Error | null;
  // Set to leave start() hanging until letStart(), which is the window a reader
  // who backs straight out of the rehearsal ends up in.
  hold: boolean;
  emit(e: DictationEvent): void;
  letStart(): void;
}

function fake(): Fake {
  let onEvent: ((e: DictationEvent) => void) | null = null;
  let resume: (() => void) | null = null;
  const f: Fake = {
    calls: { start: 0, stop: 0, cancel: 0 },
    transcript: "",
    failStart: null,
    hold: false,
    emit: (e) => onEvent?.(e),
    letStart: () => resume?.(),
    source: {
      async start(cb) {
        f.calls.start++;
        onEvent = cb;
        if (f.hold) {
          await new Promise<void>((r) => {
            resume = r;
          });
        }
        if (f.failStart) throw f.failStart;
      },
      async stop() {
        f.calls.stop++;
        return f.transcript;
      },
      async cancel() {
        f.calls.cancel++;
      },
    },
  };
  return f;
}

// Let every already-resolved promise chain run out.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function harness() {
  const f = fake();
  const clock = { t: 100 };
  const out: Utterance[] = [];
  let released = 0;
  const source = createDictatedTranscriptSource({
    dictation: f.source,
    now: () => clock.t,
    release: async () => {
      released++;
    },
  });
  return { f, clock, out, source, released: () => released, take: (u: Utterance) => out.push(u) };
}

test("every final that carries words is one utterance, and they tile the run", async () => {
  const h = harness();
  await h.source.start(h.take);

  h.clock.t = 150;
  h.f.emit({ kind: "volatile", text: "hello th" });
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "hello there" });
  h.clock.t = 250;
  h.f.emit({ kind: "level", value: 0.4 });
  h.clock.t = 400;
  h.f.emit({ kind: "final", text: "and this is page two" });

  expect(h.out).toEqual([
    // The first stretch begins when the recognizer came up, not when it was
    // asked to.
    { text: "hello there", startedAt: 100, endedAt: 200 },
    { text: "and this is page two", startedAt: 200, endedAt: 400 },
  ]);
});

test("volatile, level, timing and an empty final hand out nothing and move nothing", async () => {
  const h = harness();
  await h.source.start(h.take);

  h.clock.t = 150;
  h.f.emit({ kind: "volatile", text: "guess" });
  h.f.emit({ kind: "level", value: 1 });
  h.f.emit({
    kind: "timing",
    timing: {
      reused: false,
      reuseSkipped: null,
      probeStage: "never",
      probeTouched: false,
      steps: {},
      teardown: {},
      preroll: null,
    },
  });
  h.clock.t = 200;
  // A final with no text settles a hypothesis without settling any words.
  h.f.emit({ kind: "final", text: "   " });
  h.clock.t = 300;
  h.f.emit({ kind: "final", text: "the only thing said" });

  // Still starts where the recognizer came up: nothing before it was a stretch.
  expect(h.out).toEqual([{ text: "the only thing said", startedAt: 100, endedAt: 300 }]);
});

test("a page turn cuts nothing", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "one" });
  h.source.cut();
  h.source.cut();
  h.clock.t = 300;
  h.f.emit({ kind: "final", text: "two" });

  expect(h.f.calls.stop).toBe(0);
  expect(h.out).toEqual([
    { text: "one", startedAt: 100, endedAt: 200 },
    { text: "two", startedAt: 200, endedAt: 300 },
  ]);
});

test("stopping hands out the flushed tail and not the whole transcript", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "the first stretch" });
  h.clock.t = 300;
  h.f.emit({ kind: "final", text: "the second stretch" });

  h.f.transcript = "the first stretch the second stretch and the last words";
  h.clock.t = 500;
  await h.source.stop();

  expect(h.out).toEqual([
    { text: "the first stretch", startedAt: 100, endedAt: 200 },
    { text: "the second stretch", startedAt: 200, endedAt: 300 },
    // Starts where the last final ended: it is what was said after it.
    { text: "and the last words", startedAt: 300, endedAt: 500 },
  ]);
});

test("a closing answer that adds nothing hands out nothing", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "all of it" });

  h.f.transcript = "all of it";
  h.clock.t = 500;
  await h.source.stop();

  expect(h.out).toHaveLength(1);
});

test("no speech at all leaves the run without a word in it", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 500;
  await h.source.stop();
  expect(h.out).toEqual([]);
});

test("a recognizer that rewrote a stretch it had settled sends it again", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "the first stretch" });
  h.clock.t = 300;
  h.f.emit({ kind: "final", text: "sentients ratio" });

  // The recognizer went back and changed the second stretch. The match holds
  // through the first one, so what follows it comes out again, corrected.
  h.f.transcript = "the first stretch sentience ratio and the last words";
  h.clock.t = 500;
  await h.source.stop();

  expect(h.out.map((u) => u.text)).toEqual([
    "the first stretch",
    "sentients ratio",
    "sentience ratio and the last words",
  ]);
});

test("a final that never reached this side comes back with the closing answer", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "one" });
  // "two" was dropped between the two sides; "three" arrived.
  h.clock.t = 300;
  h.f.emit({ kind: "final", text: "three" });

  h.f.transcript = "one two three four";
  h.clock.t = 400;
  await h.source.stop();

  expect(h.out.map((u) => u.text)).toEqual(["one", "three", "two three four"]);
});

test("stretches with no spaces between them still measure", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "今天讲的是" });
  h.clock.t = 300;
  h.f.emit({ kind: "final", text: "第三章" });

  // The plugin folds its answer with the same CJK-aware seam rule: no space.
  h.f.transcript = "今天讲的是第三章，也就是最后一节";
  h.clock.t = 400;
  await h.source.stop();

  expect(h.out.map((u) => u.text)).toEqual(["今天讲的是", "第三章", "，也就是最后一节"]);
});

test("the microphone goes back when the run is over", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.f.transcript = "";
  await h.source.stop();
  expect(h.f.calls.stop).toBe(1);
  expect(h.released()).toBe(1);
});

test("two stops are one stop, and both callers wait for it", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "said" });
  h.f.transcript = "said and then some";
  h.clock.t = 300;

  const first = h.source.stop();
  const second = h.source.stop();
  await Promise.all([first, second]);

  expect(h.f.calls.stop).toBe(1);
  expect(h.released()).toBe(1);
  expect(h.out).toHaveLength(2);
});

test("a stop that overtook the start waits for it rather than leaving the microphone open", async () => {
  const h = harness();
  h.f.hold = true;
  h.f.transcript = "what was said before they backed out";

  const started = h.source.start(h.take);
  const stopped = h.source.stop();
  await flush();
  // Nothing to stop yet: the recognizer is still coming up.
  expect(h.f.calls.stop).toBe(0);

  h.clock.t = 200;
  h.f.letStart();
  await started;
  h.clock.t = 300;
  await stopped;

  expect(h.f.calls.stop).toBe(1);
  expect(h.out).toEqual([
    { text: "what was said before they backed out", startedAt: 200, endedAt: 300 },
  ]);
});

test("a start that failed is reported, and there is nothing to stop", async () => {
  const h = harness();
  h.f.failStart = new Error("This device cannot dictate.");

  await expect(h.source.start(h.take)).rejects.toThrow("This device cannot dictate.");
  await h.source.stop();

  expect(h.f.calls.stop).toBe(0);
  expect(h.out).toEqual([]);
});

test("a stop that failed keeps every stretch already handed out", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "said before it broke" });
  h.f.source.stop = () => Promise.reject(new Error("the recognizer died"));

  await h.source.stop();

  expect(h.out.map((u) => u.text)).toEqual(["said before it broke"]);
  expect(h.released()).toBe(1);
});

test("a final that arrives after the stop is not handed out twice", async () => {
  const h = harness();
  await h.source.start(h.take);
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "one" });
  h.f.transcript = "one two";
  h.f.source.stop = async () => {
    // The plugin does not emit after stop_dictation is received; a build that
    // did would otherwise hand the same words out twice.
    h.f.emit({ kind: "final", text: "two" });
    return "one two";
  };
  h.clock.t = 300;
  await h.source.stop();

  expect(h.out.map((u) => u.text)).toEqual(["one", "two"]);
});

test("starting twice is starting once", async () => {
  const h = harness();
  await h.source.start(h.take);
  await h.source.start(() => {});
  h.clock.t = 200;
  h.f.emit({ kind: "final", text: "one" });

  expect(h.f.calls.start).toBe(1);
  expect(h.out).toHaveLength(1);
});

test("closingTail measures against what went out, ignoring the seams", () => {
  expect(closingTail([], "everything")).toBe("everything");
  expect(closingTail(["a", "b"], "a b c")).toBe("c");
  expect(closingTail(["a", "b"], "a  b   c")).toBe("c");
  // A fold that spaced a seam the other way costs the space, not the transcript.
  expect(closingTail(["hello", "there"], "hellothere and more")).toBe("and more");
  expect(closingTail(["a", "b"], "")).toBe("");
  expect(closingTail(["a", "b"], "a b")).toBe("");
});
