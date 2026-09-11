// What a turn is doing while it runs, as an event rather than as a list (M6's
// tool trace is the list; see tool-status.ts). A tool call going out and coming
// back is the one thing about a turn that is observable without asking the model
// for it, which is what a companion body reads to decide whether the soul is
// looking at the reader or at the desk (docs/66 "四段").
//
// It sits in the capability every caller already depends on, for the reason the
// tool trace does: this describes what the agent did, not what is drawn from it.
// Nothing here imports a domain, and the domains that emit it — the voice call
// today — carry it to whichever surface subscribes.

/**
 * One thing a turn started or finished. `name` is the tool's name as the model
 * called it; a `start` is always followed by an `end` of the same name, and a
 * driver that drops a turn mid-tool is expected to close what it opened rather
 * than leave the count hanging.
 */
export interface TurnActivity {
  kind: "tool";
  name: string;
  phase: "start" | "end";
}

/** Told about a turn's activity. Returns the unsubscribe where it is a stream. */
export type TurnActivityListener = (event: TurnActivity) => void;
