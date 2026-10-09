// The link intake record (src/reading/ingest/intake-store.ts): the run filing and
// the reader picking a topic, in either order, and whichever comes second
// attaching. Everything runs against an in-memory file map and a recording
// topic shelf. Run: scripts/t.sh tests/reading/ingest/intake-store.test.ts

import { expect, test } from "bun:test";
import {
  intakePath,
  parseIntake,
  type IntakeDocument,
  type IntakeFiling,
} from "../../../src/reading/ingest/intake-store";
import { watchIntake } from "../../../src/reading/ingest/topic-intake";
import { memoryIntakes } from "./intake-fixtures";

function doc(hash: string, over: Partial<IntakeDocument> = {}): IntakeDocument {
  return { hash, title: `Doc ${hash}`, format: "article", sections: 3, pages: 4, chars: 900, path: `library/${hash}.epub`, ...over };
}

const FILING: IntakeFiling = { documents: [doc("h1"), doc("h2")], skipped: [] };

test("a new intake is reading, names the link's host and has no topic", async () => {
  const { store, files } = memoryIntakes();
  const intake = await store.create({ url: "https://x.com/a/status/1", note: "the repo" });
  expect(intake).toMatchObject({
    id: "in-1",
    url: "https://x.com/a/status/1",
    note: "the repo",
    state: "reading",
    host: "x.com",
    documents: [],
    topicId: null,
    attachedTo: null,
  });
  expect(parseIntake(files.get(intakePath("in-1"))!)).toEqual(intake);
});

test("picked before the run files: the run attaches every document on filing", async () => {
  const { store, attached } = memoryIntakes();
  const { id } = await store.create({ url: "https://a.test/x" });
  const picked = await store.choose(id, "t-a");
  expect(picked).toMatchObject({ state: "reading", topicId: "t-a", attachedTo: null });
  expect(attached).toEqual([]);

  const filed = await store.filed(id, FILING);
  expect(filed).toMatchObject({ state: "filed", host: null, topicId: "t-a", attachedTo: "t-a" });
  expect(attached).toEqual([
    { topicId: "t-a", path: "library/h1.epub", hash: "h1" },
    { topicId: "t-a", path: "library/h2.epub", hash: "h2" },
  ]);
});

test("filed before the pick: the documents wait unattached, and the pick attaches them", async () => {
  const { store, attached } = memoryIntakes();
  const { id } = await store.create({ url: "https://a.test/x" });
  const filed = await store.filed(id, FILING);
  expect(filed).toMatchObject({ state: "filed", topicId: null, attachedTo: null });
  expect(attached).toEqual([]);

  const picked = await store.choose(id, "t-b");
  expect(picked).toMatchObject({ topicId: "t-b", attachedTo: "t-b" });
  expect(attached.map((a) => [a.topicId, a.hash])).toEqual([
    ["t-b", "h1"],
    ["t-b", "h2"],
  ]);
});

test("picking again before filing replaces the pick; after attaching it changes nothing", async () => {
  const { store, attached } = memoryIntakes();
  const { id } = await store.create({ url: "https://a.test/x" });
  await store.choose(id, "t-a");
  await store.choose(id, "t-b");
  await store.filed(id, FILING);
  expect(attached.every((a) => a.topicId === "t-b")).toBe(true);
  expect(attached).toHaveLength(2);

  const again = await store.choose(id, "t-c");
  expect(again).toMatchObject({ topicId: "t-b", attachedTo: "t-b" });
  expect(attached).toHaveLength(2);
});

test("a pick and the filing at the same moment attach once", async () => {
  const { store, attached } = memoryIntakes();
  const { id } = await store.create({ url: "https://a.test/x" });
  const [picked, filed] = await Promise.all([store.choose(id, "t-a"), store.filed(id, FILING)]);
  expect(picked.topicId).toBe("t-a");
  expect(filed.attachedTo).toBe("t-a");
  expect(attached).toHaveLength(2);
});

test("nothing filed: the intake fails with why, and a pick attaches nothing", async () => {
  const { store, attached } = memoryIntakes();
  const { id } = await store.create({ url: "https://x.com/a/status/2" });
  const ended = await store.filed(id, {
    documents: [],
    skipped: [{ url: "https://x.com/a/article/2", reason: "a long-form post needs a signed-in desktop" }],
    aiNote: "Only the post itself was readable.",
    emptyReason: "Read @a's post. Nothing became a document.",
  });
  expect(ended).toMatchObject({
    state: "failed",
    reason: "Read @a's post. Nothing became a document.",
    aiNote: "Only the post itself was readable.",
    documents: [],
  });
  expect(ended.skipped).toEqual([{ url: "https://x.com/a/article/2", reason: "a long-form post needs a signed-in desktop" }]);
  const picked = await store.choose(id, "t-a");
  expect(picked.attachedTo).toBeNull();
  expect(attached).toEqual([]);
});

test("a failure lands only while reading, and progress only while reading", async () => {
  const { store } = memoryIntakes();
  const { id } = await store.create({ url: "https://a.test/x" });
  expect((await store.progress(id, "b.test")).host).toBe("b.test");
  await store.filed(id, FILING);
  expect((await store.failed(id, "late")).state).toBe("filed");
  expect((await store.progress(id, "c.test")).host).toBeNull();

  const other = await store.create({ url: "https://a.test/y" });
  const failed = await store.failed(other.id, "Could not fetch the page (404).");
  expect(failed).toMatchObject({ state: "failed", host: null, reason: "Could not fetch the page (404)." });
});

test("an unknown intake is null to read and an error to change", async () => {
  const { store } = memoryIntakes();
  expect(await store.get("nope")).toBeNull();
  await expect(store.choose("nope", "t-a")).rejects.toThrow(/no link intake/);
  expect(parseIntake("not json")).toBeNull();
  expect(parseIntake(JSON.stringify({ id: "x", url: "u", state: "odd" }))).toBeNull();
});

test("every write is announced by id, and the watch keeps one object until it changes", async () => {
  const { store } = memoryIntakes();
  const { id } = await store.create({ url: "https://a.test/x" });
  const heard: string[] = [];
  const off = store.subscribe((changed) => heard.push(changed));

  const watch = watchIntake(id, store);
  let pings = 0;
  const unwatch = watch.subscribe(() => pings++);
  await watch.refresh();
  const first = watch.snapshot();
  expect(first?.state).toBe("reading");
  await watch.refresh();
  expect(watch.snapshot()).toBe(first);

  await store.filed(id, FILING);
  await watch.refresh();
  expect(watch.snapshot()?.state).toBe("filed");
  expect(watch.snapshot()).not.toBe(first);
  expect(heard).toEqual([id]);
  expect(pings).toBe(2);
  unwatch();
  off();
});
