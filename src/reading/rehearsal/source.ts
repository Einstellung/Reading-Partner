// Where the words come from. One interface, two shapes of machine behind it.
//
// A run with no source is a legal run, not a broken one. What lands on disk is
// then the shape of the pass — when it started, how long it ran — with the
// transcript empty, and a run recorded today reads the same after the microphone
// is wired in. The same rule holds one segment at a time: a stretch of speech
// that fails to transcribe costs the pass those words and nothing else.

// A stretch of speech and when it was said, on the host clock — the same clock
// the pass event is stamped with (rehearsal.ts, passEvent), which is what lets
// build.ts put the two streams in one order.
export interface Utterance {
  text: string;
  startedAt: number;
  endedAt: number;
}

export interface TranscriptSource {
  start(onUtterance: (u: Utterance) => void): Promise<void>;
  // Close the segment being recorded and send it. A source that records and
  // uploads (the desktop, segmented-source.ts) has to break the recording up
  // somewhere: what comes back from STT is one block of text with no timings
  // inside it (docs/43), so an hour recorded in one piece is an hour of upload
  // waited for at the end. A source that transcribes as the speech happens —
  // iOS on-device, where every final already carries its own host timestamp —
  // has nothing to cut, and does nothing.
  //
  // Nothing outside a source calls this any more: the note the reader talks from
  // turns no pages (docs/44), which leaves segmented-source.ts cutting on its
  // own ceiling and nothing else.
  //
  // Void and never rejects, so a caller does not have to await a cut.
  cut(): void;
  stop(): Promise<void>;
}
