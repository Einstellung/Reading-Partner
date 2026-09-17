// What is in a Red Box (docs/60).
//
// A box is one delivery — a legion batch, or a single run — and an item is one
// thing that delivery put in front of the reader: a run's output today, a cable
// once the pipeline lands. The box itself is not stored. Whether a box is open
// is read off the states of the items in it, so there is no second mutable file
// for two devices to disagree about (docs/59's lesson, restated in docs/60).
//
// One item is one file. The cover is written when the item is born and never
// revised; the item's own file is the only thing that changes, and what changes
// on it is the state.

/**
 * Where an item stands with the reader. `in-box`, `told` and `asked` are open;
 * the five below them are exits, and an exit is final — the reader is done with
 * the item however it left. `told` and `aggregated` are not exclusive: the box
 * has two consumers, the secretary who tells and the run that writes it up.
 */
export type BoxItemState =
  | "in-box"
  | "told"
  | "asked"
  | "dismissed"
  | "saved"
  | "promoted"
  | "folded"
  | "aggregated";

export const BOX_ITEM_STATES = [
  "in-box",
  "told",
  "asked",
  "dismissed",
  "saved",
  "promoted",
  "folded",
  "aggregated",
] as const satisfies readonly BoxItemState[];

const EXITS = new Set<string>(["dismissed", "saved", "promoted", "folded", "aggregated"]);
const OPEN = new Set<string>(["in-box", "told", "asked"]);

/** Whether the reader is done with an item in this state. */
export function isExit(state: BoxItemState): boolean {
  return EXITS.has(state);
}

/** Whether the item is still one of the ones the reader has not got to. */
export function isOpen(state: BoxItemState): boolean {
  return OPEN.has(state);
}

/** Whether a string off a file is one of the eight states. */
export function isBoxItemState(value: unknown): value is BoxItemState {
  return typeof value === "string" && (EXITS.has(value) || OPEN.has(value));
}

/**
 * What put the item in the box. A `run` is a delegated piece of work coming
 * back and a `cable` is the pipeline's; a `turn` is the reader's own question,
 * answered while they were looking at something else (docs/68).
 */
export type BoxItemSource = "run" | "cable" | "turn";

/** Whether a string off a file is one of the three. */
export function isBoxSource(value: unknown): value is BoxItemSource {
  return value === "run" || value === "cable" || value === "turn";
}

/** Where the item came from, in the reader's terms: what they were doing. */
export type BoxOrigin =
  | { place: "book"; bookId: string; threadId: string; annotationId?: string; page?: number }
  | { place: "door"; date: string }
  | { place: "briefing"; date: string };

export interface BoxItem {
  id: string;
  /** The delivery this item arrived in: a legion batchId, or a lone runId. */
  boxId: string;
  source: BoxItemSource;
  /** One line, written once. */
  cover: string;
  /** A reference to the full body (a run's output path). Never the text. */
  body?: string;
  origin: BoxOrigin;
  kind?: string;
  runId?: string;
  /** The reader has to decide something (a failed run, a worker that could not tell). */
  needsDecision: boolean;
  createdAt: number;
  state: BoxItemState;
  stateAt: number;
  /** Bumped on every write; the tie-break when two devices wrote the same item. */
  revision: number;
}
