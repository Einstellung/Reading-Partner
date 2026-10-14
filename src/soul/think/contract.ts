// What a voice call's front hands to the back half, and what it gets back
// (docs/companion/136: 后台, 落盒, 文本检查点, 并行与取消).
//
// The front (soul/voice) talks; anything it cannot answer in two sentences it
// hands over here and goes back to the person. This module is the whole of the
// seam between the two halves. Import it from `soul/think` (index.ts):
//
//   callBackend(): CallBackend                  the app's one instance
//
//   dispatch({ callId, task, follows?, deliverTo, kind? })
//     -> { ok: true, n, runId, replaced? } | { ok: false, reason }
//       Starts a run (kind `think` unless named) and numbers it within the
//       call, from 1. `deliverTo` is where the call is held — the program fills
//       it, never the model. `follows` is an earlier number: if that task is
//       still running it is cancelled and this one replaces it (a change of
//       mind; `replaced` says which); if it came back, its task and output are
//       attached to the new brief. More than MAX_IN_FLIGHT running is refused,
//       and so is a `follows` that names nothing.
//   cancel(callId, n) -> { ok: true } | { ok: false, reason }
//       The run goes `cancelled`: no box item, no line in the conversation.
//       Hanging up cancels nothing.
//   tasks(callId) -> CallTask[]
//       The call's numbered list, for the front's context: one line of task,
//       state, the run's progress line, and the cover once it came back.
//       Synchronous; progress is refreshed whenever the runner writes.
//   subscribe(callId, fn: (note: CallNote) => void) -> undo
//       Told once per task when it came back (after the text is in the
//       conversation and the box) or failed. A cancelled task is not told.
//   text(callId, n) -> string | null
//       The output itself, for read_out: the same text the conversation and
//       the box item hold. Null until it came back.
//   told(callId, n) -> boolean
//       Marks the task's box item `told` (read out to the end, or opened).
//       False when there is no item yet. An interrupted read-out does not call
//       this; the item stays `in box`.
//
// The ledger is in memory: a call lives in one process, and what outlives it —
// the run's output, the line in the conversation, the box item — is on disk.

import type { BoxOrigin } from "../../box";

/** The kind a voice call hands its hard questions to. Registered in kind.ts. */
export const THINK_KIND = "think";

/** How many of one call's tasks may be running at once (136's starting value). */
export const MAX_IN_FLIGHT = 3;

export type CallTaskState = "running" | "done" | "failed" | "cancelled";

/** One line of the call's numbered list. */
export interface CallTask {
  /** The number the front says aloud. From 1, per call, never reused. */
  n: number;
  runId: string;
  kind: string;
  /** The brief's first sentence. */
  task: string;
  /** The number this one followed on from or replaced. */
  follows?: number;
  state: CallTaskState;
  /** The run's last progress line. */
  progress?: string;
  /** Set once it came back: the output's first sentence, the box item's cover. */
  cover?: string;
  /** Set when it failed: why, as the runner put it. */
  reason?: string;
  /** The Red Box item it landed as. */
  boxItemId?: string;
  /** Its box item has been marked `told`. */
  told: boolean;
}

export interface DispatchInput {
  callId: string;
  /** The brief, written for someone who cannot hear the call. */
  task: string;
  follows?: number;
  /** Where the call is held. The run's answer goes back there. */
  deliverTo: BoxOrigin;
  /** A delegable kind. `think` when absent. */
  kind?: string;
}

export type Dispatched =
  | { ok: true; n: number; runId: string; replaced?: number }
  | { ok: false; reason: string };

/** What the front is told when a task comes back or fails. */
export type CallNote =
  | { callId: string; n: number; task: string; status: "done"; cover: string }
  | { callId: string; n: number; task: string; status: "failed"; reason: string };

export type Cancelled = { ok: true } | { ok: false; reason: string };

export interface CallBackend {
  dispatch(input: DispatchInput): Promise<Dispatched>;
  cancel(callId: string, n: number): Promise<Cancelled>;
  tasks(callId: string): CallTask[];
  subscribe(callId: string, fn: (note: CallNote) => void): () => void;
  text(callId: string, n: number): Promise<string | null>;
  told(callId: string, n: number): Promise<boolean>;
}
