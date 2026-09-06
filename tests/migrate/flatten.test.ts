// Step 8: the per-topic observation directories emptied into the flat store
// (src/migrate/flatten.ts). Run twice everywhere, because the whole safety
// argument of this engine is that a step detects its own work rather than
// reading a flag. Run: bun test.

import { expect, test } from "bun:test";
import {
  parseObservation,
  parseTombstones,
  serializeObservation,
} from "../../src/memory/observations/files";
import type { Observation } from "../../src/memory/observations/types";
import { legacyObservationLayout } from "../../src/memory/observations/legacy";
import { stepFlattenObservations } from "../../src/migrate/flatten";
import { needsMigration } from "../../src/migrate/pending";
import { makeMemFs } from "./fixture";

const WIDE = "m-1111111111111111";
const OTHER = "m-2222222222222222";

function entry(id: string, summary: string, extra = ""): string {
  return `---\nid: ${id}\ntype: stuck-point\ncreated: 2026-08-01\nupdated: 2026-08-02\nsummary: ${summary}\n${extra}---\n\nbody of ${id}\n`;
}

test("every entry moves, carrying the directory's topic into its frontmatter", async () => {
  const { fs, files } = makeMemFs({
    [`memory-topic-a/${WIDE}.md`]: entry(WIDE, "stuck in a"),
    "memory-topic-a/index.md": "- [stuck-point] stale (updated 2026-08-02, id m-dead)\n",
    [`memory-topic-b/${OTHER}.md`]: entry(OTHER, "stuck in b"),
  });

  const step = await stepFlattenObservations(fs);
  expect(step.scanned).toBe(2);
  // Two entries moved and one stale index dropped: every source that goes is
  // a change, or the gate would not apply over a directory of bookkeeping.
  expect(step.changed).toBe(3);
  expect(step.counts.directoriesRemoved).toBe(2);

  expect(parseObservation(files.get(`observations/${WIDE}.md`) ?? "")?.topic).toBe("topic-a");
  expect(parseObservation(files.get(`observations/${OTHER}.md`) ?? "")?.topic).toBe("topic-b");
  expect(files.has(`memory-topic-a/${WIDE}.md`)).toBe(false);
  // The index is derived: the stale per-topic copy goes and one flat copy is
  // written, naming the topic of every line.
  expect(files.has("memory-topic-a/index.md")).toBe(false);
  const index = files.get("observations/index.md") ?? "";
  expect(index).toContain(`topic topic-a, id ${WIDE}`);
  expect(index).toContain(`topic topic-b, id ${OTHER}`);
  expect(index).not.toContain("m-dead");

  // Nothing left to do, and nothing left to hold the nightly pass back.
  const again = await stepFlattenObservations(fs);
  expect({ scanned: again.scanned, changed: again.changed }).toEqual({ scanned: 0, changed: 0 });
  expect(await needsMigration(fs)).toBe(false);
});

test("a topic the entry already names beats the directory it was found in", async () => {
  const { fs, files } = makeMemFs({
    // What a device that flattened first hands back over sync.
    [`memory-topic-a/${WIDE}.md`]: entry(WIDE, "stuck", "topic: topic-elsewhere\n"),
  });
  await stepFlattenObservations(fs);
  expect(parseObservation(files.get(`observations/${WIDE}.md`) ?? "")?.topic).toBe(
    "topic-elsewhere",
  );
});

test("tombstones are unioned and the bookkeeping keeps the higher of two watermarks", async () => {
  const { fs, files } = makeMemFs({
    "memory-topic-a/deleted-observations.jsonl":
      '{"id":"m-aaaa","at":"2026-08-20"}\n{"id":"m-bbbb","at":"2026-08-21"}\n',
    "memory-topic-a/meta.json": JSON.stringify({
      lastDistilledAt: 100,
      lastAnnotationDistillAt: 50,
      distilledMessages: { "thread-1": 4 },
      distilledMarks: { "book-1": 7 },
    }),
    // A conflict copy of the same file, holding cursors the live one never got.
    "memory-topic-a/meta.conflict-deadbeef.json": JSON.stringify({
      lastDistilledAt: 90,
      distilledMessages: { "thread-1": 9, "thread-2": 2 },
    }),
    "memory-topic-b/deleted-observations.jsonl": '{"id":"m-bbbb","at":"2026-08-22"}\n',
    "memory-topic-b/meta.json": JSON.stringify({
      lastDistilledAt: 300,
      distilledMarks: { "book-1": 3, "book-2": 5 },
    }),
  });

  const step = await stepFlattenObservations(fs);
  expect(step.counts.tombstonesMerged).toBe(2);
  expect(step.counts.metaFilesMerged).toBe(3);

  // One line per id, whichever directory it came from.
  const tombstones = parseTombstones(files.get("observations/deleted-observations.jsonl") ?? "");
  expect([...tombstones].sort()).toEqual(["m-aaaa", "m-bbbb"]);

  const meta = JSON.parse(files.get("observations/meta.json") ?? "{}");
  expect(meta.lastDistilledAt).toEqual({ "topic-a": 100, "topic-b": 300 });
  expect(meta.lastAnnotationDistillAt).toEqual({ "topic-a": 50 });
  // The higher watermark wins: a cursor that is too low costs a repeat, one that
  // is too high loses the material under it for good.
  expect(meta.distilledMessages).toEqual({ "thread-1": 9, "thread-2": 2 });
  expect(meta.distilledMarks).toEqual({ "book-1": 7, "book-2": 5 });

  expect(await stepFlattenObservations(fs)).toMatchObject({ changed: 0 });
});

test("a file the step cannot place is left alone, and so is the directory around it", async () => {
  const { fs, files } = makeMemFs({
    [`memory-topic-a/${WIDE}.md`]: entry(WIDE, "stuck"),
    "memory-topic-a/notes.txt": "something a person put here",
  });

  const step = await stepFlattenObservations(fs);
  expect(step.changed).toBe(1);
  expect(step.counts.directoriesRemoved).toBeUndefined();
  expect(step.unrepaired[0]?.what).toBe("memory-topic-a/notes.txt");
  expect(files.get("memory-topic-a/notes.txt")).toBe("something a person put here");
  // The directory is still there and the gate is open anyway: what it asks is
  // whether observation data is still addressed the old way, and none is.
  expect(await legacyObservationLayout(fs)).toBe(false);
});

// The second device: the first one ran the move, sync delivered observations/,
// and every destination this run wants is already there holding the same bytes.
// Refusing those is what shut the app on 0.14.5 (pitfall 236).
test("a destination sync already delivered takes the source with it", async () => {
  const delivered = serializeObservation({
    ...(parseObservation(entry(WIDE, "already moved")) as Observation),
    topic: "topic-a",
  });
  const { fs, files } = makeMemFs({
    [`observations/${WIDE}.md`]: delivered,
    [`memory-topic-a/${WIDE}.md`]: entry(WIDE, "already moved"),
  });

  const step = await stepFlattenObservations(fs);
  expect(step.unrepaired).toEqual([]);
  expect(step.counts.alreadyMoved).toBe(1);
  expect(step.changed).toBe(1);
  expect(step.counts.directoriesRemoved).toBe(1);
  expect(files.get(`observations/${WIDE}.md`)).toBe(delivered);
  expect(files.has(`memory-topic-a/${WIDE}.md`)).toBe(false);
  // The whole point: the gate reads the sources, and there are none left.
  expect(await legacyObservationLayout(fs)).toBe(false);
  expect(await needsMigration(fs)).toBe(false);

  const again = await stepFlattenObservations(fs);
  expect({ scanned: again.scanned, changed: again.changed }).toEqual({ scanned: 0, changed: 0 });
});

test("a directory holding only bookkeeping still counts as a change, so the gate applies", async () => {
  const { fs, files } = makeMemFs({
    "memory-topic-a/meta.json": JSON.stringify({ lastDistilledAt: 5 }),
    "memory-topic-a/index.md": "- stale line\n",
  });

  const step = await stepFlattenObservations(fs);
  expect(step.unrepaired).toEqual([]);
  expect(step.changed).toBeGreaterThan(0);
  expect(step.counts.directoriesRemoved).toBe(1);
  expect(files.has("memory-topic-a/meta.json")).toBe(false);
  expect(files.has("memory-topic-a/index.md")).toBe(false);
  expect(await legacyObservationLayout(fs)).toBe(false);
});

test("a version that disagrees is parked beside the destination, not over it", async () => {
  const { fs, files } = makeMemFs({
    [`observations/${WIDE}.md`]: entry(WIDE, "the copy already moved"),
    [`memory-topic-a/${WIDE}.md`]: entry(WIDE, "the copy sync pushed back"),
  });

  const step = await stepFlattenObservations(fs);
  expect(step.unrepaired).toEqual([]);
  expect(step.counts.parkedAsConflict).toBe(1);
  expect(step.changed).toBe(1);
  expect(files.get(`observations/${WIDE}.md`)).toContain("the copy already moved");
  expect(files.has(`memory-topic-a/${WIDE}.md`)).toBe(false);

  // Parked under a name the store already reads as a conflict copy.
  const parked = [...files.keys()].filter((k) =>
    new RegExp(`^observations/${WIDE}\\.conflict-[0-9a-f]+\\.md$`).test(k),
  );
  expect(parked).toHaveLength(1);
  expect(files.get(parked[0] as string)).toContain("the copy sync pushed back");
  expect(files.get(parked[0] as string)).toContain("topic: topic-a");
  expect(step.samples.some((line) => line.includes(parked[0] as string))).toBe(true);
  expect(await legacyObservationLayout(fs)).toBe(false);

  // Sync hands the same directory back: the name is a digest of the bytes, so
  // the second pass lands on the file it already wrote.
  files.set(`memory-topic-a/${WIDE}.md`, entry(WIDE, "the copy sync pushed back"));
  const again = await stepFlattenObservations(fs);
  expect(again.counts.parkedAsConflict).toBe(1);
  expect(
    [...files.keys()].filter((k) => k.startsWith(`observations/${WIDE}.conflict-`)),
  ).toHaveLength(1);
});

test("a conflict copy already in the flat store takes its source with it", async () => {
  const copy = entry(WIDE, "what the other device wrote");
  const { fs, files } = makeMemFs({
    [`observations/${WIDE}.conflict-deadbeef.md`]: copy,
    [`memory-topic-a/${WIDE}.conflict-deadbeef.md`]: copy,
    [`memory-topic-a/${WIDE}.conflict-c0ffee.md`]: entry(WIDE, "a third version"),
    [`observations/${WIDE}.conflict-c0ffee.md`]: entry(WIDE, "not the same third version"),
  });

  const step = await stepFlattenObservations(fs);
  expect(step.unrepaired).toEqual([]);
  expect(step.counts.alreadyMoved).toBe(1);
  expect(step.counts.parkedAsConflict).toBe(1);
  expect(files.get(`observations/${WIDE}.conflict-c0ffee.md`)).toContain(
    "not the same third version",
  );
  expect([...files.keys()].some((k) => k.startsWith("memory-topic-a/"))).toBe(false);
  expect(await legacyObservationLayout(fs)).toBe(false);
});

test("a conflict copy travels byte for byte, with no topic written into it", async () => {
  const copy = entry(WIDE, "what the other device wrote");
  const { fs, files } = makeMemFs({
    [`memory-topic-a/${WIDE}.conflict-deadbeef.md`]: copy,
    [`memory-topic-a/${WIDE}.md`]: entry(WIDE, "what this device wrote"),
  });

  const step = await stepFlattenObservations(fs);
  expect(step.counts.conflictCopiesMoved).toBe(1);
  expect(files.get(`observations/${WIDE}.conflict-deadbeef.md`)).toBe(copy);
  // The index is built from entry files only; a copy is a second version of one
  // observation, not a second observation.
  expect((files.get("observations/index.md") ?? "").split("\n").filter(Boolean)).toHaveLength(1);
});

test("nothing on disk means nothing written, so the button is safe on a fresh install", async () => {
  const { fs, files } = makeMemFs({});
  const step = await stepFlattenObservations(fs);
  expect({ scanned: step.scanned, changed: step.changed }).toEqual({ scanned: 0, changed: 0 });
  expect([...files.keys()]).toEqual([]);
  expect(await needsMigration(fs)).toBe(false);
});
