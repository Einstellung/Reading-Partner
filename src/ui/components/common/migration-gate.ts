// The observation move, as the thing standing between the reader and the app.
//
// Observations used to live one directory per topic and now live in one
// observations/ (docs/48). The move is destructive and there is no compatibility
// path: a device whose disk still holds the old layout would go on writing new
// records beside files nothing reads, so while the old layout is there the app
// is not usable and the reader has to run the move.
//
// The judgement is needsMigration(), the same one the nightly pass stands down
// on (migrate/pending.ts). Asked at start-up and again at the end of every sync
// pass, because the answer can go back to true without this device doing
// anything: a machine still on the old build can hand it a memory-<topicId>/
// directory. Never on a timer — nothing else changes the answer.
//
// The run itself reuses the settings card's state machine
// (settings/migration-card.ts) rather than growing a second one: one press here
// is the two presses there, a dry run and then the apply it authorises, so the
// block on screen says what is being applied while it runs. What is different is
// the way out — the card is a card and can be left alone, this lets go only when
// needsMigration() answers false.
//
// Everything below is either pure or takes its filesystem and its sync as
// arguments, so the rules are testable without a window (the .tsx renders and
// nothing else).

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { appDataMigrationFs, dryRunDataMigration, runDataMigration } from "../../../migrate/live";
import { needsMigration } from "../../../migrate/pending";
import { totalChanges, type MigrationReport } from "../../../migrate/types";
import { subscribeSyncStatus } from "../../../platform/sync";
import {
  initialMigrationCardState,
  migrationCardReducer,
  migrationCardView,
  type MigrationCardState,
} from "../settings/migration-card";

// What the gate knows about the disk. "unknown" is the window before the first
// answer, which is not the same as "clear": the app draws normally through it,
// because the check is two directory listings and a shell held blank on every
// launch to insure against a layout almost no device has is a worse trade.
export type MigrationGateStatus = "unknown" | "clear" | "blocked";

export const MIGRATION_GATE_MESSAGE =
  "Your notes need a one-time update before reading can continue.";

// Said only when the run has finished and the old layout is still on disk. The
// report below it is the detail; this is the sentence that says the app is still
// shut.
export const MIGRATION_GATE_INCOMPLETE =
  "The update ran and the old files are still there. Read the report below and try again.";

// Same, for a dry run that found nothing to do while the old layout is still
// there. Distinct from the one above because nothing was written: what the
// reader has is not a half-finished run but a disagreement between two readings
// of their own disk, and a report worth sending on rather than repeating.
export const MIGRATION_GATE_NOTHING_FOUND =
  "The update found nothing to change and the old files are still there. Read the report below and try again.";

export interface MigrationGateView {
  // Whether the sheet is on screen at all. Everything else is what it says
  // while it is.
  visible: boolean;
  message: string;
  buttonLabel: string;
  buttonDisabled: boolean;
  report: string | null;
  error: string | null;
  // Why the gate is still up after a run that finished.
  incompleteNote: string | null;
  backupNote: string | null;
}

// Everything the sheet renders, from the two pieces of state it has.
//
// The labels are the whole of the reader's model of it: an attempt that has
// already happened says "Try again" rather than repeating an offer they have
// taken, and a run in flight says which half of it is running — the dry run
// reads the store, the apply writes it, and on a large store they are minutes
// apart.
export function migrationGateView(
  status: MigrationGateStatus,
  run: MigrationCardState,
): MigrationGateView {
  const card = migrationCardView(run);
  const busy = run.phase === "checking" || run.phase === "applying";
  // A run that ended without clearing the gate. "checked" counts: the press does
  // the dry run and the apply in one go, so a state that stopped at "checked" is
  // a dry run that found nothing to apply.
  const settled = run.phase === "checked" || run.phase === "applied" || run.phase === "failed";
  return {
    visible: status === "blocked",
    message: MIGRATION_GATE_MESSAGE,
    buttonLabel:
      run.phase === "checking"
        ? "Checking…"
        : run.phase === "applying"
          ? "Updating…"
          : settled
            ? "Try again"
            : "Update now",
    buttonDisabled: busy,
    report: card.report,
    error: card.error,
    incompleteNote:
      run.phase === "applied"
        ? MIGRATION_GATE_INCOMPLETE
        : run.phase === "checked" && totalChanges(run.report) === 0
          ? MIGRATION_GATE_NOTHING_FOUND
          : null,
    backupNote: card.backupNote,
  };
}

// Whether a sync status emit is the end of a pass. The engine emits on every
// change of its own state, so the edge is what says a pass finished — an emit
// with running already false is the same status arriving again.
export function syncPassEnded(wasRunning: boolean, isRunning: boolean): boolean {
  return wasRunning && !isRunning;
}

// Whether that end is worth asking the disk about. Only from "clear": "blocked"
// is already the answer this would produce, and asking under a run in flight
// would race the run's own re-check to setStatus.
export function recheckAfterSync(
  status: MigrationGateStatus,
  wasRunning: boolean,
  isRunning: boolean,
): boolean {
  return status === "clear" && syncPassEnded(wasRunning, isRunning);
}

// The three async things the gate does, taken as an argument so the rules above
// can be exercised without the host and without rewriting the module registry
// (pitfall 119).
export interface MigrationGateDeps {
  check: () => Promise<boolean>;
  dryRun: () => Promise<MigrationReport>;
  apply: () => Promise<MigrationReport>;
  onSyncStatus: (cb: (status: { running: boolean }) => void) => () => void;
}

export const LIVE_MIGRATION_GATE: MigrationGateDeps = {
  check: () => needsMigration(appDataMigrationFs),
  dryRun: dryRunDataMigration,
  apply: runDataMigration,
  onSyncStatus: subscribeSyncStatus,
};

export interface MigrationGate {
  view: MigrationGateView;
  start: () => void;
}

export function useMigrationGate(deps: MigrationGateDeps = LIVE_MIGRATION_GATE): MigrationGate {
  const [status, setStatus] = useState<MigrationGateStatus>("unknown");
  const [run, dispatch] = useReducer(migrationCardReducer, initialMigrationCardState);
  // Read inside the sync subscription, which is registered once and must not be
  // torn down and rebuilt every time the answer changes.
  const statusRef = useRef(status);
  statusRef.current = status;

  const check = useCallback(() => {
    deps
      .check()
      .then((owed) => setStatus(owed ? "blocked" : "clear"))
      // A check that could not be made is not a reason to shut the app: the two
      // listings behind it answer [] for a directory that is not there, so a
      // throw here is the host failing, and a reader locked out by that has no
      // way back in.
      .catch(() => setStatus("clear"));
  }, [deps]);

  useEffect(check, [check]);

  useEffect(() => {
    let running = false;
    return deps.onSyncStatus((next) => {
      const recheck = recheckAfterSync(statusRef.current, running, next.running);
      running = next.running;
      if (recheck) check();
    });
  }, [deps, check]);

  const start = useCallback(() => {
    void (async () => {
      dispatch({ type: "check" });
      try {
        const dry = await deps.dryRun();
        dispatch({ type: "checkDone", report: dry });
        if (totalChanges(dry) > 0) {
          dispatch({ type: "apply" });
          dispatch({ type: "applyDone", report: await deps.apply() });
        }
      } catch (e) {
        // Verbatim, beside the report, for the reason the card gives: a run that
        // failed halfway is diagnosed from what it said.
        dispatch({
          type: "fail",
          message: e instanceof Error ? e.message : String(e) || "Migration failed",
        });
      }
      // Asked again either way, including after a failure: what lets the reader
      // through is the disk, never the fact that a run reported success.
      try {
        setStatus((await deps.check()) ? "blocked" : "clear");
      } catch {
        // The gate stays where it is. Unlike the start-up check, there is a
        // reader in front of it with a button to press again.
      }
    })();
  }, [deps]);

  return { view: migrationGateView(status, run), start };
}
