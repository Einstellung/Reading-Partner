// The run store, over a file system that is a Map. Two devices are two Maps and
// a call to mergeRun between them, which is exactly what sync does to the pair.

import { expect, test } from "bun:test";
import { mergeRun } from "../../../src/legion/run/merge";
import {
  createRunStore,
  deriveRunId,
  randomRunId,
  type RunIo,
  type RunStore,
} from "../../../src/legion/run/store";
import { MAX_ATTEMPTS, type Delegator, type Run } from "../../../src/legion/run/types";

interface Disk extends RunIo {
  files: Map<string, string>;
}

function disk(files = new Map<string, string>()): Disk {
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

const SOUL: Delegator = { kind: "soul" };
const PARENT: Delegator = { kind: "run", id: randomRunId() };

function brief(kind = "translate-book") {
  return { kind, delegator: SOUL, brief: `briefs/${kind}.json` };
}

async function pending(store: RunStore, kind = "translate-book"): Promise<Run> {
  const { run } = await store.create({ ...brief(kind), at: 1_000 });
  return run;
}

test("a run is created pending, with one revision and no tries yet", async () => {
  const store = createRunStore(disk());
  const { run, existing } = await store.create({ ...brief(), deliverTo: "soul", at: 1_000 });
  expect(existing).toBe(false);
  expect(run.state).toBe("pending");
  expect(run.attempts).toBe(0);
  expect(run.revision).toBe(1);
  expect(run.createdAt).toBe(1_000);
  expect(run.tier).toBe("synced");
  expect(run.deliverTo).toBe("soul");
  expect(run.idempotencyKey).toBeUndefined();
  expect(await store.get(run.id)).toEqual(run);
});

test("two devices fanning out the same step of the same batch write one file", async () => {
  const deskDisk = disk();
  const padDisk = disk();
  const desk = createRunStore(deskDisk);
  const pad = createRunStore(padDisk);
  const step = { batchId: PARENT.kind === "run" ? PARENT.id : "", step: "analyst:lab-3" };

  const mine = await desk.create({ ...brief("analyze"), delegator: PARENT, ...step, at: 1_000 });
  const theirs = await pad.create({ ...brief("analyze"), delegator: PARENT, ...step, at: 1_200 });

  expect(mine.run.id).toBe(theirs.run.id);
  expect(mine.run.id).toBe(await deriveRunId("analyze", `${step.batchId}:${step.step}`));
  expect(mine.run.idempotencyKey).toBe(`${step.batchId}:${step.step}`);
  expect([...deskDisk.files.keys()]).toEqual([...padDisk.files.keys()]);

  // What sync does with the pair: one run, created at the earlier moment.
  const merged = mergeRun(mine.run, theirs.run);
  expect(merged.id).toBe(mine.run.id);
  expect(merged.createdAt).toBe(1_000);
});

test("a second create against a running run hands back the same run and touches nothing", async () => {
  const io = disk();
  const store = createRunStore(io);
  const step = { batchId: "r-1", step: "collect:9" };
  const first = await store.create({ ...brief("collect"), ...step, at: 1_000 });
  await store.transition(first.run.id, "running", {
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
    at: 2_000,
  });
  const before = io.files.get(`${first.run.id}.json`);

  const again = await store.create({ ...brief("collect"), ...step, at: 9_000 });
  expect(again.existing).toBe(true);
  expect(again.run.id).toBe(first.run.id);
  expect(again.run.state).toBe("running");
  expect(io.files.size).toBe(1);
  expect(io.files.get(`${first.run.id}.json`)).toBe(before);
});

test("a second create against a finished run hands back what it produced", async () => {
  const store = createRunStore(disk());
  const step = { batchId: "r-1", step: "collect:9" };
  const first = await store.create({ ...brief("collect"), ...step, at: 1_000 });
  await store.transition(first.run.id, "running", {
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
  });
  await store.transition(first.run.id, "done", { output: "cables/2026-09-15.json", at: 4_000 });

  const again = await store.create({ ...brief("collect"), ...step, at: 9_000 });
  expect(again.existing).toBe(true);
  expect(again.run.state).toBe("done");
  expect(again.run.output).toBe("cables/2026-09-15.json");
  expect(again.run.endedAt).toBe(4_000);
});

test("a second create against a run that spent its attempts hands it back as it is", async () => {
  const store = createRunStore(disk());
  const step = { batchId: "r-1", step: "collect:9" };
  const first = await store.create({ ...brief("collect"), ...step, at: 1_000 });
  await store.transition(first.run.id, "running", {
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
    attempts: MAX_ATTEMPTS,
  });
  await store.transition(first.run.id, "failed", { output: "runs/why.md", at: 4_000 });

  const again = await store.create({ ...brief("collect"), ...step, at: 9_000 });
  expect(again.existing).toBe(true);
  expect(again.run.state).toBe("failed");
  expect(again.run.attempts).toBe(MAX_ATTEMPTS);
});

test("a run without a batch and a step gets an id of its own", async () => {
  const store = createRunStore(disk());
  const one = await store.create(brief());
  const two = await store.create(brief());
  expect(one.run.id).not.toBe(two.run.id);
  expect(one.run.id).toMatch(/^r-[0-9a-f]{32}$/);
});

// --- the chain -------------------------------------------------------------

test("taking a run up the chain stamps it and counts the try", async () => {
  const store = createRunStore(disk());
  const run = await pending(store);
  const started = await store.transition(run.id, "running", {
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
    at: 2_000,
  });
  expect(started.ok && started.run.state).toBe("running");
  expect(started.ok && started.run.attempts).toBe(1);
  expect(started.ok && started.run.startedAt).toBe(2_000);
  expect(started.ok && started.run.revision).toBe(2);

  const done = await store.transition(run.id, "done", { output: "out/book.epub", at: 4_000 });
  expect(done.ok && done.run.endedAt).toBe(4_000);
  expect(done.ok && done.run.output).toBe("out/book.epub");
  expect(done.ok && done.run.revision).toBe(3);
});

test("a move that is not forward on the chain is refused, and says why", async () => {
  const store = createRunStore(disk());
  const run = await pending(store);
  await store.transition(run.id, "running", { claimant: { deviceId: "desk-1", startedAt: 2_000 } });
  await store.transition(run.id, "done", { at: 4_000 });

  for (const next of ["pending", "running", "cancelled", "failed", "done"] as const) {
    const result = await store.transition(run.id, next);
    expect(`${next}: ${result.ok}`).toBe(`${next}: false`);
    expect(!result.ok && result.reason).toContain("only moves up the chain");
  }
  expect((await store.get(run.id))?.state).toBe("done");
});

test("a run cannot start with nobody doing it, and an unknown run cannot move at all", async () => {
  const store = createRunStore(disk());
  const run = await pending(store);
  const nobody = await store.transition(run.id, "running");
  expect(nobody.ok).toBe(false);
  expect(!nobody.ok && nobody.reason).toContain("claimant");

  const missing = await store.transition(randomRunId(), "running", {
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
  });
  expect(missing.ok).toBe(false);
});

// --- cancelling ------------------------------------------------------------

test("cancelling a pending run stops it outright", async () => {
  const store = createRunStore(disk());
  const run = await pending(store);
  const cancelled = await store.cancel(run.id, 3_000);
  expect(cancelled?.state).toBe("cancelled");
  expect(cancelled?.endedAt).toBe(3_000);
  expect(cancelled?.cancelRequested).toBe(true);
  expect(cancelled?.revision).toBe(2);
});

test("cancelling a running run writes the request and leaves it running", async () => {
  const store = createRunStore(disk());
  const run = await pending(store);
  await store.transition(run.id, "running", { claimant: { deviceId: "desk-1", startedAt: 2_000 } });

  const asked = await store.cancel(run.id, 3_000);
  expect(asked?.state).toBe("running");
  expect(asked?.cancelRequested).toBe(true);
  expect(asked?.endedAt).toBeUndefined();

  // Asking twice is one request: the executing device reads the same file.
  const again = await store.cancel(run.id, 3_500);
  expect(again?.revision).toBe(asked?.revision);

  // And the device doing the work is the one that ends it.
  const ended = await store.transition(run.id, "cancelled", { at: 3_800 });
  expect(ended.ok && ended.run.state).toBe("cancelled");
  expect(ended.ok && ended.run.endedAt).toBe(3_800);
});

test("cancelling a run that has already stopped changes nothing", async () => {
  const store = createRunStore(disk());
  const run = await pending(store);
  await store.transition(run.id, "running", { claimant: { deviceId: "desk-1", startedAt: 2_000 } });
  const done = await store.transition(run.id, "done", { at: 4_000 });
  const after = await store.cancel(run.id, 5_000);
  expect(after).toEqual(done.ok ? done.run : null);
  expect(await store.cancel(randomRunId())).toBeNull();
});

// --- progress and listing --------------------------------------------------

test("every report is written: the throttle is the runner's, not the store's", async () => {
  const store = createRunStore(disk());
  const run = await pending(store);
  await store.transition(run.id, "running", { claimant: { deviceId: "desk-1", startedAt: 2_000 } });

  const first = await store.report(run.id, "fetched 1/9", 2_100);
  const second = await store.report(run.id, "fetched 2/9", 2_150);
  expect(first?.progress).toBe("fetched 1/9");
  expect(second?.progress).toBe("fetched 2/9");
  expect(second?.lastProgressAt).toBe(2_150);
  expect(second!.revision).toBe(first!.revision + 1);
  expect(second?.state).toBe("running");
  expect(await store.report(randomRunId(), "nothing")).toBeNull();
});

test("runs are listed by state, kind, batch and the device doing them", async () => {
  const io = disk();
  const store = createRunStore(io);
  const one = await store.create({ ...brief("translate-book"), at: 1_000 });
  const two = await store.create({ ...brief("collect"), batchId: "r-9", step: "a", at: 1_100 });
  const three = await store.create({ ...brief("collect"), batchId: "r-9", step: "b", at: 1_200 });
  await store.transition(two.run.id, "running", {
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
  });
  await store.transition(three.run.id, "running", {
    claimant: { deviceId: "pad-1", startedAt: 2_000 },
  });

  const ids = (runs: Run[]) => runs.map((r) => r.id);
  expect(ids(await store.list())).toEqual([one.run.id, two.run.id, three.run.id]);
  expect(ids(await store.list({ state: "pending" }))).toEqual([one.run.id]);
  expect(ids(await store.list({ state: ["running", "done"] }))).toEqual([two.run.id, three.run.id]);
  expect(ids(await store.list({ kind: "collect" }))).toEqual([two.run.id, three.run.id]);
  expect(ids(await store.list({ batchId: "r-9" }))).toEqual([two.run.id, three.run.id]);
  expect(ids(await store.list({ deviceId: "pad-1" }))).toEqual([three.run.id]);
  expect(ids(await store.list({ kind: "collect", deviceId: "desk-1" }))).toEqual([two.run.id]);
});

test("a file that is not a run, and a name that is not a run id, are passed over", async () => {
  const io = disk();
  const store = createRunStore(io);
  const run = await pending(store);
  io.files.set("notes.txt", "not a run");
  io.files.set("r-0123456789abcdef0123456789abcdef.json", "{ broken");
  io.files.set("nonsense.json", JSON.stringify({ id: "nonsense", state: "done" }));

  expect((await store.list()).map((r) => r.id)).toEqual([run.id]);
  expect(await store.get("r-0123456789abcdef0123456789abcdef")).toBeNull();
  expect(await store.get("../secrets")).toBeNull();
});

test("two devices that both took the run keep one answer", async () => {
  const deskIo = disk();
  const padIo = disk();
  const desk = createRunStore(deskIo);
  const pad = createRunStore(padIo);
  const step = { batchId: "r-9", step: "collect:1" };

  const a = await desk.create({ ...brief("collect"), ...step, at: 1_000 });
  const b = await pad.create({ ...brief("collect"), ...step, at: 1_000 });
  await desk.transition(a.run.id, "running", {
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
  });
  const deskDone = await desk.transition(a.run.id, "done", { output: "out/desk.json", at: 4_000 });
  await pad.transition(b.run.id, "running", { claimant: { deviceId: "pad-1", startedAt: 2_100 } });
  const padDone = await pad.transition(b.run.id, "done", { output: "out/pad.json", at: 4_200 });

  const left = deskDone.ok ? deskDone.run : null;
  const right = padDone.ok ? padDone.run : null;
  const merged = mergeRun(left!, right!);
  expect(mergeRun(right!, left!)).toEqual(merged);
  // Same state, same revision, so the smaller deviceId settles it.
  expect(merged.output).toBe("out/desk.json");
  expect(merged.attempts).toBe(1);
});
