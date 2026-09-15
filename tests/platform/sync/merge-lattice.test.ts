// The lattice strategy, end to end: a run file merged the way sync will merge
// it. What the join itself guarantees is tested in tests/legion/run/merge.test.ts
// — this is the socket, the dispatch and the fallback.
//
// Importing src/legion/run is what registers the join, and that import is the
// whole of the wiring: platform may not reach into legion, so the domain plugs
// itself in.

import { expect, test } from "bun:test";
import "../../../src/box";
import "../../../src/legion/run";
import { PALACE, rowOf } from "../../../src/palace";
import { mergeFile } from "../../../src/platform/sync/merge";
import { strategyFor } from "../../../src/platform/sync/merge/contract";
import {
  isLatticeRegistered,
  latticeFor,
  registerLattice,
} from "../../../src/platform/sync/merge/lattice";
import type { Run } from "../../../src/legion/run";

const enc = new TextEncoder();
const dec = new TextDecoder();

const PATH = rowOf("run").samples[0]!;

function run(over: Partial<Run>): Uint8Array {
  const value: Run = {
    id: PATH.slice(PATH.lastIndexOf("/") + 1, -".json".length),
    kind: "translate-book",
    tier: "synced",
    delegator: { kind: "soul" },
    brief: "briefs/one.json",
    state: "pending",
    attempts: 0,
    createdAt: 1_000,
    revision: 1,
    ...over,
  };
  return enc.encode(JSON.stringify(value, null, 2));
}

function merged(local: Uint8Array, remote: Uint8Array, base: Uint8Array | null = null) {
  const out = mergeFile({ path: PATH, base, local, remote });
  return { ...out, value: JSON.parse(dec.decode(out.merged)) as Run };
}

test("every kind the table merges as a lattice has a join registered", () => {
  const lattices = PALACE.filter((row) => row.merge === "lattice").map((row) => row.kind);
  expect(lattices).toEqual(["run", "box-item"]);
  for (const kind of lattices) expect(`${kind}: ${isLatticeRegistered(kind)}`).toBe(`${kind}: true`);
  expect(strategyFor(PATH)).toBe("lattice");
  expect(latticeFor(PATH)).not.toBeNull();
  // A kind that merges some other way has none, so nothing falls into this by
  // matching a path loosely.
  expect(latticeFor("library.json")).toBeNull();
});

test("a run file is joined, and the two devices land on the same bytes", () => {
  const local = run({ state: "running", revision: 2, claimant: { deviceId: "desk-1", startedAt: 2_000 } });
  const remote = run({ state: "done", revision: 3, output: "out/book.epub", endedAt: 4_000 });

  const mine = merged(local, remote);
  const theirs = merged(remote, local);
  expect(dec.decode(mine.merged)).toBe(dec.decode(theirs.merged));
  expect(mine.value.state).toBe("done");
  expect(mine.value.output).toBe("out/book.epub");
  // One side was simply further along: nothing was in contention.
  expect(mine.contested).toBe(false);
  expect(mine.dropped).toEqual([]);
});

test("the base does not take part: a join has no use for what the two sides were", () => {
  const base = run({ state: "pending", revision: 1 });
  const local = run({ state: "running", revision: 2, claimant: { deviceId: "desk-1", startedAt: 2_000 } });
  const remote = run({ state: "failed", revision: 4, endedAt: 4_000 });
  expect(dec.decode(merged(local, remote, base).merged)).toBe(
    dec.decode(merged(local, remote, null).merged),
  );
});

test("two devices that finished the same run at the same revision report the collision", () => {
  const local = run({ state: "done", revision: 3, output: "out/desk.json" });
  const remote = run({ state: "done", revision: 3, output: "out/pad.json" });
  const out = merged(local, remote);
  expect(out.contested).toBe(true);
  expect(out.dropped).toHaveLength(1);
  expect(out.dropped[0]!.id).toBe(rowOf("run").match(PATH)!.id!);
  expect((out.dropped[0]!.record as Run).output).toBe("out/pad.json");
  expect(out.value.output).toBe("out/desk.json");
  expect(out.copies).toEqual([]);
});

test("a file under the run path that is not a run is kept whole rather than half-read", () => {
  const local = enc.encode(JSON.stringify({ hello: "world" }, null, 2));
  const remote = enc.encode(JSON.stringify({ hello: "there" }, null, 2));
  const out = mergeFile({ path: PATH, base: null, local, remote });
  expect(out.copies).toHaveLength(1);
  expect(out.contested).toBe(true);
});

test("a kind with nobody registered falls back to keeping both copies", () => {
  // Put the real join back whatever happens: the registry is one per process,
  // and a test file that left it empty would take the file after it down with it.
  const original = latticeFor(PATH)!;
  registerLattice("run", () => null);
  try {
    const out = mergeFile({
      path: PATH,
      base: null,
      local: run({ state: "done", revision: 3 }),
      remote: run({ state: "failed", revision: 9 }),
    });
    expect(out.copies).toHaveLength(1);
    expect(out.contested).toBe(true);
  } finally {
    registerLattice("run", original);
  }
  expect(isLatticeRegistered("run")).toBe(true);
});
