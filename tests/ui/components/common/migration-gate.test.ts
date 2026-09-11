// The migration gate's rules (src/ui/components/common/migration-gate.ts): when
// the cover is on screen, what one press does, and when the answer is asked for
// again.
//
// The gate is the only thing in the app that can make it unusable, so what these
// assert is both directions: it is up while the old layout is on disk, and it is
// gone the moment it is not — including the paths where the run itself failed.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  MIGRATION_GATE_INCOMPLETE,
  MIGRATION_GATE_MESSAGE,
  MIGRATION_GATE_NOTHING_FOUND,
  migrationGateView,
  recheckAfterSync,
  syncPassEnded,
} from "../../../../src/ui/components/common/migration-gate";
import {
  initialMigrationCardState,
  migrationCardReducer,
  type MigrationCardAction,
  type MigrationCardState,
} from "../../../../src/ui/components/settings/migration-card";
import { emptyStep, type MigrationReport } from "../../../../src/migrate/types";

function report({
  changed = 4,
  ...over
}: Partial<MigrationReport> & { changed?: number } = {}): MigrationReport {
  const step = emptyStep("flatten", "observation directories flattened");
  step.scanned = 9;
  step.changed = changed;
  step.skipped = 9 - changed;
  return { dryRun: true, backupDir: null, steps: [step], written: [], removed: [], ...over };
}

const run = (...actions: MigrationCardAction[]): MigrationCardState =>
  actions.reduce(migrationCardReducer, initialMigrationCardState);

test("nothing is on screen until the check has answered", () => {
  expect(migrationGateView("unknown", initialMigrationCardState).visible).toBe(false);
});

test("a clear disk draws nothing at all", () => {
  expect(migrationGateView("clear", initialMigrationCardState).visible).toBe(false);
});

test("the old layout puts the sheet up with one offer on it", () => {
  const view = migrationGateView("blocked", initialMigrationCardState);
  expect(view.visible).toBe(true);
  expect(view.message).toBe(MIGRATION_GATE_MESSAGE);
  expect(view.buttonLabel).toBe("Update now");
  expect(view.buttonDisabled).toBe(false);
  expect(view.report).toBeNull();
  expect(view.error).toBeNull();
  expect(view.incompleteNote).toBeNull();
});

test("the dry run and the apply say which of them is running, and neither can be pressed", () => {
  const checking = migrationGateView("blocked", run({ type: "check" }));
  expect(checking.buttonLabel).toBe("Checking…");
  expect(checking.buttonDisabled).toBe(true);

  const applying = migrationGateView(
    "blocked",
    run({ type: "check" }, { type: "checkDone", report: report() }, { type: "apply" }),
  );
  expect(applying.buttonLabel).toBe("Updating…");
  expect(applying.buttonDisabled).toBe(true);
  // What is being applied stays on screen while it is applied.
  expect(applying.report).toContain("observation directories flattened");
});

test("a run that finished with the gate still up says so and offers another go", () => {
  const view = migrationGateView(
    "blocked",
    run(
      { type: "check" },
      { type: "checkDone", report: report() },
      { type: "apply" },
      {
        type: "applyDone",
        report: report({ dryRun: false, backupDir: "migration-backups/2026-09-06" }),
      },
    ),
  );
  expect(view.visible).toBe(true);
  expect(view.buttonLabel).toBe("Try again");
  expect(view.buttonDisabled).toBe(false);
  expect(view.incompleteNote).toBe(MIGRATION_GATE_INCOMPLETE);
  expect(view.backupNote).toContain("migration-backups/2026-09-06");
  expect(view.report).toContain("MIGRATION RUN");
});

test("a dry run that found nothing while the old layout is there is its own sentence", () => {
  const view = migrationGateView(
    "blocked",
    run({ type: "check" }, { type: "checkDone", report: report({ changed: 0 }) }),
  );
  expect(view.incompleteNote).toBe(MIGRATION_GATE_NOTHING_FOUND);
  expect(view.buttonLabel).toBe("Try again");
  expect(view.report).toContain("DRY RUN");
});

test("a failed run keeps the message it failed with", () => {
  const view = migrationGateView(
    "blocked",
    run({ type: "check" }, { type: "fail", message: "read observations/index.md: os error 2" }),
  );
  expect(view.error).toBe("read observations/index.md: os error 2");
  expect(view.buttonLabel).toBe("Try again");
  expect(view.buttonDisabled).toBe(false);
  // No claim that anything ran: nothing is what a failed dry run leaves behind.
  expect(view.incompleteNote).toBeNull();
});

test("a run that cleared the disk takes the whole sheet with it", () => {
  const view = migrationGateView(
    "clear",
    run(
      { type: "check" },
      { type: "checkDone", report: report() },
      { type: "apply" },
      { type: "applyDone", report: report({ dryRun: false }) },
    ),
  );
  expect(view.visible).toBe(false);
});

test("the end of a pass is the edge, not the emit", () => {
  expect(syncPassEnded(true, false)).toBe(true);
  // The status the engine repeats while it is idle, and the one it emits when a
  // pass starts.
  expect(syncPassEnded(false, false)).toBe(false);
  expect(syncPassEnded(false, true)).toBe(false);
  expect(syncPassEnded(true, true)).toBe(false);
});

test("only a device that believed it was clear asks the disk again", () => {
  expect(recheckAfterSync("clear", true, false)).toBe(true);
  // Already up: the answer this would produce is the one already on screen, and
  // asking under a run in flight would race that run's own re-check.
  expect(recheckAfterSync("blocked", true, false)).toBe(false);
  // The first check has not answered yet; it is about to.
  expect(recheckAfterSync("unknown", true, false)).toBe(false);
  expect(recheckAfterSync("clear", false, false)).toBe(false);
});
