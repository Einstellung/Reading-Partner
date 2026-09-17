// The box item merge is the join of a semilattice, so the three properties that
// makes true are what is tested: commutative, associative, idempotent. Together
// they are the whole of what sync needs — two devices merging the same copies in
// either order, in any grouping, any number of times, land on the same item.
//
// The property tests run over a generator rather than over hand-picked pairs,
// because the cases that break associativity are the ones nobody thinks to
// write down. The generator is a few lines of arithmetic with a fixed seed: no
// library, and a failure is reproducible from the seed printed beside it.

import { expect, test } from "bun:test";
import {
  asBoxItem,
  collided,
  compareBoxItem,
  joinBoxItemFiles,
  mergeBoxItem,
} from "../../src/box/merge";
import { BOX_ITEM_STATES, isExit, type BoxItem, type BoxItemState } from "../../src/box/types";
import type { Json } from "../../src/platform/sync/merge/text";

const ID = "b-0123456789abcdef0123456789abcdef";

// A 32-bit linear congruential generator. Deterministic, and its whole job is
// to be varied enough to hit the corners.
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function itemFor(next: () => number): BoxItem {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const maybe = <T,>(value: T): T | undefined => (next() < 0.5 ? value : undefined);

  const item: BoxItem = {
    id: ID,
    boxId: pick(["batch-1", "batch-2"]),
    source: pick(["run", "cable"] as const),
    cover: pick(["chapter 4 is translated", "the run could not finish"]),
    origin: { place: "door", date: "2026-09-15" },
    needsDecision: next() < 0.3,
    createdAt: 1_000 + Math.floor(next() * 3),
    state: pick(BOX_ITEM_STATES),
    stateAt: 2_000 + Math.floor(next() * 4),
    revision: 1 + Math.floor(next() * 4),
  };
  const body = maybe(pick(["out/a.md", "out/b.md"]));
  if (body !== undefined) item.body = body;
  const kind = maybe(pick(["translate", "summarise"]));
  if (kind !== undefined) item.kind = kind;
  const runId = maybe(pick(["r-1", "r-2"]));
  if (runId !== undefined) item.runId = runId;
  return item;
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

test("merging two copies of an item is commutative", () => {
  for (const seed of SEEDS) {
    const next = rng(seed);
    const a = itemFor(next);
    const b = itemFor(next);
    expect({ seed, item: mergeBoxItem(a, b) }).toEqual({ seed, item: mergeBoxItem(b, a) });
  }
});

test("merging three copies of an item is associative", () => {
  for (const seed of SEEDS) {
    const next = rng(seed);
    const a = itemFor(next);
    const b = itemFor(next);
    const c = itemFor(next);
    expect({ seed, item: mergeBoxItem(mergeBoxItem(a, b), c) }).toEqual({
      seed,
      item: mergeBoxItem(a, mergeBoxItem(b, c)),
    });
  }
});

test("merging an item with itself, or with a merge it is already in, changes nothing", () => {
  for (const seed of SEEDS) {
    const next = rng(seed);
    const a = itemFor(next);
    const b = itemFor(next);
    expect({ seed, item: mergeBoxItem(a, a) }).toEqual({ seed, item: a });
    const once = mergeBoxItem(a, b);
    expect({ seed, item: mergeBoxItem(once, b) }).toEqual({ seed, item: once });
    expect({ seed, item: mergeBoxItem(once, once) }).toEqual({ seed, item: once });
  }
});

test("an item merged with copies of itself is the same whatever order they arrive in", () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const next = rng(seed);
    const copies = [itemFor(next), itemFor(next), itemFor(next), itemFor(next)];
    const forwards = copies.reduce((acc, item) => mergeBoxItem(acc, item));
    const backwards = [...copies].reverse().reduce((acc, item) => mergeBoxItem(acc, item));
    expect({ seed, item: forwards }).toEqual({ seed, item: backwards });
  }
});

// --- the order -------------------------------------------------------------

function item(over: Partial<BoxItem>): BoxItem {
  return {
    id: ID,
    boxId: "batch-1",
    source: "run",
    cover: "chapter 4 is translated",
    origin: { place: "door", date: "2026-09-15" },
    needsDecision: false,
    createdAt: 1_000,
    state: "in-box",
    stateAt: 1_000,
    revision: 1,
    ...over,
  };
}

const OPEN: BoxItemState[] = ["in-box", "told", "asked"];
const EXITS: BoxItemState[] = ["dismissed", "saved", "promoted", "folded", "aggregated"];

test("an exit beats an open state, whatever the revisions say", () => {
  for (const open of OPEN) {
    for (const exit of EXITS) {
      const a = item({ state: open, revision: 9, stateAt: 9_000 });
      const b = item({ state: exit, revision: 1, stateAt: 2_000 });
      expect(`${open} + ${exit}: ${mergeBoxItem(a, b).state}`).toBe(`${open} + ${exit}: ${exit}`);
      expect(`${exit} + ${open}: ${mergeBoxItem(b, a).state}`).toBe(`${exit} + ${open}: ${exit}`);
    }
  }
});

test("inside a class the higher revision wins, then the later stateAt", () => {
  const told = item({ state: "told", revision: 2, stateAt: 2_000 });
  const asked = item({ state: "asked", revision: 3, stateAt: 2_500 });
  for (const merged of [mergeBoxItem(told, asked), mergeBoxItem(asked, told)]) {
    expect(merged.state).toBe("asked");
    expect(merged.revision).toBe(3);
  }

  // Two exits at one revision: the one the reader did later.
  const dismissed = item({ state: "dismissed", revision: 2, stateAt: 3_000 });
  const saved = item({ state: "saved", revision: 2, stateAt: 3_100 });
  for (const merged of [mergeBoxItem(dismissed, saved), mergeBoxItem(saved, dismissed)]) {
    expect(merged.state).toBe("saved");
  }
});

test("an item was born once, so createdAt is the earlier of the two", () => {
  const early = item({ createdAt: 500, revision: 1 });
  const late = item({ createdAt: 4_000, state: "told", revision: 2, stateAt: 4_000 });
  for (const merged of [mergeBoxItem(early, late), mergeBoxItem(late, early)]) {
    expect(merged.createdAt).toBe(500);
    expect(merged.state).toBe("told");
  }
});

test("an item that is only further along did not collide; two writes of one generation did", () => {
  const a = item({ state: "told", revision: 2, stateAt: 2_000 });
  const b = item({ state: "asked", revision: 3, stateAt: 3_000 });
  expect(collided(a, b)).toBe(false);

  const dismissed = item({ state: "dismissed", revision: 2, stateAt: 3_000 });
  const saved = item({ state: "saved", revision: 2, stateAt: 3_100 });
  expect(collided(dismissed, saved)).toBe(true);
  expect(collided(dismissed, dismissed)).toBe(false);
});

test("a field only one side ever wrote is a collision, settled by content", () => {
  const bare = item({ state: "told", revision: 2, stateAt: 2_000 });
  const bodied = item({ state: "told", revision: 2, stateAt: 2_000, body: "out/a.md" });
  expect(collided(bare, bodied)).toBe(true);
  const merged = mergeBoxItem(bare, bodied);
  expect(mergeBoxItem(bodied, bare)).toEqual(merged);
  expect([bare, bodied]).toContainEqual(merged);

  // createdAt is folded, so a side that only knows the item is older is not a
  // second write of the same generation.
  expect(collided(item({ createdAt: 500 }), item({ createdAt: 900 }))).toBe(false);
});

test("the comparator answers zero only when the two are indistinguishable", () => {
  expect(compareBoxItem(item({}), item({}))).toBe(0);
  expect(compareBoxItem(item({}), item({ cover: "another line" }))).not.toBe(0);
});

test("two copies of two different items are not one item", () => {
  expect(() => mergeBoxItem(item({}), item({ id: "b-ffffffffffffffffffffffffffffffff" }))).toThrow();
});

// --- the shape sync hands in ----------------------------------------------

test("a file that is not an item is left to the opaque strategy", () => {
  expect(asBoxItem(null)).toBeNull();
  expect(asBoxItem([item({})])).toBeNull();
  expect(asBoxItem({ ...item({}), state: "read" })).toBeNull();
  expect(asBoxItem({ ...item({}), source: "letter" })).toBeNull();
  expect(asBoxItem({ ...item({}), revision: "2" })).toBeNull();
  expect(asBoxItem(item({}))).not.toBeNull();
});

test("the join reports a loser only when the two sides collided", () => {
  const ahead = joinBoxItemFiles(
    item({ state: "told", revision: 2, stateAt: 2_000 }) as unknown as Json,
    item({ state: "asked", revision: 3, stateAt: 3_000 }) as unknown as Json,
  );
  expect(ahead?.loser).toBeNull();
  expect((ahead?.merged as unknown as BoxItem).state).toBe("asked");

  const left = item({ state: "dismissed", revision: 2, stateAt: 3_000 }) as unknown as Json;
  const right = item({ state: "saved", revision: 2, stateAt: 3_100 }) as unknown as Json;
  const clash = joinBoxItemFiles(left, right);
  expect((clash?.merged as unknown as BoxItem).state).toBe("saved");
  expect(clash?.loser).toEqual(left);

  expect(joinBoxItemFiles(left, { hello: "world" } as unknown as Json)).toBeNull();
  expect(
    joinBoxItemFiles(left, item({ id: "b-ffffffffffffffffffffffffffffffff" }) as unknown as Json),
  ).toBeNull();
});

test("every state is one of the two classes and nothing is in both", () => {
  expect(BOX_ITEM_STATES.filter(isExit)).toEqual(EXITS);
  expect(BOX_ITEM_STATES.filter((s) => !isExit(s))).toEqual(OPEN);
});
