// Where the words come from. One interface, two shapes of machine behind it.
//
// A run with no source is a legal run, not a broken one. The deck still reports
// its pages, so what lands on disk is the shape of the talk — which page, how
// long — with every transcript empty. That is worth keeping on its own (it says
// where the reader ran long), and a run recorded today reads the same after the
// microphone is wired in. The same rule holds one segment at a time: a stretch
// of speech that fails to transcribe costs that page its words and nothing
// else.

// A stretch of speech and when it was said, on the host clock — the same clock
// the deck's page reports are stamped with, which is what lets build.ts put the
// two streams in one order.
export interface Utterance {
  text: string;
  startedAt: number;
  endedAt: number;
}

export interface TranscriptSource {
  start(onUtterance: (u: Utterance) => void): Promise<void>;
  // The deck turned the page. A source that records and uploads (the desktop,
  // segmented-source.ts) closes the current segment here, which is the only way
  // its transcript ever gets a page boundary: what comes back from STT is one
  // block of text with no timings inside it (docs/43). A source that transcribes
  // as the speech happens — iOS on-device, where every final already carries its
  // own host timestamp — has nothing to cut, and does nothing.
  //
  // Void and never rejects, so a page turn does not have to be awaited by the
  // deck listener that reports it.
  cut(): void;
  stop(): Promise<void>;
}
