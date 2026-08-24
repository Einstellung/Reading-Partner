// The desktop transcript source (src/reading/rehearsal/segmented-source.ts):
// what a page turn cuts, what order the words come back out in when the uploads
// finish out of order, and what a segment that will not transcribe costs.
// Run: ./scripts/t.sh
//
// No recorder and no network: the session, the transcriber and the timer are all
// injected, and each transcription is a deferred this file resolves by hand, so
// "the second segment came back first" is a line of test and not a race.

import { expect, test } from "bun:test";
import {
  createSegmentedTranscriptSource,
  MAX_SEGMENT_SECONDS,
  type RecordingSession,
  type Schedule,
} from "../../../src/reading/rehearsal/segmented-source";
import type { Utterance } from "../../../src/reading/rehearsal/source";

// Let every already-resolved promise chain run out.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The recorder. Each cut hands back one distinguishable byte, numbered in the
// order the recorder was asked, so a test can say which segment it is resolving.
class FakeSession implements RecordingSession {
  readonly calls: string[] = [];
  startOptions: { maxSegmentSeconds?: number } | undefined;
  private taken = 0;
  cutFails = false;

  async start(opts?: { maxSegmentSeconds?: number }): Promise<void> {
    this.calls.push("start");
    this.startOptions = opts;
  }

  async cut(): Promise<Uint8Array> {
    this.calls.push("cut");
    if (this.cutFails) throw new Error("the recorder let go");
    return new Uint8Array([++this.taken]);
  }

  async stop(): Promise<Uint8Array> {
    this.calls.push("stop");
    return new Uint8Array([++this.taken]);
  }
}

interface Deferred {
  resolve(text: string): void;
  reject(e: unknown): void;
}

// A transcriber that answers nothing until told to. `calls` is every segment
// byte it was handed, retries included.
function transcriber() {
  const calls: number[] = [];
  const waiting = new Map<number, Deferred[]>();
  const transcribe = (wav: Uint8Array): Promise<string> => {
    const key = wav[0];
    calls.push(key);
    return new Promise<string>((resolve, reject) => {
      const queue = waiting.get(key) ?? [];
      queue.push({ resolve, reject });
      waiting.set(key, queue);
    });
  };
  const take = (segment: number): Deferred => {
    const queue = waiting.get(segment);
    const next = queue?.shift();
    if (!next) throw new Error(`segment ${segment} was never sent`);
    return next;
  };
  return {
    calls,
    transcribe,
    resolve: (segment: number, text: string) => take(segment).resolve(text),
    reject: (segment: number) => take(segment).reject(new Error("STT said no")),
  };
}

// setTimeout with the clock in the test's hand.
function timers() {
  let live: { fn: () => void; ms: number } | null = null;
  const schedule: Schedule = (fn, ms) => {
    live = { fn, ms };
    const mine = live;
    return () => {
      if (live === mine) live = null;
    };
  };
  return {
    schedule,
    pending: () => live?.ms ?? null,
    fire: () => {
      const t = live;
      live = null;
      if (!t) throw new Error("no timer was armed");
      t.fn();
    },
  };
}

function harness(options: { startFails?: boolean } = {}) {
  const session = new FakeSession();
  if (options.startFails) {
    session.start = async () => {
      throw new Error("no microphone");
    };
  }
  const stt = transcriber();
  const clock = timers();
  let time = 1_000;
  const heard: Utterance[] = [];
  const source = createSegmentedTranscriptSource({
    session,
    transcribe: stt.transcribe,
    now: () => time,
    schedule: clock.schedule,
  });
  return {
    session,
    stt,
    clock,
    heard,
    source,
    at: (t: number) => {
      time = t;
    },
    start: () => source.start((u) => heard.push(u)),
  };
}

test("segments come out in the order they were cut, not the order they came back", async () => {
  const h = harness();
  await h.start();

  h.at(2_000);
  h.source.cut();
  await flush();
  h.at(3_000);
  h.source.cut();
  await flush();
  expect(h.stt.calls).toEqual([1, 2]);

  // The second page's upload wins the race. Nothing may be handed out yet: the
  // first page is still in flight and it goes first.
  h.stt.resolve(2, "and this is the second page");
  await flush();
  expect(h.heard).toEqual([]);

  h.stt.resolve(1, "this is the first page");
  await flush();
  expect(h.heard.map((u) => u.text)).toEqual([
    "this is the first page",
    "and this is the second page",
  ]);
});

test("a segment is stamped with the page turns that opened and closed it", async () => {
  const h = harness();
  await h.start();

  h.at(2_500);
  h.source.cut();
  await flush();
  h.at(4_000);
  h.source.cut();
  await flush();

  h.stt.resolve(1, "one");
  h.stt.resolve(2, "two");
  await flush();
  expect(h.heard.map((u) => [u.startedAt, u.endedAt])).toEqual([
    [1_000, 2_500],
    [2_500, 4_000],
  ]);
});

test("a failed segment is retried once, and a second failure is empty text", async () => {
  const h = harness();
  await h.start();

  h.at(2_000);
  h.source.cut();
  await flush();
  h.stt.reject(1);
  await flush();
  // Same audio, sent again.
  expect(h.stt.calls).toEqual([1, 1]);

  h.stt.reject(1);
  await flush();
  expect(h.stt.calls).toEqual([1, 1]);
  expect(h.heard).toEqual([{ text: "", startedAt: 1_000, endedAt: 2_000 }]);
});

test("a retry that works is the segment's words", async () => {
  const h = harness();
  await h.start();

  h.at(2_000);
  h.source.cut();
  await flush();
  h.stt.reject(1);
  await flush();
  h.stt.resolve(1, "it went up the second time");
  await flush();
  expect(h.heard.map((u) => u.text)).toEqual(["it went up the second time"]);
});

// A failure at the recorder, not at STT: there is no audio, so there is nothing
// to retry. The segment still has to take its turn or everything behind it would
// be stuck in the queue for good.
test("a cut the recorder refuses still comes out, empty and in order", async () => {
  const h = harness();
  await h.start();

  h.session.cutFails = true;
  h.at(2_000);
  h.source.cut();
  await flush();
  h.session.cutFails = false;
  h.at(3_000);
  h.source.cut();
  await flush();

  h.stt.resolve(1, "the page after it");
  await flush();
  expect(h.heard).toEqual([
    { text: "", startedAt: 1_000, endedAt: 2_000 },
    { text: "the page after it", startedAt: 2_000, endedAt: 3_000 },
  ]);
});

test("a page held longer than the ceiling is cut anyway, and the ceiling re-arms", async () => {
  const h = harness();
  await h.start();
  expect(h.clock.pending()).toBe(MAX_SEGMENT_SECONDS * 1_000);
  expect(h.session.startOptions).toEqual({ maxSegmentSeconds: MAX_SEGMENT_SECONDS });

  h.at(61_000);
  h.clock.fire();
  await flush();
  expect(h.session.calls).toEqual(["start", "cut"]);
  // Still on the same page: the next 60 seconds are already counting.
  expect(h.clock.pending()).toBe(MAX_SEGMENT_SECONDS * 1_000);

  h.at(121_000);
  h.clock.fire();
  await flush();
  h.stt.resolve(1, "the first minute");
  h.stt.resolve(2, "the second minute");
  await flush();
  expect(h.heard.map((u) => [u.text, u.startedAt, u.endedAt])).toEqual([
    ["the first minute", 1_000, 61_000],
    ["the second minute", 61_000, 121_000],
  ]);
});

test("a page turn resets the ceiling", async () => {
  const h = harness();
  await h.start();

  h.at(30_000);
  h.source.cut();
  await flush();
  expect(h.clock.pending()).toBe(MAX_SEGMENT_SECONDS * 1_000);
  h.at(90_000);
  h.clock.fire();
  await flush();
  // 90 s in, two segments: the page turn at 30 s, then a full minute after it.
  expect(h.session.calls).toEqual(["start", "cut", "cut"]);
});

test("stop transcribes the page that was up when the reader finished", async () => {
  const h = harness();
  await h.start();

  h.at(2_000);
  h.source.cut();
  await flush();
  h.at(5_000);
  const stopped = h.source.stop();
  await flush();
  expect(h.session.calls).toEqual(["start", "cut", "stop"]);

  let done = false;
  void stopped.then(() => {
    done = true;
  });
  h.stt.resolve(2, "the last page");
  await flush();
  // stop() does not return until every segment is in, including ones cut long
  // before it.
  expect(done).toBe(false);

  h.stt.resolve(1, "the page before it");
  await flush();
  await stopped;
  expect(h.heard.map((u) => u.text)).toEqual(["the page before it", "the last page"]);
  expect(h.clock.pending()).toBeNull();
});

test("a cut after stop is not a segment", async () => {
  const h = harness();
  await h.start();

  h.at(2_000);
  const stopped = h.source.stop();
  await flush();
  h.source.cut();
  h.stt.resolve(1, "all of it");
  await flush();
  await stopped;
  expect(h.session.calls).toEqual(["start", "stop"]);
  expect(h.heard.map((u) => u.text)).toEqual(["all of it"]);
});

test("cut and stop before start do nothing at all", async () => {
  const h = harness();
  h.source.cut();
  await h.source.stop();
  await flush();
  expect(h.session.calls).toEqual([]);
  expect(h.heard).toEqual([]);
});

test("a session that will not start leaves a source that cuts nothing", async () => {
  const h = harness({ startFails: true });
  await expect(h.start()).rejects.toThrow("no microphone");
  h.source.cut();
  await h.source.stop();
  await flush();
  expect(h.stt.calls).toEqual([]);
  expect(h.heard).toEqual([]);
});
