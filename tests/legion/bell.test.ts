// The bell store (src/legion/bell): ring, read, ack, and the mailbox order the
// run ledger depends on — the whole message on disk before any state moves, and
// the state only ever moving up.
// Run: scripts/t.sh tests/legion/bell.test.ts

import { expect, test } from "bun:test";
import { BRIEF_MAX, createBellStore, type BellIo, type BellStore } from "../../src/legion/bell";

// A disk of one Map, plus the order of the writes: what went to a file before
// what is the property half these tests are about.
function disk(): { io: BellIo; files: Map<string, string>; writes: string[] } {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const io: BellIo = {
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    write: async (name, contents) => {
      files.set(name, contents);
      writes.push(name);
    },
  };
  return { io, files, writes };
}

function store(): { bells: BellStore; files: Map<string, string>; writes: string[] } {
  const d = disk();
  return { bells: createBellStore(d.io), files: d.files, writes: d.writes };
}

test("a run-done bell is written whole, queued, under the run it is about", async () => {
  const { bells, files } = store();
  const bell = await bells.ring(
    "run-done",
    { runId: "r1", kind: "translate-book", brief: "chapter 3 is translated", output: "runs/r1/out" },
    { at: 10 },
  );

  expect(bell.id).toBe("run-done-r1");
  expect(bell.state).toBe("queued");
  expect([...files.keys()]).toEqual(["run-done-r1.json"]);
  // The file holds the message, not a pointer to one: a soul that starts after a
  // crash answers the bell out of this and nothing else.
  const onDisk = JSON.parse(files.get("run-done-r1.json")!);
  expect(onDisk).toEqual({
    id: "run-done-r1",
    type: "run-done",
    at: 10,
    state: "queued",
    payload: { runId: "r1", kind: "translate-book", brief: "chapter 3 is translated", output: "runs/r1/out" },
  });
});

test("a brief longer than the cap is cut, and the bell says so", async () => {
  const { bells } = store();
  const bell = await bells.ring("run-done", {
    runId: "r1",
    kind: "collect",
    brief: "x".repeat(BRIEF_MAX + 500),
  });
  if (bell.type !== "run-done") throw new Error("wrong type");
  expect(bell.payload.brief.length).toBe(BRIEF_MAX);
  expect(bell.payload.truncated).toBe(true);
});

test("read lists what is not acked, oldest first", async () => {
  const { bells } = store();
  await bells.ring("run-failed", { runId: "r2", kind: "collect", reason: "attempts used up" }, { at: 30 });
  await bells.ring("run-done", { runId: "r1", kind: "collect", brief: "done" }, { at: 10 });
  await bells.ring("wake", { scheduleId: "nightly", brief: "run the night shift" }, { at: 20 });

  expect((await bells.read()).map((b) => b.id)).toEqual([
    "run-done-r1",
    "wake-nightly-20",
    "run-failed-r2",
  ]);
});

test("delivered then acked, and neither goes back", async () => {
  const { bells } = store();
  await bells.ring("run-done", { runId: "r1", kind: "collect", brief: "done" }, { at: 10 });

  await bells.delivered("run-done-r1");
  expect((await bells.get("run-done-r1"))?.state).toBe("delivered");
  // The soul is behind on its own bookkeeping, or a second pass repeats itself:
  // either way a bell that has been delivered is not queued again.
  await bells.delivered("run-done-r1");
  expect((await bells.get("run-done-r1"))?.state).toBe("delivered");
  expect((await bells.read()).map((b) => b.id)).toEqual(["run-done-r1"]);

  await bells.ack("run-done-r1");
  expect((await bells.get("run-done-r1"))?.state).toBe("acked");
  expect(await bells.read()).toEqual([]);
  await bells.delivered("run-done-r1");
  expect((await bells.get("run-done-r1"))?.state).toBe("acked");
});

test("an unacked bell is in the set to recover; an acked one is not", async () => {
  const { bells } = store();
  await bells.ring("run-done", { runId: "r1", kind: "collect", brief: "one" }, { at: 10 });
  await bells.ring("run-done", { runId: "r2", kind: "collect", brief: "two" }, { at: 20 });
  await bells.delivered("run-done-r1");
  await bells.ack("run-done-r1");

  // Delivered is not acked: a soul that wrote the reply down and died before it
  // acked still finds the bell here.
  await bells.delivered("run-done-r2");
  expect((await bells.read()).map((b) => b.id)).toEqual(["run-done-r2"]);
});

test("ringing the same bell twice leaves one, whatever state it reached", async () => {
  const { bells, files, writes } = store();
  await bells.ring("run-done", { runId: "r1", kind: "collect", brief: "first" }, { at: 10 });
  await bells.delivered("run-done-r1");
  // A runner re-entered after a crash rings again for the run it already
  // finished. The bell it finds is the one it rang, not a second one, and not a
  // queued copy of a bell the soul has already taken delivery of.
  const again = await bells.ring("run-done", { runId: "r1", kind: "collect", brief: "second" }, { at: 99 });

  expect(files.size).toBe(1);
  expect(again.at).toBe(10);
  expect(again.state).toBe("delivered");
  if (again.type !== "run-done") throw new Error("wrong type");
  expect(again.payload.brief).toBe("first");
  expect(writes).toEqual(["run-done-r1.json", "run-done-r1.json"]);
});

test("a wake rings once per time it comes due", async () => {
  const { bells } = store();
  await bells.ring("wake", { scheduleId: "nightly", brief: "night shift" }, { at: 10 });
  await bells.ring("wake", { scheduleId: "nightly", brief: "night shift" }, { at: 20 });
  expect((await bells.read()).map((b) => b.id)).toEqual(["wake-nightly-10", "wake-nightly-20"]);
});

test("an id that is not a file name is refused rather than escaped", async () => {
  const { bells } = store();
  await expect(
    bells.ring("run-done", { runId: "r1", kind: "collect", brief: "b" }, { id: "../escape" }),
  ).rejects.toThrow(/not a usable bell id/);
});

test("a file that will not parse is skipped, not answered and not deleted", async () => {
  const d = disk();
  const bells = createBellStore(d.io);
  d.files.set("run-done-broken.json", "{ not json");
  await bells.ring("run-done", { runId: "r1", kind: "collect", brief: "done" }, { at: 10 });

  expect((await bells.read()).map((b) => b.id)).toEqual(["run-done-r1"]);
  expect(d.files.has("run-done-broken.json")).toBe(true);
});
