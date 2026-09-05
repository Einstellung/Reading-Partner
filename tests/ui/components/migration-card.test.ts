// The 0.12 migration card's state machine
// (src/ui/components/settings/migration-card.ts): what the two buttons say, when
// the second one exists at all, and which results are allowed to land on screen.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  initialMigrationCardState,
  migrationCardReducer,
  migrationCardView,
  type MigrationCardAction,
  type MigrationCardState,
} from "../../../src/ui/components/settings/migration-card";
import { emptyStep, type MigrationReport } from "../../../src/migrate/types";

function report({
  changed = 3,
  ...over
}: Partial<MigrationReport> & { changed?: number } = {}): MigrationReport {
  const step = emptyStep("message-ids", "message ids backfilled");
  step.scanned = 10;
  step.changed = changed;
  step.skipped = 10 - changed;
  return {
    dryRun: true,
    backupDir: null,
    steps: [step],
    written: [],
    removed: [],
    ...over,
  };
}

const run = (state: MigrationCardState, ...actions: MigrationCardAction[]): MigrationCardState =>
  actions.reduce(migrationCardReducer, state);

test("nothing is offered but the check before anything has run", () => {
  const view = migrationCardView(initialMigrationCardState);
  expect(view.checkLabel).toBe("Check what would change");
  expect(view.checkDisabled).toBe(false);
  expect(view.showApply).toBe(false);
  expect(view.report).toBeNull();
  expect(view.error).toBeNull();
  expect(view.emptyNote).toBeNull();
});

test("a check in flight disables its own button and says so", () => {
  const view = migrationCardView(run(initialMigrationCardState, { type: "check" }));
  expect(view.checkLabel).toBe("Checking…");
  expect(view.checkDisabled).toBe(true);
  expect(view.showApply).toBe(false);
  expect(view.report).toBeNull();
});

test("a dry run with changes shows the report and offers the apply", () => {
  const view = migrationCardView(
    run(initialMigrationCardState, { type: "check" }, { type: "checkDone", report: report() }),
  );
  expect(view.report).toContain("DRY RUN");
  expect(view.report).toContain("message ids backfilled");
  expect(view.showApply).toBe(true);
  expect(view.applyLabel).toBe("Apply migration");
  expect(view.applyDisabled).toBe(false);
  expect(view.emptyNote).toBeNull();
});

test("a dry run with nothing to do says so and offers no apply", () => {
  const view = migrationCardView(
    run(
      initialMigrationCardState,
      { type: "check" },
      { type: "checkDone", report: report({ changed: 0 }) },
    ),
  );
  expect(view.emptyNote).toBe("Nothing to migrate.");
  expect(view.showApply).toBe(false);
  expect(view.report).toContain("DRY RUN");
});

test("an aborted step reaches the reader through the report block", () => {
  const aborted = report();
  aborted.steps[0]!.aborted = "two ids derive to one file";
  const view = migrationCardView(
    run(initialMigrationCardState, { type: "check" }, { type: "checkDone", report: aborted }),
  );
  expect(view.report).toContain("ABORTED: two ids derive to one file");
});

test("applying keeps the dry run on screen and disables both buttons", () => {
  const view = migrationCardView(
    run(
      initialMigrationCardState,
      { type: "check" },
      { type: "checkDone", report: report() },
      { type: "apply" },
    ),
  );
  expect(view.applyLabel).toBe("Applying…");
  expect(view.applyDisabled).toBe(true);
  expect(view.checkDisabled).toBe(true);
  expect(view.showApply).toBe(true);
  expect(view.report).toContain("DRY RUN");
});

test("a finished run replaces the block, names the backup, and retires the apply", () => {
  const done = report({
    dryRun: false,
    backupDir: "migration-backups/2026-09-05T00-00-00-000Z",
    written: ["memory-t/observations/index.json"],
  });
  const state = run(
    initialMigrationCardState,
    { type: "check" },
    { type: "checkDone", report: report() },
    { type: "apply" },
    { type: "applyDone", report: done },
  );
  const view = migrationCardView(state);
  expect(view.report).toContain("MIGRATION RUN");
  expect(view.backupNote).toBe("Backup written to migration-backups/2026-09-05T00-00-00-000Z");
  expect(view.showApply).toBe(false);
  expect(view.checkDisabled).toBe(false);
  expect(view.emptyNote).toBeNull();
});

test("a run that changed nothing has no backup to name", () => {
  const state = run(
    initialMigrationCardState,
    { type: "check" },
    { type: "checkDone", report: report() },
    { type: "apply" },
    { type: "applyDone", report: report({ dryRun: false, changed: 0 }) },
  );
  expect(migrationCardView(state).backupNote).toBeNull();
});

test("the check runs again after a migration, and the second dry run is empty", () => {
  const state = run(
    initialMigrationCardState,
    { type: "check" },
    { type: "checkDone", report: report() },
    { type: "apply" },
    { type: "applyDone", report: report({ dryRun: false, backupDir: "migration-backups/x" }) },
    { type: "check" },
    { type: "checkDone", report: report({ changed: 0 }) },
  );
  const view = migrationCardView(state);
  expect(view.emptyNote).toBe("Nothing to migrate.");
  expect(view.showApply).toBe(false);
  expect(view.backupNote).toBeNull();
});

test("a failure shows its message instead of a report and leaves the check usable", () => {
  const failed = run(
    initialMigrationCardState,
    { type: "check" },
    { type: "fail", message: "readDir denied" },
  );
  const view = migrationCardView(failed);
  expect(view.error).toBe("readDir denied");
  expect(view.report).toBeNull();
  expect(view.checkDisabled).toBe(false);
  expect(view.showApply).toBe(false);
  expect(migrationCardReducer(failed, { type: "check" }).phase).toBe("checking");
});

test("a failure during the real run reports it and does not claim a backup", () => {
  const view = migrationCardView(
    run(
      initialMigrationCardState,
      { type: "check" },
      { type: "checkDone", report: report() },
      { type: "apply" },
      { type: "fail", message: "disk full" },
    ),
  );
  expect(view.error).toBe("disk full");
  expect(view.backupNote).toBeNull();
  expect(view.showApply).toBe(false);
});

test("a second check while one is in flight is ignored", () => {
  const checking = run(initialMigrationCardState, { type: "check" });
  expect(migrationCardReducer(checking, { type: "check" })).toBe(checking);
  const applying = run(checking, { type: "checkDone", report: report() }, { type: "apply" });
  expect(migrationCardReducer(applying, { type: "check" })).toBe(applying);
});

test("a result from a run the card is no longer waiting on is dropped", () => {
  const idle = initialMigrationCardState;
  expect(migrationCardReducer(idle, { type: "checkDone", report: report() })).toBe(idle);
  expect(migrationCardReducer(idle, { type: "applyDone", report: report() })).toBe(idle);
  expect(migrationCardReducer(idle, { type: "fail", message: "x" })).toBe(idle);

  const checked = run(idle, { type: "check" }, { type: "checkDone", report: report() });
  expect(migrationCardReducer(checked, { type: "applyDone", report: report() })).toBe(checked);
  expect(migrationCardReducer(checked, { type: "fail", message: "x" })).toBe(checked);
});

test("applying is refused except straight after a dry run that found something", () => {
  const idle = initialMigrationCardState;
  expect(migrationCardReducer(idle, { type: "apply" })).toBe(idle);

  const empty = run(idle, { type: "check" }, { type: "checkDone", report: report({ changed: 0 }) });
  expect(migrationCardReducer(empty, { type: "apply" })).toBe(empty);

  const applied = run(
    idle,
    { type: "check" },
    { type: "checkDone", report: report() },
    { type: "apply" },
    { type: "applyDone", report: report({ dryRun: false }) },
  );
  expect(migrationCardReducer(applied, { type: "apply" })).toBe(applied);
});
