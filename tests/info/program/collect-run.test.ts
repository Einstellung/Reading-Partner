// The day's collection as a legion run (src/info/program/collect-worker.ts,
// docs/55 step 12): the worker around InfoPipeline, and the run the three
// callers delegate instead of holding the pipeline themselves.
//
// Headless. The run store is a Map, the clock is a variable, and the pipeline is
// a fake whose phases and outcome each test drives by hand — nothing here waits
// on a timer and nothing touches AppData. Run: bun test.

import { expect, test } from "bun:test";
import {
  collectProgressLine,
  collectWorker,
  parseCollectBrief,
  type CollectPipeline,
} from "../../../src/info/program/collect-worker";
import { createRunner } from "../../../src/legion/execute/runner";
import { registerWorker } from "../../../src/legion/execute/worker";
import { createBellStore, type Bell, type BellIo } from "../../../src/legion/bell";
import { createRunStore, type RunIo } from "../../../src/legion/run";
import { registerKindCapabilities, type DeviceClaim } from "../../../src/legion/claim";
import { dueRuns } from "../../../src/legion/schedule";
import type { InfoPhase, InfoSnapshot, RunHandle } from "../../../src/info/boxes/pipeline";
import { emptyProgress } from "../../../src/info/collect/run-state";

const NOW = 1_800_000_000_000;
const COLLECTOR = "desk";
const READER = "slate";

function disk(): RunIo & BellIo & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, contents) {
      files.set(name, contents);
    },
    async remove(name) {
      files.delete(name);
    },
  };
}

function claim(deviceId: string, over: Partial<DeviceClaim> = {}): DeviceClaim {
  return {
    deviceId,
    deviceName: deviceId,
    platform: "linux",
    claimedAt: NOW - 86_400_000,
    heartbeatAt: NOW,
    capabilities: [],
    ...over,
  };
}

// A pipeline that does exactly what a test tells it to. `starts` records which
// method was called; `settle` ends the run the way the real one does — by
// putting the answer in the snapshot and resolving, never by throwing.
function fakePipeline() {
  const listeners = new Set<() => void>();
  let snap: InfoSnapshot = {
    briefing: null,
    running: false,
    stopping: false,
    phase: "idle",
    collect: null,
    activity: null,
    error: null,
  };
  let settle: (() => void) | null = null;
  const notify = (): void => {
    for (const fn of [...listeners]) fn();
  };
  const launch = (what: "generate" | "retriage"): RunHandle => {
    api.starts.push(what);
    if (snap.running) return { start: "busy", done: api.current };
    api.current = new Promise<void>((resolve) => {
      settle = resolve;
    });
    snap = { ...snap, running: true, phase: "discovering", error: null };
    notify();
    return { start: "started", done: api.current };
  };
  const api = {
    starts: [] as string[],
    stops: 0,
    current: Promise.resolve(),
    pipeline: {
      generate: () => launch("generate"),
      retriage: () => launch("retriage"),
      stop: () => {
        api.stops += 1;
      },
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      snapshot: () => snap,
    } satisfies CollectPipeline,
    /** Move to a phase, the way a real run does between its four steps. */
    phase(phase: InfoPhase, collect: InfoSnapshot["collect"] = null) {
      snap = { ...snap, phase, collect };
      notify();
    },
    /** End the run: a briefing, or a reason it was parked. */
    finish(over: { date?: string; error?: string } = {}) {
      snap = {
        ...snap,
        running: false,
        phase: "idle",
        collect: null,
        error: over.error ?? null,
        briefing: over.date
          ? ({ date: over.date } as unknown as InfoSnapshot["briefing"])
          : snap.briefing,
      };
      notify();
      settle?.();
      settle = null;
    },
  };
  return api;
}

// Let every microtask that is already queued run. The worker reads its task
// book before it touches the pipeline, so `tick()` returning means the run was
// taken, not that the collection has started.
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

let nth = 0;
function kind(name: string): string {
  nth += 1;
  return `collect-${name}-${nth}`;
}

function world(k: string, pipeline: CollectPipeline, over: { readBrief?: () => Promise<string> } = {}) {
  const runDisk = disk();
  const bellDisk = disk();
  const runs = createRunStore(runDisk);
  const bells = createBellStore(bellDisk);
  const claims = [claim(COLLECTOR), claim(READER, { claimedAt: NOW - 1000 })];
  let clock = NOW;
  registerWorker({
    kind: k,
    tier: "synced",
    requires: [],
    run: collectWorker({
      pipeline: () => pipeline,
      readBrief: over.readBrief ?? (async () => JSON.stringify({ scope: "full", why: "test" })),
    }),
  });
  const runner = createRunner({
    deviceId: () => COLLECTOR,
    runs,
    bells,
    claims: async () => claims,
    now: () => clock,
  });
  return {
    runs,
    runner,
    claims,
    // Past the reporter's throttle window, so the next report reaches the file
    // rather than only the line the terminal state will carry.
    pastThrottle: () => {
      clock += 31_000;
    },
    rung: (): Promise<Bell[]> => bells.read(),
    async delegate(key: string) {
      return runner.delegate({
        kind: k,
        idempotencyKey: key,
        delegator: { kind: "program", name: "test" },
        brief: `legion/briefs/collect-${key}.json`,
      });
    },
  };
}

test("a task book with no scope is not one", () => {
  expect(parseCollectBrief(JSON.stringify({ scope: "full", why: "x" })).scope).toBe("full");
  expect(parseCollectBrief(JSON.stringify({ scope: "retriage" })).scope).toBe("retriage");
  expect(() => parseCollectBrief("{}")).toThrow("names no scope");
  expect(() => parseCollectBrief("not json")).toThrow("readable JSON");
});

test("the progress line follows the phase and its counts", () => {
  const idle: InfoSnapshot = {
    briefing: null,
    running: false,
    stopping: false,
    phase: "idle",
    collect: null,
    activity: null,
    error: null,
  };
  expect(collectProgressLine(idle)).toBeNull();
  const running = { ...idle, running: true };
  expect(collectProgressLine({ ...running, phase: "discovering" })).toBe("collecting sources");
  expect(
    collectProgressLine({
      ...running,
      phase: "discovering",
      collect: { ...emptyProgress(), total: 9, done: 4 },
    }),
  ).toBe("collecting 4/9 sources");
  expect(
    collectProgressLine({
      ...running,
      phase: "analyzing",
      collect: { ...emptyProgress(), labs: { total: 3, done: 1 } },
    }),
  ).toBe("analyzing 1/3 rooms");
});

test("a collect run goes the whole way and hands back the day's briefing", async () => {
  const p = fakePipeline();
  const w = world(kind("whole-way"), p.pipeline);
  const asked = await w.delegate("collect:2026-09-16");
  expect(asked.ok).toBe(true);
  const id = asked.ok ? asked.run.id : "";

  await w.runner.tick();
  await flush();
  expect(p.starts).toEqual(["generate"]);
  expect((await w.runs.get(id))?.state).toBe("running");

  expect((await w.runs.get(id))?.progress).toBe("collecting sources");
  w.pastThrottle();
  p.phase("screening", { ...emptyProgress(), items: 40, screened: 12 });
  await flush();
  expect((await w.runs.get(id))?.progress).toBe("screening 12/40 headlines");
  w.pastThrottle();
  p.phase("analyzing", { ...emptyProgress(), labs: { total: 2, done: 1 } });
  await flush();
  expect((await w.runs.get(id))?.progress).toBe("analyzing 1/2 rooms");

  p.finish({ date: "2026-09-16" });
  await w.runner.idle();

  const run = await w.runs.get(id);
  expect(run?.state).toBe("done");
  expect(run?.output).toBe("briefing-2026-09-16.json");
  expect(run?.attempts).toBe(1);
  expect((await w.rung()).map((b) => b.type)).toEqual(["run-done"]);
});

test("the same anchor twice is one run, and two regenerates are two", async () => {
  const p = fakePipeline();
  const w = world(kind("one-per-anchor"), p.pipeline);
  const first = await w.delegate("collect:2026-09-16");
  const again = await w.delegate("collect:2026-09-16");
  expect(first.ok && again.ok).toBe(true);
  expect(again.ok && again.existing).toBe(true);
  expect(first.ok && again.ok && again.run.id).toBe(first.ok ? first.run.id : "");

  const a = await w.delegate("collect:2026-09-16:full:1");
  const b = await w.delegate("collect:2026-09-16:full:2");
  expect(a.ok && b.ok && a.run.id !== b.run.id).toBe(true);
  expect((await w.runs.list()).length).toBe(3);
});

test("a pipeline parked with a reason is a failed attempt, not a finished run", async () => {
  const p = fakePipeline();
  const w = world(kind("parked"), p.pipeline);
  const asked = await w.delegate("collect:parked");
  const id = asked.ok ? asked.run.id : "";

  // Three tries, the run's limit, each ended the way the pipeline ends a run it
  // could not finish: no throw, a reason in the snapshot.
  await w.runner.tick();
  for (let i = 0; i < 3; i += 1) {
    await flush();
    p.finish({ error: "no provider key" });
    await flush();
  }
  await w.runner.idle();

  const run = await w.runs.get(id);
  expect(run?.state).toBe("failed");
  expect(run?.attempts).toBe(3);
  expect(p.starts.length).toBe(3);
  const bells = await w.rung();
  expect(bells.map((b) => b.type)).toEqual(["run-failed"]);
});

test("cancelling the run stops the pipeline", async () => {
  const p = fakePipeline();
  const w = world(kind("cancelled"), p.pipeline);
  const asked = await w.delegate("collect:cancelled");
  const id = asked.ok ? asked.run.id : "";
  await w.runner.tick();
  await flush();
  expect(p.starts).toEqual(["generate"]);

  await w.runner.cancel(id);
  expect(p.stops).toBe(1);
  // The pipeline unwinds and ends with no error, the way Stop leaves it.
  p.finish();
  await w.runner.idle();
  expect((await w.runs.get(id))?.state).toBe("cancelled");
});

test("a pipeline somebody else is holding is waited for, not given up on", async () => {
  const p = fakePipeline();
  const w = world(kind("busy"), p.pipeline);
  // init() resumes a checkpoint: a run that did not come through legion at all.
  p.pipeline.generate();
  expect(p.starts).toEqual(["generate"]);

  const asked = await w.delegate("collect:behind-init");
  const id = asked.ok ? asked.run.id : "";
  await w.runner.tick();
  await flush();
  // The worker asked, was told busy, and is waiting on that run rather than
  // having dropped the round.
  expect(p.starts).toEqual(["generate", "generate"]);
  expect((await w.runs.get(id))?.state).toBe("running");

  p.finish({ date: "2026-09-15" });
  await flush();
  expect(p.starts.length).toBe(3);
  p.finish({ date: "2026-09-16" });
  await w.runner.idle();
  expect((await w.runs.get(id))?.output).toBe("briefing-2026-09-16.json");
});

test("a device that did not win the kind leaves a pending collect run alone", () => {
  const k = kind("election");
  registerKindCapabilities(k, []);
  const pending = {
    id: "r-00000000000000000000000000000001",
    kind: k,
    state: "pending" as const,
    attempts: 0,
  };
  // The collector has been on longest, so it is the one the election picks.
  const claims = [claim(COLLECTOR), claim(READER, { claimedAt: NOW - 1000 })];
  expect(dueRuns([pending], claims, NOW, READER, { stallMs: 60_000 })).toEqual([]);
  expect(dueRuns([pending], claims, NOW, COLLECTOR, { stallMs: 60_000 })).toEqual([
    { run: pending, action: "take", reason: "elected" },
  ]);
});
