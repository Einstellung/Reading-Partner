// What the info conversations offer distillation (docs/58): one unit per thread
// across every day file on disk, minus the one thread whose id repeats.
//
// Run: bun test tests/info/distill-source.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { ONBOARDING_THREAD_ID } from "../../src/info/briefer/anchors";
import { infoBookId } from "../../src/info/briefer/call";
import {
  listInfoUnits,
  registerInfoDistillSource,
} from "../../src/info/briefer/distill-source";
import { collectSourceArrears } from "../../src/memory/distill/info-thread";
import { rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

let disk: FakeDisk;
let undo: () => void = () => {};

beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
  undo = registerInfoDistillSource();
});

afterEach(() => {
  undo();
});

function message(role: "user" | "ai", text: string, ts: number): Record<string, unknown> {
  return { role, text, ts };
}

// One day's file, as the thread store writes it.
function day(date: string, threads: Record<string, unknown>): void {
  disk.files.set(`threads-${infoBookId(date)}.json`, JSON.stringify({ threads }, null, 2));
}

function thread(id: string, said: string[]): Record<string, unknown> {
  const messages = said.flatMap((text, i) => [
    message("user", text, 1000 + i * 2),
    message("ai", `about ${text}`, 1001 + i * 2),
  ]);
  return { id, annotationId: "", path: "", createdAt: 1000, messages };
}

test("every day's threads are units, oldest day first", async () => {
  day("2026-09-06", { "briefing-2026-09-06": thread("briefing-2026-09-06", ["what is new"]) });
  day("2026-09-08", {
    "briefing-2026-09-08": thread("briefing-2026-09-08", ["and today"]),
    "2026-09-08:item-9": thread("2026-09-08:item-9", ["this one"]),
  });

  const units = await listInfoUnits();
  expect(units.map((u) => u.id)).toEqual([
    "briefing-2026-09-06",
    "briefing-2026-09-08",
    "2026-09-08:item-9",
  ]);
  // A conversation with no topic of its own is filed under nothing, and the
  // sweep spends no pass on it until the reader confirms one (docs/21).
  expect(new Set(units.map((u) => u.topicId))).toEqual(new Set([null]));
  expect(units[0].label).toBe("Info briefing 2026-09-06");
  expect(units[0].messages).toEqual([
    { role: "user", text: "what is new", ts: 1000 },
    { role: "ai", text: "about what is new", ts: 1001 },
  ]);
});

test("the onboarding thread is not a unit: its id is the same in every day file", async () => {
  day("2026-09-06", {
    [ONBOARDING_THREAD_ID]: thread(ONBOARDING_THREAD_ID, ["set me up"]),
    "briefing-2026-09-06": thread("briefing-2026-09-06", ["what is new"]),
  });
  day("2026-09-08", { [ONBOARDING_THREAD_ID]: thread(ONBOARDING_THREAD_ID, ["again"]) });

  expect((await listInfoUnits()).map((u) => u.id)).toEqual(["briefing-2026-09-06"]);
});

test("a thread carrying its own topic is filed under it", async () => {
  day("2026-09-08", {
    "briefing-2026-09-08": { ...thread("briefing-2026-09-08", ["what is new"]), topicId: "attention" },
  });
  expect((await listInfoUnits())[0].topicId).toBe("attention");
});

test("a day with an empty thread offers nothing, and other files are not read", async () => {
  day("2026-09-08", { "briefing-2026-09-08": thread("briefing-2026-09-08", []) });
  // A reading thread file, which this source must not claim.
  disk.files.set(
    "threads-abc123.json",
    JSON.stringify({ threads: { "t-1": thread("t-1", ["about the book"]) } }),
  );
  expect(await listInfoUnits()).toEqual([]);
});

test("what the day owes is counted against the cursor the pass keeps", async () => {
  day("2026-09-08", {
    "briefing-2026-09-08": {
      ...thread("briefing-2026-09-08", ["one", "two"]),
      topicId: "attention",
    },
  });
  const owed = await collectSourceArrears((_topicId, unitId) =>
    unitId === "briefing-2026-09-08" ? 2 : 0,
  );
  expect(owed.get("attention")?.map((a) => [a.source, a.newMessages])).toEqual([
    ["info-thread", 1],
  ]);
});

// No topic, no distillation (docs/21): there is nothing to file an observation
// under until the reader confirms one, and the sweep leaves the unit alone.
test("a conversation with no topic owes nothing", async () => {
  day("2026-09-08", { "briefing-2026-09-08": thread("briefing-2026-09-08", ["one", "two"]) });
  expect((await collectSourceArrears(() => 0)).size).toBe(0);
});
