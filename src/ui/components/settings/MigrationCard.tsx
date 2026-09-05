// The button that runs the 0.12 data migration (src/migrate). Nothing else in
// the app calls it: the engine has no startup hook, so this card is the only way
// the migration ever happens.
//
// Two presses, never one. The dry run is what the reader reads before anything
// is written, and the writing button does not exist until they have read it.
//
// Deleted with src/migrate at 0.13.

import { useReducer } from "react";
import { dryRunDataMigration, runDataMigration } from "../../../migrate/live";
import type { MigrationReport } from "../../../migrate/types";
import { Button } from "../ui/button";
import { CARD } from "./cardStyles";
import {
  initialMigrationCardState,
  migrationCardReducer,
  migrationCardView,
  type MigrationCardAction,
} from "./migration-card";

export default function MigrationCard() {
  const [state, dispatch] = useReducer(migrationCardReducer, initialMigrationCardState);
  const view = migrationCardView(state);

  const run = async (
    started: MigrationCardAction,
    work: () => Promise<MigrationReport>,
    finished: (report: MigrationReport) => MigrationCardAction,
  ) => {
    dispatch(started);
    try {
      dispatch(finished(await work()));
    } catch (e) {
      // Verbatim, and in the same block as the report. A migration that failed
      // halfway is diagnosed from what it said, and a swallowed message would
      // leave the reader with data in an unknown shape and nothing to go on.
      dispatch({
        type: "fail",
        message: e instanceof Error ? e.message : String(e) || "Migration failed",
      });
    }
  };

  return (
    <div className={CARD}>
      <p className="m-0 text-xs text-[#777]">
        A one-time repair of data written before 0.12: messages get ids, anchors in observation
        files are fixed, tool-call residue is cleaned out of bodies, and observation ids widen.
        Every file it is about to touch is copied into migration-backups/&lt;timestamp&gt; first.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={view.checkDisabled}
          onClick={() =>
            void run({ type: "check" }, dryRunDataMigration, (report) => ({
              type: "checkDone",
              report,
            }))
          }
        >
          {view.checkLabel}
        </Button>
        {view.showApply && (
          <Button
            type="button"
            disabled={view.applyDisabled}
            onClick={() =>
              void run({ type: "apply" }, runDataMigration, (report) => ({
                type: "applyDone",
                report,
              }))
            }
          >
            {view.applyLabel}
          </Button>
        )}
      </div>

      {view.emptyNote && <p className="m-0 text-xs text-[#777]">{view.emptyNote}</p>}
      {view.backupNote && <p className="m-0 text-xs text-[#777]">{view.backupNote}</p>}
      {view.error && <p className="m-0 text-xs text-[#b91c1c]">{view.error}</p>}
      {view.report && (
        <pre className="m-0 max-h-80 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11px] leading-snug whitespace-pre text-[#333]">
          {view.report}
        </pre>
      )}
    </div>
  );
}
