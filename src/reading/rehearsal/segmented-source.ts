// The desktop TranscriptSource (docs/43): one continuous recording, cut into
// segments, every segment uploaded on its own.
//
// Desktop STT returns a block of text and nothing else — no word timings, no
// sentence boundaries (parseTranscriptionResponse in ai/voice/stt.ts) — so the
// only timestamps a segment can have are the ones the host put on its two ends.
// The cut has to happen while the reader is still talking, which is why the
// recorder cuts rather than stops: capture never pauses, only the buffer is
// swapped.
//
// The rules here are the rehearsal's, not the microphone's, which is why they
// live in this layer:
//   - 60 seconds cuts, and re-arms. It used to be the fallback behind a page
//     turn; a note turns no pages (docs/44) and this is now the only knife. A
//     talk recorded in one piece would otherwise hand STT a file that keeps
//     growing and be one long upload waited for at the end, and the desktop
//     recorder has a ceiling of its own.
//   - Segments go up as they are cut, not one after another. A ten-page retell
//     spends one upload's wait at the end, not ten.
//   - What comes back out is in the order it was recorded, whatever order the
//     uploads finished in.
//   - A segment that will not transcribe is retried once and then given up on,
//     as empty text. One page loses its words; the run stands.
//   - A page nobody spoke to is not sent at all. It still takes its place in the
//     queue, empty, so the order behind it is untouched.

import type { TranscriptSource, Utterance } from "./source";

// Longest a single segment may run before this source cuts one itself.
export const MAX_SEGMENT_SECONDS = 60;

// Whether a segment has any audio in it. A page the reader turned past without
// speaking cuts a valid WAV with an empty data chunk (recorder.ts, and
// src-tauri/src/voice.rs writes the header either way), and sending that costs
// an upload and a retry to be told there were no words in silence.
//
// The data chunk's declared length is what says so, not the file's size: a
// header-only WAV is 44 bytes today and the number is the encoder's business,
// not this file's. Bytes this cannot read as a WAV at all are sent as they are —
// this skips what it can prove is silent, and guesses at nothing.
export function wavHasSamples(wav: Uint8Array): boolean {
  if (wav.length < 12) return true;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(wav[at], wav[at + 1], wav[at + 2], wav[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return true;
  // Walk the chunks: `data` need not be the first one, and a chunk of odd length
  // is followed by a pad byte.
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "data") return size > 0;
    at += 8 + size + (size % 2);
  }
  return true;
}

// The recording session, as this source uses it (ai/voice/recorder.ts): capture
// starts once and runs to the end of the rehearsal, and a cut hands back what
// has accumulated without interrupting it. An interface rather than an import so
// the whole of this file is testable with no recorder and no microphone.
export interface RecordingSession {
  start(opts?: { maxSegmentSeconds?: number }): Promise<void>;
  // Everything captured since the last cut (or since the start), as WAV bytes.
  // Capture continues.
  cut(): Promise<Uint8Array>;
  // The last segment, and the stream closes.
  stop(): Promise<Uint8Array>;
}

// One segment's audio, transcribed. Injected for the same reason: what this
// costs on the desktop (a key, a config, the app's fetch) is the voice line's
// business and not a rehearsal's.
export type TranscribeSegment = (wav: Uint8Array) => Promise<string>;

// setTimeout, as an injectable pair: it returns the cancel. A test drives the
// 60-second cut without waiting 60 seconds.
export type Schedule = (fn: () => void, ms: number) => () => void;

const realSchedule: Schedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export interface SegmentedSourceOptions {
  session: RecordingSession;
  transcribe: TranscribeSegment;
  // The host clock. Defaults to Date.now, which is what the deck listener stamps
  // its page reports with.
  now?: () => number;
  schedule?: Schedule;
  maxSegmentSeconds?: number;
}

// A segment that has been cut. It takes its place in the output the moment it is
// cut; the text arrives later, and may arrive after a later segment's.
interface Segment {
  startedAt: number;
  endedAt: number;
  text: string;
  settled: boolean;
}

class SegmentedTranscriptSource implements TranscriptSource {
  private readonly session: RecordingSession;
  private readonly transcribe: TranscribeSegment;
  private readonly now: () => number;
  private readonly schedule: Schedule;
  private readonly maxSegmentSeconds: number;

  private status: "idle" | "running" | "stopped" = "idle";
  // The one stop in progress. Every later caller waits on this same promise
  // rather than being told the source is already stopped: the view stops the
  // source from an effect cleanup and again when it writes the run (docs/43),
  // and a second call that returned early would let the run be built while the
  // last segments were still on their way up.
  private stopping: Promise<void> | null = null;
  private onUtterance: ((u: Utterance) => void) | null = null;
  private segmentStartedAt = 0;
  private cancelTimer: (() => void) | null = null;

  // Cut but not yet handed out, oldest first. This is the ordering: a segment
  // takes its place when it is cut, and only the settled prefix is ever emitted.
  private readonly queue: Segment[] = [];
  // Every segment's whole trip, cut through emit. None of them reject.
  private readonly inFlight: Promise<void>[] = [];
  // Cuts reach the recorder one at a time — two overlapping swaps of the same
  // buffer have no defined answer. Only the recorder call is serialized; the
  // upload that follows it is not.
  private recorder: Promise<void> = Promise.resolve();

  constructor(options: SegmentedSourceOptions) {
    this.session = options.session;
    this.transcribe = options.transcribe;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? realSchedule;
    this.maxSegmentSeconds = options.maxSegmentSeconds ?? MAX_SEGMENT_SECONDS;
  }

  async start(onUtterance: (u: Utterance) => void): Promise<void> {
    if (this.status !== "idle") return;
    this.onUtterance = onUtterance;
    // The ceiling the recorder is told about is the one this source keeps, so
    // there is one number and not two.
    await this.session.start({ maxSegmentSeconds: this.maxSegmentSeconds });
    this.status = "running";
    // Read after the await: the first segment starts when capture does, not when
    // it was asked for. A start that throws leaves the source idle, and cut and
    // stop stay no-ops.
    this.segmentStartedAt = this.now();
    this.arm();
  }

  cut(): void {
    if (this.status !== "running") return;
    void this.take((s) => s.cut());
    this.arm();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    // Never started, so there is nothing out and nothing to wait for. Not
    // remembered either: a source stopped before it started can still be
    // started, and would then have a stop of its own to do.
    if (this.status !== "running") return Promise.resolve();
    this.stopping = this.runStop();
    return this.stopping;
  }

  private async runStop(): Promise<void> {
    this.status = "stopped";
    this.disarm();
    // The last segment is a segment: what was said to the page that was up when
    // the reader finished is that page's, same as every other.
    void this.take((s) => s.stop());
    // Every upload still out, including ones cut minutes ago. A caller that
    // awaits this has the whole transcript when it returns.
    await Promise.all(this.inFlight);
    this.onUtterance = null;
  }

  // Close the current segment and send it. The timestamps are read here, in the
  // synchronous part: the cut belongs to the moment the page turned, not to the
  // moment the recorder got round to answering.
  private take(from: (s: RecordingSession) => Promise<Uint8Array>): Promise<void> {
    const at = this.now();
    const segment: Segment = {
      startedAt: this.segmentStartedAt,
      endedAt: at,
      text: "",
      settled: false,
    };
    this.segmentStartedAt = at;
    this.queue.push(segment);

    const audio = this.recorder.then(() => from(this.session));
    // The chain carries on past a failed cut: that segment is the one that loses
    // its words, not every segment behind it.
    this.recorder = audio.then(
      () => {},
      () => {},
    );
    const trip = audio
      .then(
        // Silence settles as empty text without leaving the machine. The segment
        // keeps its place in the queue, so the pages behind it come out where
        // they were spoken.
        (wav) => (wavHasSamples(wav) ? this.transcribeOnce(wav) : ""),
        // No audio came back. There is nothing to send and nothing to retry.
        () => "",
      )
      .then((text) => {
        segment.text = text;
        segment.settled = true;
        this.flush();
      });
    this.inFlight.push(trip);
    return trip;
  }

  // One retry. The audio is already in hand, so a blip on the way out costs a
  // second attempt rather than a page's words. A second failure is the page's
  // words.
  private async transcribeOnce(wav: Uint8Array): Promise<string> {
    try {
      return await this.transcribe(wav);
    } catch {
      // Fall through to the retry.
    }
    try {
      return await this.transcribe(wav);
    } catch {
      return "";
    }
  }

  // Hand out everything at the head of the queue that has come back. A segment
  // still in flight holds up the ones behind it, which is the point: the
  // transcript is read as prose, in the order it was spoken.
  private flush(): void {
    while (this.queue.length > 0 && this.queue[0].settled) {
      const segment = this.queue.shift() as Segment;
      this.onUtterance?.({
        text: segment.text,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      });
    }
  }

  private arm(): void {
    this.disarm();
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      this.cut();
    }, this.maxSegmentSeconds * 1_000);
  }

  private disarm(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}

export function createSegmentedTranscriptSource(options: SegmentedSourceOptions): TranscriptSource {
  return new SegmentedTranscriptSource(options);
}
