// The fold pass over a disk that is a Map, and two devices that share nothing
// but the ledger lines sync carries between them (src/legion/ledger, docs/55).

import { expect, test } from "bun:test";
import {
  FOLD_GRACE_MS,
  createLedgerStore,
  foldPass,
  ledgerDay,
} from "../../../src/legion/ledger";
import { createRunStore, type RunStore } from "../../../src/legion/run/store";
import { mapDisk as disk } from "../../support/map-disk";
import type { Run } from "../../../src/legion/run/types";

const BRIEF = "briefs/translate-book.json";

interface Device {
  runs: RunStore;
  hot: Map<string, string>;
  cold: Map<string, string>;
  purged: string[];
  pass(now: number): Promise<{ folded: string[]; deleted: string[] }>;
}

function device(hot = new Map<string, string>(), cold = new Map<string, string>()): Device {
  const runIo = disk(hot);
  const ledgerIo = disk(cold);
  const runs = createRunStore(runIo);
  const ledger = createLedgerStore(ledgerIo);
  const purged: string[] = [];
  return {
    runs,
    hot,
    cold,
    purged,
    pass: (now) =>
      foldPass({
        runs,
        ledger,
        now,
        briefHash: async () => "abc",
        purgeRemote: async (paths) => {
          purged.push(...paths);
        },
      }),
  };
}

/** A run that finished and whose bell was acked. */
async function delivered(
  runs: RunStore,
  over: { at?: number; state?: "done" | "failed"; step?: string; batchId?: string } = {},
): Promise<Run> {
  const at = over.at ?? 1_000;
  const { run } = await runs.create({
    kind: "translate-book",
    delegator: { kind: "soul" },
    brief: BRIEF,
    at,
    ...(over.batchId !== undefined ? { batchId: over.batchId, step: over.step } : {}),
  });
  await runs.transition(run.id, "running", {
    claimant: { deviceId: "pc", startedAt: at + 1 },
    at: at + 1,
  });
  const ended = await runs.transition(run.id, over.state ?? "done", {
    output: "translations/b1.json",
    at: at + 2,
  });
  if (!ended.ok) throw new Error(ended.reason);
  const stamped = await runs.markDelivered(ended.run.id, at + 3);
  return stamped as Run;
}

const PAST = 1_003 + FOLD_GRACE_MS;

test("a delivered run past its grace is written to the day's file and taken away", async () => {
  const d = device();
  const run = await delivered(d.runs);
  expect(d.hot.size).toBe(1);

  const result = await d.pass(PAST);
  expect(result.folded).toEqual([run.id]);
  expect(result.deleted).toEqual([run.id]);
  expect(d.hot.size).toBe(0);
  expect(d.purged).toEqual([`legion/runs/${run.id}.json`]);

  const day = ledgerDay(run.endedAt as number);
  const text = d.cold.get(`${day}.jsonl`) as string;
  expect(text.endsWith("\n")).toBe(true);
  expect(text.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(text.trim())).toMatchObject({ id: run.id, state: "done", briefHash: "abc" });
});

test("the pass a second time changes nothing", async () => {
  const d = device();
  await delivered(d.runs);
  await d.pass(PAST);
  const before = new Map(d.cold);
  const again = await d.pass(PAST + 60_000);
  expect(again).toEqual({ folded: [], deleted: [] });
  expect([...d.cold.entries()]).toEqual([...before.entries()]);
  expect(d.purged).toHaveLength(1);
});

test("a run still inside its grace, and one whose bell was never acked, are left alone", async () => {
  const d = device();
  const young = await delivered(d.runs);
  const { run: unacked } = await d.runs.create({
    kind: "translate-book",
    delegator: { kind: "soul" },
    brief: BRIEF,
    at: 1_000,
  });
  await d.runs.transition(unacked.id, "running", {
    claimant: { deviceId: "pc", startedAt: 1_001 },
    at: 1_001,
  });
  await d.runs.transition(unacked.id, "done", { at: 1_002 });

  expect(await d.pass(PAST - 1)).toEqual({ folded: [], deleted: [] });
  expect(d.hot.size).toBe(2);
  // Past the grace the acked one folds and the unacked one still does not.
  const later = await d.pass(PAST + 10 * FOLD_GRACE_MS);
  expect(later.folded).toEqual([young.id]);
  expect(d.hot.size).toBe(1);
});

test("the device that did not fold deletes its hot copy off the line the other one wrote", async () => {
  const pc = device();
  const run = await delivered(pc.runs);
  // The same run on the other device, as sync would have left it.
  const ipad = device(new Map(pc.hot));

  await pc.pass(PAST);
  // Sync carries the ledger over; the run file does not travel back, because
  // legion/runs is never-infer-delete and the ipad still holds its own copy.
  for (const [name, text] of pc.cold) ipad.cold.set(name, text);

  const result = await ipad.pass(PAST + 1);
  expect(result.folded).toEqual([]);
  expect(result.deleted).toEqual([run.id]);
  expect(ipad.hot.size).toBe(0);
  expect(ipad.purged).toEqual([`legion/runs/${run.id}.json`]);
  // And the line is still the one line the ledger had: nothing was appended.
  expect([...ipad.cold.values()][0]).toBe([...pc.cold.values()][0]);
});

test("two devices folding the same run independently write one line", async () => {
  const pc = device();
  const run = await delivered(pc.runs);
  const ipad = device(new Map(pc.hot));

  await pc.pass(PAST);
  await ipad.pass(PAST + 3_600_000);

  const day = `${ledgerDay(run.endedAt as number)}.jsonl`;
  expect(ipad.cold.get(day)).toBe(pc.cold.get(day) as string);
  // The union of the two files, which is what the records merge takes.
  const union = new Set([
    ...(pc.cold.get(day) as string).trim().split("\n"),
    ...(ipad.cold.get(day) as string).trim().split("\n"),
  ]);
  expect(union.size).toBe(1);
});

test("a new run that reused a folded run's derived id is not deleted with it", async () => {
  const pc = device();
  const first = await delivered(pc.runs, { batchId: "r-aaa", step: "analyst:1" });
  await pc.pass(PAST);
  expect(pc.hot.size).toBe(0);

  // The batch is run again and derives the same id. The ledger line about the
  // old run must not take the new one with it.
  const second = await delivered(pc.runs, {
    at: PAST + 1_000,
    batchId: "r-aaa",
    step: "analyst:1",
  });
  expect(second.id).toBe(first.id);
  const result = await pc.pass(PAST + 2_000);
  expect(result).toEqual({ folded: [], deleted: [] });
  expect(pc.hot.size).toBe(1);

  // And it folds on its own account once its own grace is up: a line about the
  // run before it is not a line about this one.
  const later = await pc.pass(PAST + 1_003 + FOLD_GRACE_MS);
  expect(later).toEqual({ folded: [second.id], deleted: [second.id] });
  expect(pc.hot.size).toBe(0);
  const lines = [...pc.cold.values()].flatMap((text) => text.trim().split("\n"));
  expect(lines).toHaveLength(2);
  expect(lines.map((l) => JSON.parse(l).createdAt)).toEqual([1_000, PAST + 1_000]);
});
