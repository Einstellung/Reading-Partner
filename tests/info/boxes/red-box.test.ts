// The day's rooms into the Red Box (src/info/boxes/red-box.ts), over a box store
// whose disk is a Map. Run: bun test.

import { expect, test } from "bun:test";
import { createBoxStore, UNSEEN, type BoxIo } from "../../../src/box/store";
import { originLabel } from "../../../src/soul/delivery";
import {
  briefingBoxId,
  deliverBriefing,
  labIdOfKind,
  labItemKind,
} from "../../../src/info/boxes/red-box";
import { BRIEFING_VERSION, type Briefing } from "../../../src/info/boxes/types";

function disk(): BoxIo {
  const files = new Map<string, string>();
  return {
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, contents) {
      files.set(name, contents);
    },
  };
}

function briefing(over: Partial<Briefing> = {}): Briefing {
  return {
    version: BRIEFING_VERSION,
    date: "2026-09-16",
    generatedAt: 1_758_000_000_000,
    labs: [
      { labId: "lab-a", name: "Room A", cover: "A moved.", judgments: [] },
      { labId: "lab-b", name: "Room B", cover: "B moved.", judgments: [] },
    ],
    quiet: [],
    mustRead: [],
    oneLiners: [],
    outOfLane: [],
    items: {},
    ...over,
  };
}

test("one item per room that changed, cover named, body a reference", async () => {
  const box = createBoxStore(disk());
  const { put } = await deliverBriefing(briefing(), box);

  expect(put.length).toBe(2);
  const items = await box.list();
  expect(items.map((i) => i.cover).sort()).toEqual(["Room A: A moved.", "Room B: B moved."]);
  for (const item of items) {
    expect(item.source).toBe("cable");
    expect(item.state).toBe("in-box");
    expect(item.needsDecision).toBe(false);
    expect(item.boxId).toBe(briefingBoxId(briefing()));
    expect(item.origin).toEqual({ place: "briefing", date: "2026-09-16" });
    expect(item.createdAt).toBe(1_758_000_000_000);
    expect(item.body).toBe(`briefing-2026-09-16.json#${labIdOfKind(item.kind)}`);
  }
  expect(items.map((i) => i.kind).sort()).toEqual([labItemKind("lab-a"), labItemKind("lab-b")]);
  // What the badge counts and what the secretary is handed each turn
  // (soul/self.ts) is this one filter, which asks about the state and not about
  // where the item came from.
  expect((await box.open(UNSEEN)).length).toBe(2);
  expect(originLabel(items[0].origin)).toBe("the briefing of 2026-09-16");
});

test("a quiet day puts nothing", async () => {
  const box = createBoxStore(disk());
  await deliverBriefing(briefing({ labs: [], quiet: ["Room A"] }), box);
  expect(await box.list()).toEqual([]);
});

test("the same briefing twice is the same two items", async () => {
  const box = createBoxStore(disk());
  await deliverBriefing(briefing(), box);
  const first = await box.list();
  await deliverBriefing(briefing(), box);
  const second = await box.list();

  expect(second.length).toBe(2);
  expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id));
  expect(second.map((i) => i.revision)).toEqual([1, 1]);
});

test("a regenerate the same day is another box", async () => {
  const box = createBoxStore(disk());
  await deliverBriefing(briefing(), box);
  const again = briefing({ generatedAt: 1_758_000_900_000 });
  const { put, superseded } = await deliverBriefing(again, box);

  expect(put.map((i) => i.boxId)).toEqual([briefingBoxId(again), briefingBoxId(again)]);
  expect(superseded.length).toBe(2);
  expect((await box.open({ state: "in-box" })).length).toBe(2);
});

test("the next day closes the rooms the reader never got to, and only those", async () => {
  const box = createBoxStore(disk());
  const day1 = briefing();
  await deliverBriefing(day1, box);

  // The reader went to room A's card; room B is still waiting.
  const roomA = (await box.list()).find((i) => i.kind === labItemKind("lab-a"));
  expect(roomA).toBeDefined();
  await box.setState(roomA!.id, "told");

  const day2 = briefing({
    date: "2026-09-17",
    generatedAt: 1_758_086_400_000,
    labs: [
      { labId: "lab-a", name: "Room A", cover: "A moved again.", judgments: [] },
      { labId: "lab-b", name: "Room B", cover: "B moved again.", judgments: [] },
    ],
  });
  const { superseded } = await deliverBriefing(day2, box);

  expect(superseded.map((i) => i.kind)).toEqual([labItemKind("lab-b")]);
  const byId = new Map((await box.list()).map((i) => [i.id, i]));
  expect(byId.size).toBe(4);
  expect(byId.get(roomA!.id)?.state).toBe("told");
  const yesterdayB = [...byId.values()].find(
    (i) => i.boxId === briefingBoxId(day1) && i.kind === labItemKind("lab-b"),
  );
  expect(yesterdayB?.state).toBe("dismissed");
  expect((await box.open({ state: "in-box" })).length).toBe(2);
});

test("a room that was quiet today keeps the item it has", async () => {
  const box = createBoxStore(disk());
  await deliverBriefing(briefing(), box);
  const day2 = briefing({
    date: "2026-09-17",
    generatedAt: 1_758_086_400_000,
    labs: [{ labId: "lab-a", name: "Room A", cover: "A moved again.", judgments: [] }],
    quiet: ["Room B"],
  });
  const { superseded } = await deliverBriefing(day2, box);

  expect(superseded.map((i) => i.kind)).toEqual([labItemKind("lab-a")]);
  const open = await box.open({ state: "in-box" });
  expect(open.map((i) => i.cover).sort()).toEqual(["Room A: A moved again.", "Room B: B moved."]);
});

test("an item the reader dismissed is not put back by a re-save", async () => {
  const box = createBoxStore(disk());
  const { put } = await deliverBriefing(briefing(), box);
  await box.setState(put[0].id, "dismissed");
  await deliverBriefing(briefing(), box);

  expect((await box.get(put[0].id))?.state).toBe("dismissed");
});
