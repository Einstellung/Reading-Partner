// Where the words come from. Declared here and implemented elsewhere: the
// streaming ASR this needs is the voice line's (docs/27, docs/33), and hooking
// it up is not part of recording a run-through.
//
// A run with no source is a legal run, not a broken one. The deck still reports
// its pages, so what lands on disk is the shape of the talk — which page, how
// long — with every transcript empty. That is worth keeping on its own (it says
// where the reader ran long), and a run recorded today reads the same after the
// microphone is wired in.

export interface TranscriptSource {
  start(
    onUtterance: (u: { text: string; startedAt: number; endedAt: number }) => void,
  ): Promise<void>;
  stop(): Promise<void>;
}
