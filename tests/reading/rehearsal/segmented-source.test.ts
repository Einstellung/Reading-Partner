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
  wavHasSamples,
} from "../../../src/reading/rehearsal/segmented-source";
import type { Utterance } from "../../../src/reading/rehearsal/source";

// Let every already-resolved promise chain run out.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// A WAV the way the recorder writes one (hound, src-tauri/src/voice.rs): RIFF,
// fmt, data. `samples` bytes of audio, so zero is the header-only WAV a page
// nobody spoke to comes back as.
function wav(samples: number, opts: { extraChunk?: number } = {}): Uint8Array {
  // A chunk of odd length is followed by a pad byte.
  const extra = opts.extraChunk === undefined ? 0 : 8 + opts.extraChunk + (opts.extraChunk % 2);
  const bytes = new Uint8Array(44 + extra + samples);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  // Something between fmt and data, when the test asks for it: the data chunk is
  // found by walking, not by counting to 36.
  if (opts.extraChunk !== undefined) {
    tag(36, "LIST");
    view.setUint32(40, opts.extraChunk, true);
  }
  tag(36 + extra, "data");
  view.setUint32(40 + extra, samples, true);
  return bytes;
}

// The recorder. Each cut hands back one distinguishable byte, numbered in the
// order the recorder was asked, so a test can say which segment it is resolving.
class FakeSession implements RecordingSession {
  readonly calls: string[] = [];
  startOptions: { maxSegmentSeconds?: number } | undefined;
  private taken = 0;
  cutFails = false;
  // Nothing was said on this page: the recorder hands back a WAV with no audio
  // in it, which is not an error.
  silent = false;

  async start(opts?: { maxSegmentSeconds?: number }): Promise<void> {
    this.calls.push("start");
    this.startOptions = opts;
  }

  async cut(): Promise<Uint8Array> {
    this.calls.push("cut");
    if (this.cutFails) throw new Error("the recorder let go");
    this.taken++;
    return this.silent ? wav(0) : new Uint8Array([this.taken]);
  }

  async stop(): Promise<Uint8Array> {
    this.calls.push("stop");
    this.taken++;
    return this.silent ? wav(0) : new Uint8Array([this.taken]);
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

// The view stops the source twice on the way out: once from the effect cleanup
// that tears the rehearsal down, once from the save, which has to wait for the
// last uploads before it writes the run. A second call that returned early would
// let the run be built with the last pages still in flight.
test("stopping twice is one stop, and the second caller waits for it too", async () => {
  const h = harness();
  await h.start();

  h.at(2_000);
  h.source.cut();
  await flush();

  h.at(5_000);
  const first = h.source.stop();
  const second = h.source.stop();
  expect(second).toBe(first);
  await flush();
  // The recorder is asked once, however many times the source is stopped.
  expect(h.session.calls).toEqual(["start", "cut", "stop"]);

  let done = false;
  void second.then(() => {
    done = true;
  });
  await flush();
  expect(done).toBe(false);

  h.stt.resolve(1, "the page before it");
  h.stt.resolve(2, "the last page");
  await flush();
  await second;
  expect(done).toBe(true);
  expect(h.heard.map((u) => u.text)).toEqual(["the page before it", "the last page"]);

  // A stop after everything is in is still that same stop, not a new cut.
  await h.source.stop();
  expect(h.session.calls).toEqual(["start", "cut", "stop"]);
});

test("a page nobody spoke to is never sent, and still waits its turn", async () => {
  const h = harness();
  await h.start();

  h.at(2_000);
  h.source.cut();
  await flush();
  h.session.silent = true;
  h.at(3_000);
  h.source.cut();
  await flush();

  // Silence costs no upload and no retry: only the page with words on it went.
  expect(h.stt.calls).toEqual([1]);
  // Settling without leaving the machine does not let it overtake the page in
  // front of it either.
  expect(h.heard).toEqual([]);

  h.stt.resolve(1, "the first page");
  await flush();
  expect(h.heard).toEqual([
    { text: "the first page", startedAt: 1_000, endedAt: 2_000 },
    { text: "", startedAt: 2_000, endedAt: 3_000 },
  ]);
});

// What "no audio in it" is read from: the data chunk's declared length, found by
// walking the chunks. Not the file's byte count — a header-only WAV is 44 bytes
// under this encoder, and that is the encoder's business.
test("a WAV with an empty data chunk has no samples, whatever else is in it", () => {
  expect(wavHasSamples(wav(0))).toBe(false);
  expect(wavHasSamples(wav(0, { extraChunk: 3 }))).toBe(false);
  expect(wavHasSamples(wav(320))).toBe(true);
  expect(wavHasSamples(wav(320, { extraChunk: 3 }))).toBe(true);
});

test("bytes that are not a WAV are sent as they are", () => {
  expect(wavHasSamples(new Uint8Array(0))).toBe(true);
  expect(wavHasSamples(new Uint8Array([1]))).toBe(true);
  expect(wavHasSamples(new TextEncoder().encode("this is not audio at all, but it is long"))).toBe(
    true,
  );
  // RIFF and WAVE, and no data chunk to read a length from.
  const noData = wav(0);
  noData.set(new TextEncoder().encode("junk"), 36);
  expect(wavHasSamples(noData)).toBe(true);
});
