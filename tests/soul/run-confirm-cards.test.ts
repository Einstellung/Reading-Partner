// The confirmation cards a delegated run left, appended after its reply in the
// conversation it was asked from (docs/platform/687 确认).

import { beforeEach, expect, test } from "bun:test";
import { pendingPath, type PendingRecord } from "../../src/housekeeper/write";
import { createBellStore, type Bell } from "../../src/legion/bell";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { rebuildThreadStoreForTests, type ThreadMessage } from "../../src/platform/app/threads";
import { answerBell, registerTurnDelivery, type TurnDeliveryOutcome } from "../../src/soul";
import { appendRunConfirmCards, runCardId, type RunCardDeps } from "../../src/soul/run-confirm-cards";
import { memIo } from "../housekeeper/write-fixture";
import { installAppData } from "../support/appdata-fake";
import { mapDisk } from "../support/map-disk";

const settings: Settings = { ...DEFAULT_SETTINGS, defaultProviderId: "anthropic", defaultModelId: "claude-sonnet-4-5" };

function record(pendingId: string, runId: string | undefined, lines: string[]): PendingRecord {
  return {
    pendingId,
    kind: "test-notes",
    id: null,
    base: "b0",
    value: {},
    gate: "replace",
    lines,
    why: "asked",
    initiator: { place: "meals", ...(runId ? { runId } : {}) },
    at: 1,
  };
}

function cardDeps() {
  const io = memIo();
  const appended: { key: string; threadId: string; message: ThreadMessage }[] = [];
  const loaded: string[] = [];
  let flushed = 0;
  const deps: RunCardDeps = {
    io,
    load: async (key) => {
      loaded.push(key);
    },
    append: (key, threadId, message) => appended.push({ key, threadId, message }),
    flush: async () => {
      flushed++;
    },
    now: () => 5_000,
  };
  return { io, deps, appended, loaded, flushed: () => flushed };
}

test("each record the run left becomes one card after the reply, in the thread it landed in", async () => {
  const s = cardDeps();
  for (const r of [record("p1", "r1", ["Title: Market"]), record("p2", "r2", ["other"]), record("p3", "r1", ["eggs: 5"])]) {
    s.io.files.set(pendingPath(r.pendingId), JSON.stringify(r));
  }

  expect(await appendRunConfirmCards("r1", { key: "info-meals", threadId: "meals" }, s.deps)).toBe(2);

  expect(s.loaded).toEqual(["info-meals"]);
  expect(s.flushed()).toBe(1);
  expect(s.appended.map((a) => [a.key, a.threadId, a.message.ts])).toEqual([
    ["info-meals", "meals", 5_000],
    ["info-meals", "meals", 5_001],
  ]);
  expect(s.appended.map((a) => a.message.parts)).toEqual([
    [
      {
        type: "card",
        id: runCardId("p1"),
        card: { kind: "housekeeper-confirm", pendingId: "p1", dataKind: "test-notes", gate: "replace", lines: ["Title: Market"] },
      },
    ],
    [
      {
        type: "card",
        id: runCardId("p3"),
        card: { kind: "housekeeper-confirm", pendingId: "p3", dataKind: "test-notes", gate: "replace", lines: ["eggs: 5"] },
      },
    ],
  ]);
});

test("a run that left nothing waiting touches no thread", async () => {
  const s = cardDeps();
  s.io.files.set(pendingPath("p1"), JSON.stringify(record("p1", undefined, ["x"])));
  expect(await appendRunConfirmCards("r1", { key: "k", threadId: "t" }, s.deps)).toBe(0);
  expect(s.loaded).toEqual([]);
  expect(s.appended).toEqual([]);
});

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
  for (const name of ["door", "book", "briefing", "meals"] as const) registerTurnDelivery(name, async () => null)();
});

test("a delivered run's cards are asked for where its reply landed, before the bell is acked", async () => {
  const bells = createBellStore(mapDisk());
  await bells.ring("run-done", { runId: "r1", kind: "tasking", brief: "plan the week" }, { at: 1 });
  const address = { key: "door-2026-09-14", threadId: "d1" };
  const off = registerTurnDelivery(
    "door",
    async (): Promise<TurnDeliveryOutcome> => ({ status: "answered", reply: "Done.", watching: true, address }),
  );
  const asked: [string, { key: string; threadId: string }, string | undefined][] = [];
  try {
    expect(
      await answerBell({
        settings,
        bells,
        now: () => 10,
        confirmCards: async (runId, at) => {
          asked.push([runId, at, (await bells.get("run-done-r1") as Bell | null)?.state]);
        },
      }),
    ).toBe(1);
  } finally {
    off();
  }
  expect(asked).toEqual([["r1", address, "queued"]]);
  expect((await bells.get("run-done-r1"))?.state).toBe("acked");
});

test("an answer that names no thread asks for no cards", async () => {
  const bells = createBellStore(mapDisk());
  await bells.ring("run-done", { runId: "r1", kind: "tasking", brief: "plan the week" }, { at: 1 });
  const off = registerTurnDelivery("door", async (): Promise<TurnDeliveryOutcome> => ({ status: "answered", reply: "Done.", watching: true }));
  const asked: string[] = [];
  try {
    await answerBell({ settings, bells, now: () => 10, confirmCards: async (runId) => void asked.push(runId) });
  } finally {
    off();
  }
  expect(asked).toEqual([]);
});
