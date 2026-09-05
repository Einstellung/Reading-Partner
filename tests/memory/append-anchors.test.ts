// Anchoring more evidence to an observation without rewriting it
// (ObservationFileStore.appendAnchors). Run: bun test.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseObservation } from "../../src/memory/observations/files";
import { ObservationFileStore } from "../../src/memory/observations/store";
import { JULY_17, JULY_20, makeFakeFs } from "./fakefs";

function makeStore(now: () => number = () => JULY_17) {
  const { fs, files } = makeFakeFs();
  return { store: new ObservationFileStore("topic-1", fs, now), files };
}

const BODY = "Term frequency saturation via k1 didn't click.\n\nSee m-0123456789abcdef.";

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function seed(store: ObservationFileStore) {
  return store.create({
    type: "stuck-point",
    summary: "Stuck on BM25 saturation",
    body: BODY,
    anchors: { annotationIds: ["ann-1"], messageIds: ["thread-1:1750000000000"] },
    observed: { first: "2026-07-10", last: "2026-07-11" },
  });
}

test("appending anchors leaves the body byte for byte where it was", async () => {
  const { store, files } = makeStore();
  const entry = await seed(store);
  const before = digest(entry.body);

  const grown = await store.appendAnchors(
    entry.id,
    { annotationIds: ["ann-2"], messageIds: ["thread-2:1750100000000"] },
    { first: "2026-07-19", last: "2026-07-19" },
  );

  expect(digest(grown?.body ?? "")).toBe(before);
  expect(grown?.summary).toBe(entry.summary);
  // And on disk, not only in the returned object.
  const reread = parseObservation(files.get(`memory-topic-1/${entry.id}.md`) as string);
  expect(digest(reread?.body ?? "")).toBe(before);
});

test("anchors are appended and de-duplicated, one list at a time", async () => {
  const { store } = makeStore();
  const entry = await seed(store);

  await store.appendAnchors(entry.id, { annotationIds: ["ann-2", "ann-1"] });
  const grown = await store.appendAnchors(entry.id, { messageIds: ["thread-1:1750000000000"] });

  expect(grown?.anchors.annotationIds).toEqual(["ann-1", "ann-2"]);
  expect(grown?.anchors.messageIds).toEqual(["thread-1:1750000000000"]);
  expect(await store.appendAnchors("m-0000000000000000", { annotationIds: ["ann-9"] })).toBeNull();
});

test("updated moves to the day the new evidence covers, and never backwards", async () => {
  const { store } = makeStore();
  const entry = await seed(store);
  expect(entry.created).toBe("2026-07-10");
  expect(entry.updated).toBe("2026-07-11");

  const later = await store.appendAnchors(
    entry.id,
    { annotationIds: ["ann-2"] },
    { first: "2026-07-19", last: "2026-07-19" },
  );
  expect(later?.created).toBe("2026-07-10");
  expect(later?.updated).toBe("2026-07-19");
  // The index is derived from the entry files, so it moves with them.
  expect((await store.readIndex())[0].updated).toBe("2026-07-19");

  // A pass folding in an older conversation must not make the observation look
  // older than what it already carries.
  const older = await store.appendAnchors(
    entry.id,
    { annotationIds: ["ann-3"] },
    { first: "2026-07-01", last: "2026-07-02" },
  );
  expect(older?.updated).toBe("2026-07-19");
});

// The clock is the fallback and nothing more: it is reached only where the new
// evidence carries no day at all, which in practice is a live conversation.
test("evidence with no day of its own is dated by the clock", async () => {
  const { store } = makeStore(() => JULY_20);
  const entry = await seed(store);
  const grown = await store.appendAnchors(entry.id, { messageIds: ["thread-3:1750200000000"] });
  expect(grown?.updated).toBe("2026-07-20");
});
