import { expect, test } from "bun:test";
import {
  agoText,
  backgroundStatusText,
  durationText,
  whenText,
  type StatusInput,
} from "../../../src/legion/status/describe";
import type { RunDescriber } from "../../../src/legion/status/registry";
import { buildBackgroundStatusTool } from "../../../src/legion/status/tool";
import type { DeviceClaim } from "../../../src/legion/claim";
import type { Run } from "../../../src/legion/run";

const NOW = new Date(2026, 9, 17, 10, 46).getTime();
const MIN = 60_000;

function run(over: Partial<Run> = {}): Run {
  return {
    id: "r-1",
    kind: "collect",
    tier: "synced",
    delegator: { kind: "program", name: "test" },
    brief: "{}",
    state: "pending",
    attempts: 0,
    createdAt: NOW - 4 * MIN,
    revision: 1,
    ...over,
  };
}

const desk: DeviceClaim = {
  deviceId: "dev-desk",
  deviceName: "kestrel",
  platform: "linux",
  claimedAt: NOW - 5 * 60 * MIN,
  heartbeatAt: NOW - 20 * MIN,
  capabilities: ["webview-fetch"],
};

function input(over: Partial<StatusInput> = {}): StatusInput {
  return {
    runs: [],
    claims: [desk],
    deviceId: "dev-phone",
    now: NOW,
    lastSyncAt: NOW - 1 * MIN,
    syncing: true,
    describer: () => null,
    requires: () => ["webview-fetch"],
    ...over,
  };
}

test("times are said relative to now and as a local clock time", () => {
  expect(durationText(45_000)).toBe("45 s");
  expect(durationText(4 * MIN)).toBe("4 min");
  expect(durationText(125 * MIN)).toBe("2 h 5 min");
  expect(durationText(3 * 24 * 60 * MIN)).toBe("3 days");
  expect(agoText(NOW - 10_000, NOW)).toBe("just now");
  expect(agoText(NOW - 4 * MIN, NOW)).toBe("4 min ago");
  expect(whenText(NOW - 4 * MIN, NOW)).toBe("today 10:42");
  expect(whenText(new Date(2026, 9, 16, 23, 10).getTime(), NOW)).toBe("yesterday 23:10");
  expect(whenText(new Date(2026, 9, 14, 9, 5).getTime(), NOW)).toBe("2026-10-14 09:05");
});

test("a queued run says no device picked it up, and whether one that can is on", async () => {
  const on = await backgroundStatusText(input({ runs: [run()] }));
  expect(on).toContain("State: queued, asked 4 min ago (today 10:42).");
  expect(on).toContain('no device has picked it up yet. "kestrel", which can run it, last checked in 20 min ago');
  const off = await backgroundStatusText(
    input({ runs: [run()], claims: [{ ...desk, heartbeatAt: NOW - 5 * 60 * MIN }] }),
  );
  expect(off).toContain("no device that can run it has checked in in the last 2 hours");
  expect(off).toContain('"kestrel" last checked in 5 h ago');
});

test("a run on another device is told as its synced record, with how old it is", async () => {
  const running = run({
    state: "running",
    attempts: 1,
    claimant: { deviceId: "dev-desk", startedAt: NOW - 3 * MIN },
    startedAt: NOW - 3 * MIN,
    lastProgressAt: NOW - 1 * MIN,
    progress: "reading X: query 2 of 3",
  });
  const text = await backgroundStatusText(input({ runs: [running] }));
  expect(text).toContain('State: running on "kestrel", started 3 min ago (today 10:43), running for 3 min.');
  expect(text).toContain('Last report, 1 min ago: "reading X: query 2 of 3".');
  expect(text).toContain("This device cannot see \"kestrel\"'s progress directly");
  expect(text).toContain("this device last synced 1 min ago");
  expect(text).not.toContain("may be asleep");

  const quiet = await backgroundStatusText(input({ runs: [{ ...running, lastProgressAt: NOW - 40 * MIN, startedAt: NOW - 60 * MIN }] }));
  expect(quiet).toContain("Its last report reached this device 40 min ago");
  expect(quiet).toContain("do not say nothing is happening");
});

test("a run on this device is not told as out of sight", async () => {
  const here = run({
    state: "running",
    attempts: 2,
    claimant: { deviceId: "dev-desk", startedAt: NOW - 3 * MIN },
    startedAt: NOW - 3 * MIN,
    lastProgressAt: NOW - 30_000,
  });
  const text = await backgroundStatusText(input({ runs: [here], deviceId: "dev-desk" }));
  expect(text).toContain("running on this device (kestrel)");
  expect(text).toContain("attempt 2 of 3");
  expect(text).not.toContain("cannot see");
});

test("finished runs: failed with its reason, skipped by the describer, done with its line", async () => {
  const ended = { claimant: { deviceId: "dev-desk", startedAt: NOW - 30 * MIN }, startedAt: NOW - 30 * MIN, endedAt: NOW - 10 * MIN };
  const failed = await backgroundStatusText(input({ runs: [run({ ...ended, state: "failed", progress: "no builder" })] }));
  expect(failed).toContain('State: failed 10 min ago (today 10:36) on "kestrel", after 20 min. Reason or last report: "no builder".');

  const describer: RunDescriber = {
    kind: "collect",
    about: async () => ({ title: "today's briefing", subjects: ["briefing"], skipped: "signed out of X" }),
    detail: async (view) => [`detail here=${view.here}`],
  };
  const skipped = await backgroundStatusText(input({ runs: [run({ ...ended, state: "done" })], describer: () => describer }));
  expect(skipped).toContain("- today's briefing [collect]");
  expect(skipped).toContain("State: skipped 10 min ago (today 10:36) on \"kestrel\": signed out of X.");
  expect(skipped).toContain("detail here=false");

  const done = await backgroundStatusText(input({ runs: [run({ ...ended, state: "done", progress: "5 items delivered" })] }));
  expect(done).toContain('State: done 10 min ago (today 10:36) on "kestrel", after 20 min. Its last line: "5 items delivered".');
  expect(done).toContain("Never say when a run will finish.");
});

test("filters: running only, by kind, by subject; old runs only when named", async () => {
  const old = run({ id: "r-old", kind: "topic-search", state: "done", createdAt: NOW - 5 * 24 * 60 * MIN, endedAt: NOW - 5 * 24 * 60 * MIN });
  const pending = run({ id: "r-new" });
  const describer: RunDescriber = { kind: "topic-search", about: async () => ({ title: "topic search \"Proteins\": first look", subjects: ["ts-1", "Proteins"] }) };
  const base = input({ runs: [old, pending], describer: (k) => (k === "topic-search" ? describer : null) });
  const recent = await backgroundStatusText(base);
  expect(recent).toContain("[collect]");
  expect(recent).not.toContain("[topic-search]");
  expect(await backgroundStatusText(base, { about: "proteins" })).toContain('topic search "Proteins": first look');
  expect(await backgroundStatusText(base, { kind: "topic-search" })).not.toContain("[collect]");
  const none = await backgroundStatusText(base, { which: "running", kind: "topic-search" });
  expect(none).toContain("No background work on file here");
});

test("a describer that throws costs only its details", async () => {
  const describer: RunDescriber = {
    kind: "collect",
    about: async () => {
      throw new Error("x");
    },
    detail: async () => {
      throw new Error("unreadable");
    },
  };
  const text = await backgroundStatusText(input({ runs: [run()], describer: () => describer }));
  expect(text).toContain("- collect run [collect]");
  expect(text).toContain("(Details could not be read: unreadable.)");
});

test("a device that does not sync says it sees only its own work", async () => {
  const text = await backgroundStatusText(input({ lastSyncAt: null, syncing: false }));
  expect(text).toContain("this device does not sync, so it sees only the work it runs itself");
});

test("the tool reads now, parses its arguments and is a safe read", async () => {
  const tool = buildBackgroundStatusTool({
    runs: async () => [run()],
    claims: async () => {
      throw new Error("no claims");
    },
    deviceId: () => "dev-phone",
    now: () => NOW,
    sync: () => ({ lastSyncAt: NOW - MIN, syncing: true }),
    describer: () => null,
    requires: () => [],
  });
  expect(tool.effect).toBe("read");
  expect(tool.replay).toBe("safe");
  const out = await tool.execute({ which: "bogus", kind: " collect " });
  const text = typeof out === "string" ? out : out.text;
  expect(text).toContain("kind collect");
  expect(text).toContain("State: queued");
});
