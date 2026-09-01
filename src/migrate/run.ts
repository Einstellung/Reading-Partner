// The two entry points, over one step list.
//
// Nothing here runs by itself. There is no startup hook, no sweep and no
// lifecycle listener anywhere in this directory; the only way any of it happens
// is a caller asking for it.

import { backupDirFor, OverlayFs } from "./fs";
import { STEPS } from "./steps";
import type { MigrationFs, MigrationReport } from "./types";

async function pass(fs: MigrationFs, writeThrough: boolean): Promise<{
  overlay: OverlayFs;
  report: MigrationReport;
}> {
  const overlay = new OverlayFs(fs, writeThrough);
  const report: MigrationReport = {
    dryRun: !writeThrough,
    backupDir: null,
    steps: [],
    written: [],
    removed: [],
  };
  for (const step of STEPS) report.steps.push(await step(overlay));
  report.written = [...overlay.written];
  report.removed = [...overlay.removed];
  return { overlay, report };
}

// Writes nothing. The steps run against an overlay whose writes stay in memory,
// so each one still sees what the one before it would have done and the report
// describes the finished state rather than the first step's.
export async function dryRunMigration(fs: MigrationFs): Promise<MigrationReport> {
  return (await pass(fs, false)).report;
}

// Writes, and hands back the same report a dry run would.
//
// The dry pass first, to learn which files this run touches; those are copied
// into a timestamped backup directory; only then does the real pass start. The
// steps are deterministic — every id they mint is derived, and no step reads a
// clock — so the second pass does what the first one said it would.
export async function runMigration(
  fs: MigrationFs,
  now: () => number = Date.now,
): Promise<MigrationReport> {
  const planned = (await pass(fs, false)).overlay.touched();
  let backupDir: string | null = null;
  if (planned.length > 0) {
    backupDir = backupDirFor(now());
    for (const path of planned) {
      const text = await fs.read(path);
      // A path the run creates has nothing to copy; only what exists is backed
      // up, and a restore is "put these files back", not "recreate this state".
      if (text === null) continue;
      await fs.write(`${backupDir}/${path}`, text);
    }
  }
  const { report } = await pass(fs, true);
  report.backupDir = backupDir;
  return report;
}

// The report as lines a human reads next to their own measurements.
export function formatReport(report: MigrationReport): string {
  const out: string[] = [];
  out.push(report.dryRun ? "DRY RUN — nothing was written" : "MIGRATION RUN");
  if (report.backupDir) out.push(`backup: ${report.backupDir}`);
  for (const step of report.steps) {
    out.push("");
    out.push(`${step.id}: ${step.title}`);
    out.push(`  scanned ${step.scanned}, changed ${step.changed}, unchanged ${step.skipped}`);
    if (step.aborted) out.push(`  ABORTED: ${step.aborted}`);
    for (const [key, value] of Object.entries(step.counts)) out.push(`  ${key}: ${value}`);
    for (const line of step.samples) out.push(`    ${line}`);
    for (const r of step.unrepaired) out.push(`  unrepaired ${r.what} — ${r.why}`);
  }
  out.push("");
  out.push(`files written ${report.written.length}, removed ${report.removed.length}`);
  return out.join("\n");
}
