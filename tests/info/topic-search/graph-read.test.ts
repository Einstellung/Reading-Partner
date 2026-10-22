// The graph expansion's file (docs/info/92 「数据」): its shape on disk, one file
// per round, and a lenient read that drops what does not parse.

import { expect, test } from "bun:test";
import {
  DOI_ONLY_TITLES,
  emptyGraphRead,
  GRAPH_READ_2_FILE,
  GRAPH_READ_FILE,
  graphStreamId,
  loadGraphRead,
  parseGraphRead,
  saveGraphRead,
  withDoiOnly,
  withStream,
  type GraphPositive,
  type GraphStream,
} from "../../../src/info/topic-search/graph-read";
import type { StateFs } from "../../../src/info/topic-search/run-state";

function memFs(): StateFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (p) => files.has(p),
    readText: async (p) => {
      const text = files.get(p);
      if (text === undefined) throw new Error(`no ${p}`);
      return text;
    },
    writeAtomic: async (p, text) => void files.set(p, text),
    appendText: async (p, text) => void files.set(p, (files.get(p) ?? "") + text),
    mkdirp: async () => {},
  };
}

const seed: GraphPositive = {
  key: "arxiv:2401.00001",
  title: "A seed",
  why: "seed",
  s2: "abc",
  openAlex: null,
  citationCount: 12,
  walked: true,
};

const stream = (over: Partial<GraphStream> = {}): GraphStream => ({
  id: "rec",
  kind: "rec",
  from: [seed.key],
  library: "s2",
  outcome: "ok",
  total: 100,
  papers: [
    {
      arxivId: "2609.01234",
      title: "Found",
      abstract: "An abstract.",
      authors: ["A. Author"],
      publishedAt: "2026-09-03",
      citationCount: 0,
    },
  ],
  at: "2026-10-22T08:00:00.000Z",
  ...over,
});

test("stream ids name the walk and the positive it walked from", () => {
  expect(graphStreamId("rec")).toBe("rec");
  expect(graphStreamId("cites", seed.key)).toBe("cites:arxiv:2401.00001");
  expect(graphStreamId("refs", seed.key)).toBe("refs:arxiv:2401.00001");
  expect(() => graphStreamId("cites")).toThrow();
});

test("each round has its own file, and a read comes back as written", async () => {
  const fs = memFs();
  let read = emptyGraphRead([seed], ["arxiv:2401.00009"]);
  read = withStream(read, stream());
  read = withStream(read, stream({ id: "cites:arxiv:2401.00001", kind: "cites", outcome: "hub", total: 0, papers: [] }));
  await saveGraphRead(fs, "runs/r1", read);
  await saveGraphRead(fs, "runs/r1", emptyGraphRead([], []), 2);
  expect([...fs.files.keys()]).toEqual([`runs/r1/${GRAPH_READ_FILE}`, `runs/r1/${GRAPH_READ_2_FILE}`]);
  expect(await loadGraphRead(fs, "runs/r1")).toEqual(read);
  expect((await loadGraphRead(fs, "runs/r1", 2))?.streams).toEqual([]);
  expect(await loadGraphRead(fs, "runs/none")).toBeNull();
});

test("a stream read again replaces the one on file", () => {
  let read = withStream(emptyGraphRead([seed], []), stream({ outcome: "cooling_down", library: null, papers: [] }));
  read = withStream(read, stream({ id: "refs:arxiv:2401.00001", kind: "refs" }));
  read = withStream(read, stream());
  expect(read.streams.map((s) => [s.id, s.outcome])).toEqual([
    ["rec", "ok"],
    ["refs:arxiv:2401.00001", "ok"],
  ]);
});

test("DOI-only papers are counted, and only the first few titles kept", () => {
  let read = emptyGraphRead([], []);
  read = withDoiOnly(read, ["a", "b", "c"]);
  read = withDoiOnly(read, ["d", "e", "f", "g"]);
  expect(read.doiOnly.count).toBe(7);
  expect(read.doiOnly.titles).toEqual(["a", "b", "c", "d", "e"].slice(0, DOI_ONLY_TITLES));
});

test("another version or broken JSON reads as nothing on file", () => {
  expect(parseGraphRead("{not json")).toBeNull();
  expect(parseGraphRead(JSON.stringify({ ...emptyGraphRead([], []), version: 2 }))).toBeNull();
  expect(parseGraphRead(JSON.stringify({ version: 1 }))).toBeNull();
  expect(parseGraphRead("null")).toBeNull();
});

test("rows that do not read are dropped, the rest kept", () => {
  const good = stream();
  const text = JSON.stringify({
    version: 1,
    positives: [seed, { key: "arxiv:x", title: "No why" }, { ...seed, key: "arxiv:2401.00002", why: "yes", citationCount: "many" }],
    negatives: ["arxiv:2401.00009", 7],
    streams: [
      good,
      { ...good, id: "cites:arxiv:2401.00001", kind: "sideways" },
      { ...good, id: "refs:arxiv:2401.00001", kind: "refs", outcome: "exploded" },
      { ...good, id: "refs:arxiv:2401.00002", kind: "refs", papers: [{ title: "no id" }, good.papers[0]], library: "bing" },
      { ...good, outcome: "failed", papers: [] },
    ],
    doiOnly: { count: 3, titles: ["t1", 2, "t3"] },
  });
  const read = parseGraphRead(text);
  expect(read?.positives.map((p) => [p.key, p.citationCount])).toEqual([
    ["arxiv:2401.00001", 12],
    ["arxiv:2401.00002", null],
  ]);
  expect(read?.negatives).toEqual(["arxiv:2401.00009"]);
  // The second "rec" was written last and wins; the bad kind and outcome are gone.
  expect(read?.streams.map((s) => [s.id, s.outcome, s.library, s.papers.length])).toEqual([
    ["refs:arxiv:2401.00002", "ok", null, 1],
    ["rec", "failed", "s2", 0],
  ]);
  expect(read?.doiOnly).toEqual({ count: 3, titles: ["t1", "t3"] });
});
