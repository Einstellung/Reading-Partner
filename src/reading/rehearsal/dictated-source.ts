// The on-device TranscriptSource (docs/43, docs/15): iOS transcribes while the
// reader is still talking. SpeechAnalyzer settles one stretch at a time and the
// voice plugin pushes each one out as a `final` event, so the words arrive
// already cut and each one is stamped with the host clock the deck's page
// reports carry — which is all build.ts needs to put a stretch on the page that
// was up when it was said.
//
// Nothing here uploads, orders, retries or holds a key, and the audio never
// leaves the device. cut() is empty for the same reason: a page turn is a
// boundary these timestamps already have (source.ts), and there is no segment
// to close.
//
// The rules:
//   - One utterance per final that carries words. `endedAt` is the moment it
//     arrived, `startedAt` is where the previous one ended, so the stretches
//     tile the run with no gaps and no overlap. The first one starts when the
//     recognizer came up.
//   - volatile, level and timing carry nothing a transcript keeps
//     (applyDictationEvent drops the same three), and a final with no text
//     settles a hypothesis without settling any words. Neither is handed out and
//     neither moves the start of the next stretch.
//   - stop() answers with the whole transcript rather than the tail it flushed
//     (plugins/voice/README.md), so what closes the run is that answer minus
//     what has already gone out. See closingTail.

import { joinSpeech, type DictationEvent, type DictationSource } from "../../ai/voice/dictation";
import type { TranscriptSource, Utterance } from "./source";

// What the closing answer holds that has not been handed out yet.
//
// The measure is the finals already handed out, folded the way the plugin folds
// them for its answer — joinSpeech here, the same rule over the same ranges in
// DictationRun.swift, because the answer never passes through this side's fold.
// Normally the answer opens with exactly that fold and what is left is the
// flushed tail.
//
// When it does not, the match is retried against shorter prefixes until one
// holds, and everything past it goes out as the closing stretch. Two things
// reach that path: the recognizer went back and rewrote a stretch it had
// already settled, or an event was dropped between the two sides. Either way
// the rewritten speech then appears twice in the run — once on the page it was
// first reported to, and once at the end. That is the trade: a page silently
// missing what was said to it is a hole nobody can see, and a sentence that
// reads twice is visibly a sentence that reads twice.
//
// The comparison skips whitespace on both sides, so a seam the two folds space
// differently costs a space rather than the whole transcript.
export function closingTail(handedOut: readonly string[], whole: string): string {
  const said = whole.trim();
  if (!said) return "";
  for (let k = handedOut.length; k >= 0; k--) {
    const at = afterPrefix(said, handedOut.slice(0, k).reduce(joinSpeech, "").trim());
    if (at >= 0) return said.slice(at).trim();
  }
  // The empty prefix matches anything, so k = 0 always answers above.
  return said;
}

const isSpace = (c: string) => /\s/.test(c);

// Where `prefix` ends inside `text`, or -1 when `text` does not open with it.
function afterPrefix(text: string, prefix: string): number {
  let at = 0;
  for (const c of prefix) {
    if (isSpace(c)) continue;
    while (at < text.length && isSpace(text[at])) at++;
    // startsWith/`c.length` rather than an index compare: `c` is a code point,
    // and one outside the BMP is two code units wide. Comparing it against a
    // single unit would never match, and the retreat above would then re-emit
    // everything from that character on.
    if (!text.startsWith(c, at)) return -1;
    at += c.length;
  }
  return at;
}

export interface DictatedSourceOptions {
  // The recognizer. An interface (ai/voice/dictation.ts) rather than a call to
  // nativeDictation(), so every rule above is testable on a machine with no
  // plugin: under bun the host has no dictation at all.
  dictation: DictationSource;
  // Put the microphone out. A rehearsal is a voice mode of its own, and the
  // plugin keeps the audio stack standing between runs on purpose — stopping
  // the recognizer only pauses the engine, and the orange indicator stays lit
  // until something releases it (plugins/voice/README.md). So the run that took
  // the microphone gives it back when it ends. Never rejects.
  release?: () => Promise<void>;
  // The host clock. Defaults to Date.now, which is what the deck listener
  // stamps its page reports with.
  now?: () => number;
}

class DictatedTranscriptSource implements TranscriptSource {
  private readonly dictation: DictationSource;
  private readonly release: (() => Promise<void>) | null;
  private readonly now: () => number;

  private status: "idle" | "starting" | "running" | "stopped" = "idle";
  // The start, once, so both the caller and a stop that overtakes it can wait on
  // the same one.
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  // Whether there is a recognizer to close. A start that failed left nothing
  // running and nothing subscribed.
  private live = false;
  private onUtterance: ((u: Utterance) => void) | null = null;
  // Where the next stretch begins: the end of the last one handed out, and
  // before that the moment the recognizer came up.
  private since = 0;
  // The finals handed out, in the order they arrived. This is the prefix the
  // closing answer is measured against.
  private readonly handedOut: string[] = [];

  constructor(options: DictatedSourceOptions) {
    this.dictation = options.dictation;
    this.release = options.release ?? null;
    this.now = options.now ?? Date.now;
  }

  async start(onUtterance: (u: Utterance) => void): Promise<void> {
    if (this.status !== "idle") return;
    this.status = "starting";
    this.onUtterance = onUtterance;
    this.starting = this.begin();
    await this.starting;
  }

  private async begin(): Promise<void> {
    try {
      await this.dictation.start((e) => this.onEvent(e));
    } catch (e) {
      // The recognizer never came up: nothing is subscribed and nothing has to
      // be closed. The run then records pages and no words, which is a run
      // (source.ts) and not a failure to report.
      this.status = "stopped";
      this.onUtterance = null;
      throw e;
    }
    // Read after the await: the first stretch begins when the recognizer is
    // listening, not when it was asked to listen. Nothing is emitted before this
    // point (plugins/voice/README.md), so no stretch can be stamped from an
    // unset clock.
    this.since = this.now();
    this.live = true;
    // A stop that arrived while this was coming up already owns the source. It
    // is waiting on this promise and takes the teardown from here.
    if (this.status === "starting") this.status = "running";
  }

  // Nothing. The page turn is already in the timestamps.
  cut(): void {}

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    // Never started, or over. Not remembered either: a source stopped before it
    // was started can still be started, and would then have a stop of its own.
    if (this.status === "idle" || this.status === "stopped") return Promise.resolve();
    this.stopping = this.runStop();
    return this.stopping;
  }

  private async runStop(): Promise<void> {
    // Every later caller waits on this same promise: RehearsalView stops the
    // source from an effect cleanup and finishRun awaits it again, and a second
    // call that returned early would let the run be built without the closing
    // stretch in it.
    this.status = "stopped";
    // A stop that overtook the start waits it out rather than racing it. Cutting
    // in front would leave a microphone open behind a view that is already gone,
    // with the orange indicator lit and nothing left to put it out.
    await this.starting?.catch(() => {});
    if (this.live) {
      let whole = "";
      try {
        whole = await this.dictation.stop();
      } catch (e) {
        // The recognizer is down either way, and what it was still holding is
        // what this run loses. Every stretch already handed out stands.
        console.warn("the dictation source failed to stop", e);
      }
      const tail = closingTail(this.handedOut, whole);
      if (tail) this.hand(tail);
    }
    // After the recognizer is closed and whether or not it ever opened: this run
    // asked for the microphone, so the stack goes down here rather than staying
    // up with a lit indicator over a rehearsal that is over.
    await this.release?.().catch(() => {});
    this.onUtterance = null;
  }

  private onEvent(e: DictationEvent): void {
    // A run that is over hands out nothing more: what the recognizer is still
    // holding comes back through stop(), measured against what already went.
    if (e.kind !== "final" || this.status === "stopped") return;
    const text = e.text.trim();
    if (!text) return;
    this.hand(text);
  }

  private hand(text: string): void {
    const at = this.now();
    this.handedOut.push(text);
    const startedAt = this.since;
    this.since = at;
    this.onUtterance?.({ text, startedAt, endedAt: at });
  }
}

export function createDictatedTranscriptSource(options: DictatedSourceOptions): TranscriptSource {
  return new DictatedTranscriptSource(options);
}
