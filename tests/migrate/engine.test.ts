// The engine over the whole step list: what a dry run promises, that a second
// run finds nothing, that a run killed mid-write finishes on the next one, and
// what the backup is. Run: bun test.

import { expect, test } from "bun:test";
import { inSyncRange } from "../../src/platform/sync/syncFs";
import { BACKUP_ROOT } from "../../src/migrate/fs";
import { deriveMessageId } from "../../src/migrate/hash";
import { dryRunMigration, runMigration } from "../../src/migrate/run";
import { stepMessageIds } from "../../src/migrate/steps";
import { totalChanges } from "../../src/migrate/types";
import { BOOK, makeFlakyFs, makeMemFs, makeStore } from "./fixture";

const FIXED_NOW = new Date("2026-09-01T10:00:00Z").getTime();

function withoutBackup(files: Map<string, string>): Map<string, string> {
  return new Map([...files].filter(([path]) => !path.startsWith(`${BACKUP_ROOT}/`)));
}

test("a dry run writes nothing and reports what the real run then does", async () => {
  const { fs, files } = makeStore();
  const before = new Map(files);
  const dry = await dryRunMigration(fs);
  expect(dry.dryRun).toBe(true);
  expect(dry.backupDir).toBeNull();
  expect([...files]).toEqual([...before]);
  expect(totalChanges(dry)).toBeGreaterThan(0);

  const real = await runMigration(fs, () => FIXED_NOW);
  expect(real.steps.map((s) => [s.id, s.changed])).toEqual(
    dry.steps.map((s) => [s.id, s.changed]),
  );
});

test("running the whole engine over already-migrated data changes nothing", async () => {
  const { fs, files } = makeStore();
  await runMigration(fs, () => FIXED_NOW);
  const settled = new Map(files);
  const again = await runMigration(fs, () => FIXED_NOW);
  expect(totalChanges(again)).toBe(0);
  expect(again.written).toEqual([]);
  expect(again.removed).toEqual([]);
  expect(again.backupDir).toBeNull();
  expect([...files]).toEqual([...settled]);
});

test("a real run copies what it is about to touch into a backup out of sync range", async () => {
  const { fs, files } = makeStore();
  const before = new Map(files);
  const report = await runMigration(fs, () => FIXED_NOW);
  expect(report.backupDir).toBe(`${BACKUP_ROOT}/2026-09-01T10-00-00-000Z`);
  // Every file the run changed and that existed before it, byte for byte.
  for (const path of [...report.written, ...report.removed]) {
    if (path.startsWith(`${BACKUP_ROOT}/`)) continue;
    const original = before.get(path);
    if (original === undefined) continue;
    expect(files.get(`${report.backupDir}/${path}`)).toBe(original);
  }
  // inSyncRange is an allowlist keyed on the top path segment, so the backup is
  // excluded by construction rather than by a rule of its own. Asserted rather
  // than assumed: a backup that synced would push the pre-migration files back
  // onto the other device.
  expect(inSyncRange(`${report.backupDir}/threads-${BOOK}.json`)).toBe(false);
  expect(inSyncRange(`${report.backupDir}/memory-topic-1/m-aaaaaa01.md`)).toBe(false);
  expect(inSyncRange(BACKUP_ROOT)).toBe(false);
});

test("a run that dies after writing some files finishes on the next one", async () => {
  const reference = makeStore();
  const clean = await runMigration(reference.fs, () => FIXED_NOW);
  const settled = withoutBackup(reference.files);
  const writes = clean.written.length + 16;

  for (let fail = 1; fail <= writes; fail++) {
    const { fs, files } = makeStore();
    try {
      await runMigration(makeFlakyFs(fs, fail), () => FIXED_NOW);
    } catch {
      // The point of the test: whatever it managed to write stays on disk.
    }
    await runMigration(fs, () => FIXED_NOW);
    expect({ fail, files: [...withoutBackup(files)].sort() }).toEqual({
      fail,
      files: [...settled].sort(),
    });
  }
});

// The derivation has to be collision-free over the store it will actually run
// on, not only over a handmade example: 70 threads, 549 messages and 153 pair
// keys naming two messages is the shape measured on the owner's store.
test("the message id derivation is collision-free over the real store's shape", async () => {
  const threads: Record<string, unknown> = {};
  let ties = 0;
  let messages = 0;
  for (let t = 0; t < 70; t++) {
    const id = `thread-${String(t).padStart(4, "0")}-4000-8000-000000000000`;
    // Threads start from one of ten bases, so stamps repeat across threads the
    // way they do on the real store — which is what step 1's "uniquely owned"
    // test has to survive — while staying distinct inside one thread.
    let ts = 1786600000000 + (t % 10) * 100000;
    const rows: { role: string; text: string; ts: number }[] = [];
    for (let m = 0; m < 4; m++) {
      // The first 153 turns are a user message and its reply in the same
      // millisecond, which is what makes the pair key ambiguous.
      const tie = ties < 153;
      rows.push({ role: "user", text: `u${m}`, ts });
      rows.push({ role: "ai", text: `a${m}`, ts: tie ? ts : ts + 1 });
      if (tie) ties++;
      ts += 1000;
    }
    messages += rows.length;
    threads[id] = { id, messages: rows };
  }
  expect(ties).toBe(153);
  expect(messages).toBe(560);

  const { fs } = makeMemFs({ [`threads-${BOOK}.json`]: JSON.stringify({ threads }) });
  const step = await stepMessageIds(fs);
  expect(step.aborted).toBeUndefined();
  expect(step.changed).toBe(messages);

  const seen = new Set<string>();
  for (const [threadId, thread] of Object.entries(threads) as [
    string,
    { messages: { role: string; ts: number }[] },
  ][]) {
    for (const m of thread.messages) seen.add(deriveMessageId(threadId, m.ts, m.role));
  }
  expect(seen.size).toBe(messages);
});
