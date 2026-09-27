// The domains' garbage markers (docs/80), each run through the housekeeper
// against the real palace rows, so a mark that the executor would refuse — a
// path whose row does not name the marker — fails here as well as in the guard.

import { expect, test } from "bun:test";
import { runHousekeeper } from "../../src/housekeeper";
import { infoDailyMarker } from "../../src/info/collect/store";
import { ACKED_BELL_GRACE_MS, bellMarker } from "../../src/legion/bell";
import { RUN_FILE_GRACE_MS, createLedgerStore, runFilesMarker } from "../../src/legion/ledger";
import { createRunStore } from "../../src/legion/run/store";
import { mapDisk } from "../support/map-disk";
import { DAY, memDisk } from "./fixtures";

const NOW = new Date(2026, 6, 25, 4, 0).getTime(); // 2026-07-25 04:00 local

function outcomes(log: { path: string; outcome: string }[]): string[] {
  return log.map((l) => `${l.outcome} ${l.path}`).sort();
}

test("info-daily-files: past days go, today stays, old cables are purged before they are removed", async () => {
  const d = memDisk({
    "briefing-2026-07-25.json": { text: "{}", mtimeMs: NOW },
    "briefing-2026-07-24.json": { text: "{}", mtimeMs: NOW },
    "info-run-2026-07-20.json": { text: "{}", mtimeMs: NOW },
    "info-cables-2026-06-25.json": { text: "{}", mtimeMs: NOW },
    "info-cables-2026-06-24.json": { text: "{}", mtimeMs: NOW },
    "topics.json": { text: "{}", mtimeMs: NOW },
  });
  await runHousekeeper({ now: NOW, readIo: d.read, executeIo: d.exec, markers: [infoDailyMarker] });
  expect(outcomes(d.log)).toEqual([
    "done briefing-2026-07-24.json",
    "done info-cables-2026-06-24.json",
    "done info-run-2026-07-20.json",
  ]);
  const cable = d.calls.filter((c) => c.includes("info-cables"));
  expect(cable).toEqual(["purge info-cables-2026-06-24.json", "remove info-cables-2026-06-24.json"]);
  expect([...d.disk.keys()].sort()).toEqual([
    "briefing-2026-07-25.json",
    "info-cables-2026-06-25.json",
    "topics.json",
  ]);
});

function bell(state: string, at: number): string {
  return JSON.stringify({ id: "b", type: "wake", at, state, payload: { scheduleId: "s", brief: "" } });
}

test("legion-bell: only an acked bell past the grace goes", async () => {
  const old = NOW - ACKED_BELL_GRACE_MS - DAY;
  const d = memDisk({
    "legion/bell/acked-old.json": { text: bell("acked", old), mtimeMs: old },
    "legion/bell/acked-young.json": { text: bell("acked", old), mtimeMs: NOW - DAY },
    "legion/bell/queued-old.json": { text: bell("queued", old), mtimeMs: old },
    "legion/bell/delivered-old.json": { text: bell("delivered", old), mtimeMs: old },
  });
  await runHousekeeper({ now: NOW, readIo: d.read, executeIo: d.exec, markers: [bellMarker] });
  expect(outcomes(d.log)).toEqual(["done legion/bell/acked-old.json"]);
});

test("legion-run-files: a brief or output no hot run names goes after the grace; a named one stays", async () => {
  const runs = createRunStore(mapDisk());
  await runs.create({
    kind: "k",
    delegator: { kind: "soul" },
    brief: "legion/briefs/live.md",
    at: NOW - 30 * DAY,
  });
  const ledger = createLedgerStore(mapDisk());
  const old = NOW - RUN_FILE_GRACE_MS - DAY;
  const d = memDisk({
    "legion/briefs/live.md": { text: "x", mtimeMs: old },
    "legion/briefs/orphan.md": { text: "x", mtimeMs: old },
    "legion/briefs/fresh.md": { text: "x", mtimeMs: NOW - DAY },
    "legion/outputs/r-gone.md": { text: "x", mtimeMs: old },
    "legion/outputs/r-unknown.md": { text: "x", mtimeMs: 0 },
  });
  const marker = runFilesMarker({ runs: () => runs, ledger: () => ledger });
  await runHousekeeper({ now: NOW, readIo: d.read, executeIo: d.exec, markers: [marker] });
  expect(outcomes(d.log)).toEqual([
    "done legion/briefs/orphan.md",
    "done legion/outputs/r-gone.md",
  ]);
});
