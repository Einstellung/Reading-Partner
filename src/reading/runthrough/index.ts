// PLACEHOLDER — the real module is being written in parallel (docs/31, the third
// of the three stages: giving the talk). It exists so the run-through view can be written
// and type-checked against the agreed surface; every function here is a no-op and
// is meant to be replaced wholesale, not extended. Nothing in it is tested,
// because there is nothing here to be right or wrong about.
//
// A run-through is one pass through a built deck: which page the reader was on,
// when they got there, when they left, and (later) what they said while they were
// there. The view records; nothing reads it back yet except the list beside the
// outline.

export const RUNTHROUGH_VERSION = 1 as const;

// One page of one run: entered when the deck reported it, left when the next
// page was reported (null while it is still the page on screen).
export interface RunthroughPage {
  index: number;
  kind: string;
  title: string;
  enteredAt: number;
  leftAt: number | null;
  transcript: string;
}

export interface RunthroughRun {
  id: string;
  ordinal: number;
  talkId: string;
  deckFile: string | null;
  startedAt: number;
  endedAt: number | null;
  pages: RunthroughPage[];
}

export interface RunthroughLog {
  version: typeof RUNTHROUGH_VERSION;
  talkId: string;
  runs: RunthroughRun[];
}

// What the host records as it happens, in order. The host timestamps everything:
// the deck reports position, not time.
export type RunthroughEvent =
  | { kind: "slide"; at: number; index: number; slideKind: string; title: string }
  | { kind: "utterance"; at: number; endedAt: number; text: string }
  | { kind: "end"; at: number };

// Speech, if there is any. The run-through view takes one as an optional prop and
// starts and stops it around the run; this round ships no implementation.
export interface TranscriptSource {
  start(onUtterance: (u: { text: string; startedAt: number; endedAt: number }) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface BuildRunInput {
  id: string;
  ordinal: number;
  talkId: string;
  deckFile: string | null;
  startedAt: number;
  events: RunthroughEvent[];
}

export function buildRun(input: BuildRunInput): RunthroughRun {
  return {
    id: input.id,
    ordinal: input.ordinal,
    talkId: input.talkId,
    deckFile: input.deckFile,
    startedAt: input.startedAt,
    endedAt: null,
    pages: [],
  };
}

export function loadRunthroughs(talkId: string): Promise<RunthroughLog> {
  return Promise.resolve({ version: RUNTHROUGH_VERSION, talkId, runs: [] });
}

// The ordinal ("which pass through this talk is this") is the store's to assign.
export function appendRun(run: RunthroughRun): Promise<RunthroughRun> {
  return Promise.resolve(run);
}

export interface RunSummary {
  ordinal: number;
  startedAt: number;
  minutes: number;
  pagesTotal: number;
  pagesSpoken: number;
  wordsSpoken: number;
}

export function runSummary(run: RunthroughRun): RunSummary {
  return {
    ordinal: run.ordinal,
    startedAt: run.startedAt,
    minutes: 0,
    pagesTotal: 0,
    pagesSpoken: 0,
    wordsSpoken: 0,
  };
}
