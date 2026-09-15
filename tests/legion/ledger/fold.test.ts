// Folding a run into the ledger: the three conditions, the canonical line, and
// the tombstone rule (src/legion/ledger, docs/55). Pure — no disk, no clock.

import { expect, test } from "bun:test";
import {
  FOLD_FAILED_GRACE_MS,
  FOLD_GRACE_MS,
  foldRun,
  ledgerLineText,
  parseLedgerLine,
  tombstonedRunIds,
  type LedgerLine,
} from "../../../src/legion/ledger";
import type { Run } from "../../../src/legion/run/types";

const ID = "r-0123456789abcdef0123456789abcdef";
const OTHER = "r-fedcba9876543210fedcba9876543210";

function run(over: Partial<Run> = {}): Run {
  return {
    id: ID,
    kind: "translate-book",
    tier: "synced",
    delegator: { kind: "soul" },
    brief: "briefs/translate-book.json",
    state: "done",
    attempts: 1,
    createdAt: 1_000,
    startedAt: 2_000,
    endedAt: 3_000,
    deliveredAt: 4_000,
    output: "translations/b1.json",
    revision: 7,
    ...over,
  };
}

const LATER = 4_000 + FOLD_GRACE_MS;

test("a delivered run past its grace folds into a line of references", () => {
  const line = foldRun(run(), LATER, { briefHash: "abc" });
  expect(line).not.toBeNull();
  expect(line).toEqual({
    id: ID,
    kind: "translate-book",
    state: "done",
    delegator: "soul",
    brief: "briefs/translate-book.json",
    briefHash: "abc",
    output: "translations/b1.json",
    attempts: 1,
    createdAt: 1_000,
    endedAt: 3_000,
    deliveredAt: 4_000,
  });
});

test("a run that is not terminal does not fold", () => {
  for (const state of ["pending", "running"] as const) {
    expect(foldRun(run({ state, deliveredAt: 4_000 }), LATER * 100)).toBeNull();
  }
});

test("a terminal run whose bell was never acked does not fold, however old", () => {
  const never = run({ deliveredAt: undefined });
  expect(foldRun(never, 4_000 + FOLD_FAILED_GRACE_MS * 100)).toBeNull();
});

test("a delivered run inside its grace does not fold, and past it does", () => {
  expect(foldRun(run(), LATER - 1)).toBeNull();
  expect(foldRun(run(), LATER)?.id).toBe(ID);
});

test("a failed run waits the longer grace", () => {
  const failed = run({ state: "failed", output: undefined, attempts: 3 });
  expect(foldRun(failed, 4_000 + FOLD_GRACE_MS)).toBeNull();
  expect(foldRun(failed, 4_000 + FOLD_FAILED_GRACE_MS - 1)).toBeNull();
  const line = foldRun(failed, 4_000 + FOLD_FAILED_GRACE_MS);
  expect(line?.state).toBe("failed");
  expect(line?.output).toBeUndefined();
});

test("a cancelled run has no bell, so it counts as delivered when it stopped", () => {
  const cancelled = run({ state: "cancelled", deliveredAt: undefined, endedAt: 3_000 });
  expect(foldRun(cancelled, 3_000 + FOLD_GRACE_MS - 1)).toBeNull();
  const line = foldRun(cancelled, 3_000 + FOLD_GRACE_MS);
  expect(line?.deliveredAt).toBe(3_000);
});

test("a sub-run folds with the step it was, and a run's delegator is named", () => {
  const sub = run({
    delegator: { kind: "run", id: OTHER },
    batchId: OTHER,
    step: "analyst:3",
    idempotencyKey: `${OTHER}:analyst:3`,
  });
  const line = foldRun(sub, LATER, { briefHash: null });
  expect(line?.delegator).toBe(`run:${OTHER}`);
  expect(line?.batchId).toBe(OTHER);
  expect(line?.step).toBe("analyst:3");
});

test("two devices fold the same run to the same bytes, whatever order they hold its keys in", () => {
  // The same run as two objects: one device's file parsed back in the order it
  // was written, the other's with every key reversed and device-local fields
  // that differ (claimant, revision, progress).
  const a = run({ claimant: { deviceId: "pc", startedAt: 2_000 }, revision: 7, progress: "12/40" });
  const reversed = Object.fromEntries(Object.entries(a).reverse()) as unknown as Run;
  const b = { ...reversed, claimant: { deviceId: "ipad", startedAt: 2_500 }, revision: 9 };
  delete (b as Partial<Run>).progress;

  const first = foldRun(a, LATER, { briefHash: "abc" });
  const second = foldRun(b, LATER + 999_999, { briefHash: "abc" });
  expect(first).not.toBeNull();
  expect(ledgerLineText(first as LedgerLine)).toBe(ledgerLineText(second as LedgerLine));
  // And the bytes are the ones the file gets: keys in the fold's own order,
  // whatever order the run object was holding them in.
  expect(ledgerLineText(first as LedgerLine).startsWith(`{"id":"${ID}","kind":"translate-book"`))
    .toBe(true);
});

test("a line survives the round trip through the file, and rubbish does not parse", () => {
  const line = foldRun(run(), LATER, { briefHash: "abc" }) as LedgerLine;
  expect(parseLedgerLine(ledgerLineText(line))).toEqual(line);
  expect(parseLedgerLine("not json")).toBeNull();
  expect(parseLedgerLine(JSON.stringify({ ...line, state: "running" }))).toBeNull();
  expect(parseLedgerLine(JSON.stringify({ ...line, createdAt: "1000" }))).toBeNull();
});

test("a fractional millisecond is not a second spelling of the same line", () => {
  const a = foldRun(run({ createdAt: 1_000 }), LATER, { briefHash: "abc" }) as LedgerLine;
  const b = foldRun(run({ createdAt: 1_000.4 }), LATER, { briefHash: "abc" }) as LedgerLine;
  expect(ledgerLineText(a)).toBe(ledgerLineText(b));
});

// --- the tombstone ---------------------------------------------------------

function line(over: Partial<LedgerLine> = {}): LedgerLine {
  return foldRun(run(over as Partial<Run>), LATER, { briefHash: "abc" }) as LedgerLine;
}

test("a hot run the ledger accounts for is deleted", () => {
  expect(tombstonedRunIds([{ id: ID, createdAt: 1_000 }], [line()])).toEqual([ID]);
  expect(tombstonedRunIds([{ id: ID, createdAt: 999 }], [line()])).toEqual([ID]);
});

test("a hot run created after the line is a new run wearing an old id, and stays", () => {
  expect(tombstonedRunIds([{ id: ID, createdAt: 1_001 }], [line()])).toEqual([]);
});

test("a hot run with no line stays", () => {
  expect(tombstonedRunIds([{ id: OTHER, createdAt: 1_000 }], [line()])).toEqual([]);
});

test("two lines under one id are two runs, and the newest speaks for the hot layer", () => {
  const lines = [line({ createdAt: 500 }), line({ createdAt: 1_000 })];
  expect(tombstonedRunIds([{ id: ID, createdAt: 1_000 }], lines)).toEqual([ID]);
  expect(tombstonedRunIds([{ id: ID, createdAt: 600 }], lines)).toEqual([ID]);
  expect(tombstonedRunIds([{ id: ID, createdAt: 1_001 }], lines)).toEqual([]);
});
