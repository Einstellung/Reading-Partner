// The box store, over a file system that is a Map. Two devices are two Maps and
// a call to mergeBoxItem between them, which is exactly what sync does to the
// pair.

import { expect, test } from "bun:test";
import { mergeBoxItem } from "../../src/box/merge";
import {
  UNSEEN,
  createBoxStore,
  randomBoxItemId,
  type PutBoxItemInput,
} from "../../src/box/store";
import type { BoxItem, BoxItemState } from "../../src/box/types";
import { mapDisk as disk, type MapDisk } from "../support/map-disk";

const RUN_ORIGIN = { place: "book", bookId: "abc123", threadId: "t1" } as const;

function input(over: Partial<PutBoxItemInput> = {}): PutBoxItemInput {
  return {
    boxId: "batch-1",
    source: "run",
    cover: "The translation of chapter 4 is ready.",
    origin: RUN_ORIGIN,
    at: 1_000,
    ...over,
  };
}

test("an item goes in in-box, at revision one, and comes back by id", async () => {
  const store = createBoxStore(disk());
  const item = await store.put(input({ body: "out/ch4.md", kind: "translate", runId: "r-1" }));

  expect(item.state).toBe("in-box");
  expect(item.stateAt).toBe(1_000);
  expect(item.createdAt).toBe(1_000);
  expect(item.revision).toBe(1);
  expect(item.needsDecision).toBe(false);
  expect(item.id).toMatch(/^b-[0-9a-f]{32}$/);
  expect(await store.get(item.id)).toEqual(item);
  expect(await store.get("b-ffffffffffffffffffffffffffffffff")).toBeNull();
  expect(await store.get("not-an-id")).toBeNull();
});

test("a put under an id already taken does not write a second cover", async () => {
  const store = createBoxStore(disk());
  const id = randomBoxItemId();
  const first = await store.put(input({ id }));
  const second = await store.put(input({ id, cover: "something else entirely", at: 9_000 }));

  expect(second).toEqual(first);
  expect(second.cover).toBe(first.cover);
});

test("list is newest first; open and openCount leave the exits out", async () => {
  const store = createBoxStore(disk());
  const old = await store.put(input({ at: 1_000, cover: "one" }));
  const mid = await store.put(input({ at: 2_000, cover: "two" }));
  const fresh = await store.put(input({ at: 3_000, cover: "three", boxId: "batch-2" }));

  expect((await store.list()).map((i) => i.cover)).toEqual(["three", "two", "one"]);
  expect(await store.openCount()).toBe(3);

  await store.setState(mid.id, "told", 4_000);
  await store.setState(old.id, "dismissed", 5_000);

  expect((await store.open()).map((i) => i.id)).toEqual([fresh.id, mid.id]);
  expect(await store.openCount()).toBe(2);
  expect((await store.list()).length).toBe(3);

  // The box a delivery made is the unit the reader is shown.
  expect(await store.openCount({ boxId: "batch-2" })).toBe(1);
  expect((await store.list({ boxId: "batch-1" })).length).toBe(2);
});

test("an item the reader jumped to is still open, but no longer unseen", async () => {
  const store = createBoxStore(disk());
  const seen = await store.put(input({ at: 1_000, cover: "one" }));
  const waiting = await store.put(input({ at: 2_000, cover: "two" }));

  await store.setState(seen.id, "told", 3_000);

  expect((await store.open()).map((i) => i.id)).toEqual([waiting.id, seen.id]);
  expect((await store.open(UNSEEN)).map((i) => i.id)).toEqual([waiting.id]);
  expect(await store.openCount(UNSEEN)).toBe(1);

  // Asked is the same: the reader has been there, the secretary has not finished.
  await store.setState(waiting.id, "asked", 4_000);
  expect(await store.openCount()).toBe(2);
  expect(await store.openCount(UNSEEN)).toBe(0);
});

test("a state moves once per write and the revision goes up with it", async () => {
  const store = createBoxStore(disk());
  const item = await store.put(input());

  const told = await store.setState(item.id, "told", 2_000);
  expect(told).toMatchObject({ state: "told", stateAt: 2_000, revision: 2 });
  const asked = await store.setState(item.id, "asked", 3_000);
  expect(asked).toMatchObject({ state: "asked", stateAt: 3_000, revision: 3 });
});

test("saying the same state again is not a new generation", async () => {
  const store = createBoxStore(disk());
  const item = await store.put(input());
  await store.setState(item.id, "told", 2_000);
  const again = await store.setState(item.id, "told", 9_000);

  expect(again).toMatchObject({ state: "told", stateAt: 2_000, revision: 2 });
});

test("an exit is final: a later state is refused and the item comes back unchanged", async () => {
  const store = createBoxStore(disk());
  const item = await store.put(input());
  const gone = await store.setState(item.id, "dismissed", 2_000);
  expect(gone).toMatchObject({ state: "dismissed", revision: 2 });

  for (const state of ["told", "asked", "saved", "in-box"] as BoxItemState[]) {
    const refused = await store.setState(item.id, state, 3_000);
    expect(refused).toEqual(gone!);
  }
  expect(await store.setState("b-ffffffffffffffffffffffffffffffff", "told")).toBeNull();
});

test("subscribe fires on put and on a state that moved, and not on a refusal", async () => {
  const store = createBoxStore(disk());
  const seen: string[] = [];
  const off = store.subscribe((item) => seen.push(`${item.state}@${item.revision}`));

  const item = await store.put(input());
  await store.setState(item.id, "told", 2_000);
  await store.setState(item.id, "saved", 3_000);
  await store.setState(item.id, "told", 4_000);
  off();
  await store.setState(item.id, "dismissed", 5_000);

  expect(seen).toEqual(["in-box@1", "told@2", "saved@3"]);
});

test("a file that will not parse is skipped and left where it is", async () => {
  const d = disk();
  const store = createBoxStore(d);
  const item = await store.put(input());
  d.files.set("b-00000000000000000000000000000000.json", "{ not json");
  d.files.set("notes.txt", "hello");

  expect((await store.list()).map((i) => i.id)).toEqual([item.id]);
  expect(d.files.has("b-00000000000000000000000000000000.json")).toBe(true);
});

// Two devices, two disks, one item. Sync merges the pair; both then hold what
// the merge produced, and the box says the same thing on each.
async function sync(a: MapDisk, b: MapDisk, id: string): Promise<BoxItem> {
  const name = `${id}.json`;
  const left = JSON.parse(a.files.get(name)!) as BoxItem;
  const right = JSON.parse(b.files.get(name)!) as BoxItem;
  const merged = mergeBoxItem(left, right);
  const text = JSON.stringify(merged, null, 2);
  a.files.set(name, text);
  b.files.set(name, text);
  return merged;
}

test("the item read on the iPad and dismissed on the desktop converges on dismissed", async () => {
  const pad = disk();
  const desk = disk();
  const onPad = createBoxStore(pad);
  const onDesk = createBoxStore(desk);

  const id = randomBoxItemId();
  const born = await onPad.put(input({ id }));
  desk.files.set(`${id}.json`, JSON.stringify(born, null, 2));

  await onPad.setState(id, "told", 2_000);
  await onDesk.setState(id, "dismissed", 2_100);

  const merged = await sync(pad, desk, id);
  expect(merged.state).toBe("dismissed");
  expect((await onPad.get(id))!.state).toBe("dismissed");
  expect((await onDesk.get(id))!.state).toBe("dismissed");
  expect(await onPad.openCount()).toBe(0);
  expect(await onDesk.openCount()).toBe(0);

  // And the exit holds afterwards on the device that had not made it.
  expect((await onPad.setState(id, "asked", 3_000))!.state).toBe("dismissed");
});

test("two devices that both put their own items end up holding both", async () => {
  const pad = disk();
  const desk = disk();
  const mine = await createBoxStore(pad).put(input({ cover: "from the pad", at: 1_000 }));
  const theirs = await createBoxStore(desk).put(input({ cover: "from the desk", at: 2_000 }));

  // Sync carries a file neither side has, which needs no merge at all.
  for (const [name, text] of pad.files) desk.files.set(name, text);
  for (const [name, text] of desk.files) pad.files.set(name, text);

  const ids = (await createBoxStore(pad).list()).map((i) => i.id);
  expect(ids).toEqual([theirs.id, mine.id]);
  expect(await createBoxStore(desk).openCount()).toBe(2);
});
