// The flat store's topic addressing (src/memory/observations/store.ts) and the
// rule that says the old per-topic layout is still on disk
// (src/memory/observations/legacy.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  isLegacyObservationDir,
  isLegacyObservationFile,
  legacyObservationDirs,
  legacyObservationLayout,
  type LegacyLayoutFs,
} from "../../src/memory/observations/legacy";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import { ObservationFileStore, topicPassStore } from "../../src/memory/observations/store";
import { JULY_17, JULY_20, makeFakeFs } from "./fakefs";

function makeStore(now: () => number = () => JULY_17) {
  const { fs, files } = makeFakeFs();
  return { store: new ObservationFileStore(fs, now), files };
}

// --- the topic field --------------------------------------------------------

test("everything written through an adapter carries the topic it is mounted on", async () => {
  const { store, files } = makeStore();
  const entry = await new FileObservationAdapter(store, "topic-a").retain({
    type: "stuck-point",
    summary: "k1 saturation",
    body: "did not click",
  });

  expect(entry.topic).toBe("topic-a");
  expect(files.get(`observations/${entry.id}.md`)).toContain("topic: topic-a");
  // One directory for the whole library, not one per topic.
  expect([...files.keys()].every((k) => k.startsWith("observations/"))).toBe(true);
});

test("two topics share one directory and each one lists only its own", async () => {
  const { store } = makeStore();
  const a = new FileObservationAdapter(store, "topic-a");
  const b = new FileObservationAdapter(store, "topic-b");
  const first = await a.retain({ type: "belief", summary: "a1", body: "a1" });
  const second = await b.retain({ type: "belief", summary: "b1", body: "b1" });

  expect((await a.listObservations()).map((e) => e.id)).toEqual([first.id]);
  expect((await b.listObservations()).map((e) => e.id)).toEqual([second.id]);
  expect((await store.list()).map((e) => e.id).sort()).toEqual([first.id, second.id].sort());
  // An id is global, so a read by id needs no topic and never has to guess one.
  expect((await store.get(second.id))?.summary).toBe("b1");
});

test("the index file names each line's topic and a topic's projection drops it", async () => {
  const { store, files } = makeStore();
  const a = await new FileObservationAdapter(store, "topic-a").retain({
    type: "belief",
    summary: "about a",
    body: "a",
  });
  await new FileObservationAdapter(store, "topic-b").retain({
    type: "belief",
    summary: "about b",
    body: "b",
  });

  const file = files.get("observations/index.md") ?? "";
  expect(file).toContain("topic topic-a");
  expect(file).toContain("topic topic-b");

  const projection = await store.readIndexText("topic-a");
  expect(projection).toContain("about a");
  expect(projection).not.toContain("about b");
  // No topic id in front of a model: the projection is already one topic's.
  expect(projection).not.toContain("topic ");
  expect(projection).toContain(`id ${a.id}`);
  expect((await store.readIndex("topic-a")).map((e) => e.id)).toEqual([a.id]);
});

// --- meta.json --------------------------------------------------------------

test("one topic's stamp does not move another's, and the cursors are shared", async () => {
  const { store, files } = makeStore();
  await store.setMeta("topic-a", {
    lastDistilledAt: 111,
    lastAnnotationDistillAt: null,
    distilledMessages: { "thread-1": 4 },
  });
  await store.setMeta("topic-b", {
    lastDistilledAt: 222,
    lastAnnotationDistillAt: null,
    distilledMessages: { "thread-1": 4, "thread-2": 9 },
  });

  expect((await store.getMeta("topic-a")).lastDistilledAt).toBe(111);
  expect((await store.getMeta("topic-b")).lastDistilledAt).toBe(222);
  // The cursor maps are keyed by thread and by book, which are already global,
  // so both topics read the same ones.
  expect((await store.getMeta("topic-a")).distilledMessages).toEqual({
    "thread-1": 4,
    "thread-2": 9,
  });
  expect(JSON.parse(files.get("observations/meta.json") ?? "{}").lastDistilledAt).toEqual({
    "topic-a": 111,
    "topic-b": 222,
  });
});

test("a topic with no bookkeeping of its own reads null, not another topic's", async () => {
  const { store } = makeStore();
  await store.setMeta("topic-a", { lastDistilledAt: 111, lastAnnotationDistillAt: 99 });
  const other = await store.getMeta("topic-b");
  expect(other.lastDistilledAt).toBeNull();
  expect(other.lastAnnotationDistillAt).toBeNull();
});

test("the pass store binds the three calls a distillation pass makes to one topic", async () => {
  const { store } = makeStore(() => JULY_20);
  await new FileObservationAdapter(store, "topic-a").retain({
    type: "belief",
    summary: "about a",
    body: "a",
  });
  await new FileObservationAdapter(store, "topic-b").retain({
    type: "belief",
    summary: "about b",
    body: "b",
  });
  const pass = topicPassStore(store, "topic-a");
  await pass.setMeta({ lastDistilledAt: 7, lastAnnotationDistillAt: null });

  expect((await pass.getMeta()).lastDistilledAt).toBe(7);
  expect((await store.getMeta("topic-b")).lastDistilledAt).toBeNull();
  expect(await pass.readIndexText()).toContain("about a");
  expect(await pass.readIndexText()).not.toContain("about b");
});

// --- the old layout ---------------------------------------------------------

test("a per-topic directory is one named for a topic, not the bare prefix", () => {
  expect(isLegacyObservationDir("memory-topic-1")).toBe(true);
  expect(isLegacyObservationDir("memory-")).toBe(false);
  expect(isLegacyObservationDir("observations")).toBe(false);
  expect(isLegacyObservationDir("memory-usage-device1.jsonl")).toBe(true);
});

test("the files that count are the ones the move knows what to do with", () => {
  for (const name of [
    "m-aaaaaa01.md",
    "m-1111111111111111.md",
    "m-1111111111111111.conflict-deadbeef.md",
    "index.md",
    "index.conflict-deadbeef.md",
    "meta.json",
    "meta.conflict-deadbeef.json",
    "deleted-observations.jsonl",
  ]) {
    expect(isLegacyObservationFile(name)).toBe(true);
  }
  // Anything else in there is not observation data. Counting it would hold the
  // nightly pass shut for good over a file nothing reads.
  expect(isLegacyObservationFile("notes.txt")).toBe(false);
  expect(isLegacyObservationFile(".DS_Store")).toBe(false);
});

function layoutFs(dirs: Record<string, string[]>): LegacyLayoutFs {
  return {
    async listSubdirs() {
      return Object.keys(dirs);
    },
    async listDir(path) {
      return dirs[path] ?? [];
    },
  };
}

test("one directory still holding observation data is enough to stand the night down", async () => {
  const fs = layoutFs({
    observations: ["m-1111111111111111.md", "index.md"],
    "memory-a": [".DS_Store"],
    "memory-b": ["m-2222222222222222.md"],
  });
  expect(await legacyObservationLayout(fs)).toBe(true);
  expect(await legacyObservationDirs(fs)).toEqual(["memory-b"]);
});

test("a flattened store, and an emptied directory beside it, let the night through", async () => {
  const flat = layoutFs({ observations: ["m-1111111111111111.md", "meta.json"] });
  expect(await legacyObservationLayout(flat)).toBe(false);
  expect(await legacyObservationLayout(layoutFs({ "memory-a": [] }))).toBe(false);
  expect(await legacyObservationLayout(layoutFs({}))).toBe(false);
});
