// The Red Box item a link intake keeps while no topic is picked
// (src/reading/ingest/intake-box.ts, topic-intake.ts, lumen/box-jump.ts and
// box-cards.ts): put when the run is handed over, still there after the reader
// follows it, out on the pick, and out at once when the pick came before the
// fetch finished. The intake store and the box both run for real over memory.
// Run: scripts/t.sh tests/reading/ingest/intake-box.test.ts

import { expect, test } from "bun:test";
import { createBoxStore, UNSEEN, type BoxStore } from "../../../src/box";
import {
  exitIntakeItem,
  INTAKE_BOX_KIND,
  intakeBoxItemId,
  intakeIdOfItem,
} from "../../../src/reading/ingest/intake-box";
import { chooseIntakeTopic, startTopicIntake } from "../../../src/reading/ingest/topic-intake";
import { planItemJump, stateAfterFollow, staysUntilDecided } from "../../../src/ui/components/lumen/box-jump";
import { cardsHere } from "../../../src/ui/components/lumen/box-cards";
import { mapDisk } from "../../support/map-disk";
import { memoryIntakes } from "./intake-fixtures";

const DOOR = { place: "door", date: "2026-10-08" } as const;
const DOC = { hash: "h1", title: "A book", format: "epub" as const, sections: 4, pages: 30, chars: 9000, path: "library/h1.epub" };

async function started(box: BoxStore) {
  const s = memoryIntakes();
  const run = await startTopicIntake("https://x.com/a/status/1", undefined, {
    store: s.store,
    box,
    origin: DOOR,
    start: async () => ({ runId: "r-1" }),
  });
  return { ...s, ...run };
}

test("the item's id is the intake's UUID, or a stable digest of any other id", () => {
  expect(intakeBoxItemId("0f8e2a1c-1234-4abc-9def-0123456789ab")).toBe("b-0f8e2a1c12344abc9def0123456789ab");
  expect(intakeBoxItemId("in-1")).toMatch(/^b-[0-9a-f]{32}$/);
  expect(intakeBoxItemId("in-1")).toBe(intakeBoxItemId("in-1"));
  expect(intakeBoxItemId("in-1")).not.toBe(intakeBoxItemId("in-2"));
});

test("starting an intake at the door puts one item: the run's box, the door's origin, a decision to make", async () => {
  const box = createBoxStore(mapDisk());
  const s = await started(box);
  const items = await box.open(UNSEEN);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    id: intakeBoxItemId(s.intakeId),
    boxId: "r-1",
    kind: INTAKE_BOX_KIND,
    body: s.intakeId,
    origin: DOOR,
    needsDecision: true,
    state: "in-box",
  });
  expect(items[0].cover).toContain("x.com");
  expect(intakeIdOfItem(items[0])).toBe(s.intakeId);
});

test("following it opens the door conversation of its day at the card, and leaves it in the box", async () => {
  const box = createBoxStore(mapDisk());
  const s = await started(box);
  const [item] = await box.open(UNSEEN);
  expect(planItemJump(item, { shell: "phone", inReader: false, openBookId: null })).toEqual({
    steps: [{ step: "open-door-chat", date: "2026-10-08", focus: { intakeId: s.intakeId } }],
    unreachable: null,
  });
  expect(staysUntilDecided(item)).toBe(true);
  expect(stateAfterFollow(item)).toBeNull();
  // An ordinary card is still told when followed.
  expect(stateAfterFollow({ kind: "ingest-url", body: "Took in X" })).toBe("told");
  expect(await box.openCount(UNSEEN)).toBe(1);
});

test("picking a topic after the run filed attaches and takes the item out", async () => {
  const box = createBoxStore(mapDisk());
  const s = await started(box);
  await s.store.filed(s.intakeId, { documents: [DOC], skipped: [] });
  await chooseIntakeTopic(s.intakeId, "t-pi", { store: s.store, box });
  expect(s.attached).toEqual([{ topicId: "t-pi", path: DOC.path, hash: "h1" }]);
  expect((await box.get(intakeBoxItemId(s.intakeId)))!.state).toBe("saved");
  expect(await box.openCount(UNSEEN)).toBe(0);
});

test("a pick before the fetch finished takes the item out at once; filing later attaches", async () => {
  const box = createBoxStore(mapDisk());
  const s = await started(box);
  await chooseIntakeTopic(s.intakeId, "t-pi", { store: s.store, box });
  expect(await box.openCount(UNSEEN)).toBe(0);
  expect(s.attached).toEqual([]);
  await s.store.filed(s.intakeId, { documents: [DOC], skipped: [] });
  expect(s.attached).toEqual([{ topicId: "t-pi", path: DOC.path, hash: "h1" }]);
});

test("on the pick, the run's own card in the same delivery folds; on a failure it stays", async () => {
  const box = createBoxStore(mapDisk());
  const s = await started(box);
  const bell = await box.put({ boxId: "r-1", source: "run", cover: "Took in A book.", origin: DOOR, at: 5 });
  await chooseIntakeTopic(s.intakeId, "t-pi", { store: s.store, box });
  expect((await box.get(bell.id))!.state).toBe("folded");

  const box2 = createBoxStore(mapDisk());
  const s2 = await started(box2);
  const failedBell = await box2.put({ boxId: "r-1", source: "run", cover: "It failed.", origin: DOOR, at: 5 });
  await exitIntakeItem(box2, s2.intakeId, "dismissed");
  expect((await box2.get(intakeBoxItemId(s2.intakeId)))!.state).toBe("dismissed");
  expect((await box2.get(failedBell.id))!.state).toBe("in-box");
});

test("no origin, or no box, puts nothing", async () => {
  const box = createBoxStore(mapDisk());
  const s = memoryIntakes();
  await startTopicIntake("https://a.test/x", undefined, { store: s.store, box, start: async () => ({ runId: "r-2" }) });
  await startTopicIntake("https://a.test/y", undefined, {
    store: s.store,
    box: null,
    origin: DOOR,
    start: async () => ({ runId: "r-3" }),
  });
  expect(await box.openCount(UNSEEN)).toBe(0);
});

test("a device without the intake record neither lists nor counts its card; one with it hides the run's card under it", async () => {
  const box = createBoxStore(mapDisk());
  const s = await started(box);
  await box.put({ boxId: "r-1", source: "run", cover: "Took in A book.", origin: DOOR, at: 5 });
  const other = await box.put({ boxId: "r-9", source: "run", cover: "Another run.", origin: DOOR, at: 6 });
  const open = await box.open(UNSEEN);

  const here = await cardsHere(open, async (id) => (await s.store.get(id)) !== null);
  expect(here.map((item) => item.id).sort()).toEqual([intakeBoxItemId(s.intakeId), other.id].sort());

  const elsewhere = await cardsHere(open, async () => false);
  expect(elsewhere.map((item) => item.cover).sort()).toEqual(["Another run.", "Took in A book."]);
});
