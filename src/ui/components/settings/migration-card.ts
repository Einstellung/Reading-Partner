// What the 0.12 migration card is showing, as a state machine over the two
// calls it can make. Separated from the card because the ordering rules are the
// whole substance of it: a dry run has to precede a real one, a result that
// arrives after the reader moved on must not land on screen, and "is there
// anything to apply" is a fact about the last dry run rather than a flag.
//
// Deleted with src/migrate in a later release (kept through 0.13).

import { formatReport } from "../../../migrate/run";
import { totalChanges, type MigrationReport } from "../../../migrate/types";

export type MigrationCardState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "checked"; report: MigrationReport }
  // The dry run that authorised this apply is carried along, so the block on
  // screen keeps saying what is being applied while it runs.
  | { phase: "applying"; report: MigrationReport }
  | { phase: "applied"; report: MigrationReport }
  | { phase: "failed"; message: string };

export type MigrationCardAction =
  | { type: "check" }
  | { type: "checkDone"; report: MigrationReport }
  | { type: "apply" }
  | { type: "applyDone"; report: MigrationReport }
  | { type: "fail"; message: string };

export const initialMigrationCardState: MigrationCardState = { phase: "idle" };

// Every transition. An action that does not belong in the current phase leaves
// the state alone rather than throwing: both calls are in flight somewhere, and
// a stale resolution is a normal event, not a bug to crash on.
export function migrationCardReducer(
  state: MigrationCardState,
  action: MigrationCardAction,
): MigrationCardState {
  switch (action.type) {
    case "check":
      // Not from checking or applying: a second run while one is in flight would
      // race two passes over the same files.
      return state.phase === "checking" || state.phase === "applying"
        ? state
        : { phase: "checking" };
    case "checkDone":
      return state.phase === "checking" ? { phase: "checked", report: action.report } : state;
    case "apply":
      // Only ever after a dry run that found something. Writing is gated on a
      // report the reader has seen, not on a button being visible.
      return state.phase === "checked" && totalChanges(state.report) > 0
        ? { phase: "applying", report: state.report }
        : state;
    case "applyDone":
      return state.phase === "applying" ? { phase: "applied", report: action.report } : state;
    case "fail":
      return state.phase === "checking" || state.phase === "applying"
        ? { phase: "failed", message: action.message }
        : state;
  }
}

// Everything the card renders, so the .tsx holds no conditions of its own.
export interface MigrationCardView {
  checkLabel: string;
  checkDisabled: boolean;
  // The apply button is absent, not disabled, wherever applying is not a thing
  // the reader may do — including after a run, where the next step is another
  // check.
  showApply: boolean;
  applyLabel: string;
  applyDisabled: boolean;
  // The report block, already formatted.
  report: string | null;
  error: string | null;
  // Set when a dry run found nothing, which is also the state a second run
  // leaves the data in.
  emptyNote: string | null;
  backupNote: string | null;
}

export function migrationCardView(state: MigrationCardState): MigrationCardView {
  const busy = state.phase === "checking" || state.phase === "applying";
  return {
    checkLabel: state.phase === "checking" ? "Checking…" : "Check what would change",
    checkDisabled: busy,
    showApply:
      state.phase === "applying" || (state.phase === "checked" && totalChanges(state.report) > 0),
    applyLabel: state.phase === "applying" ? "Applying…" : "Apply migration",
    applyDisabled: busy,
    // A re-check clears the block: the previous report describes data that is
    // about to be described again, and leaving it up would date it silently.
    report:
      state.phase === "checked" || state.phase === "applying" || state.phase === "applied"
        ? formatReport(state.report)
        : null,
    error: state.phase === "failed" ? state.message : null,
    emptyNote:
      state.phase === "checked" && totalChanges(state.report) === 0 ? "Nothing to migrate." : null,
    backupNote:
      state.phase === "applied" && state.report.backupDir
        ? `Backup written to ${state.report.backupDir}`
        : null,
  };
}
