// The topic-search config (src/info/topic-search): the pure file and update
// logic, the store over an in-memory AppData, the first-run estimate and the
// drafting guidance (docs/info/88). Run: scripts/t.sh tests/info/topic-search

import { beforeEach, expect, test } from "bun:test";
import { createFakeAppData, type FakeAppData } from "../../support/guarded-appdata";
import {
  TOPIC_SEARCHES_FILE,
  changeTopicSearch,
  loadTopicSearches,
  putTopicSearch,
} from "../../../src/info/topic-search/store";
import {
  applyTopicSearchUpdate,
  isEmptyUpdate,
  isOpenStudy,
  newTopicSearchId,
  nightlyTopicSearches,
  numberQueries,
  numberSubtopics,
  parseTopicSearchesFile,
  resolveTopicSearch,
  stopTopicSearch,
} from "../../../src/info/topic-search/topic-searches";
import { firstRunEta } from "../../../src/info/topic-search/eta";
import { topicSearchGuidance } from "../../../src/info/topic-search/guidance";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import type { Statement } from "../../../src/memory";
import { WEBVIEW_FETCH, type DeviceClaim } from "../../../src/legion/claim";

function search(id: string, over: Partial<TopicSearch> = {}): TopicSearch {
  return {
    id,
    name: id,
    concernId: null,
    scope: "AI used to do science",
    subtopics: [
      { id: "st1", name: "Materials", picked: true },
      { id: "st2", name: "Weather", picked: false },
    ],
    want: ["papers with code"],
    avoid: [],
    judgments: [],
    anchors: ["AI for science"],
    queries: [
      { id: "q1", subtopic: null, x: "AI for science", arxiv: "machine learning scientific discovery", ranking: "?", weight: 1 },
      { id: "q2", subtopic: "st1", x: "AI materials discovery", arxiv: null, ranking: "?", weight: 0.7 },
    ],
    answers: [],
    status: "active",
    revision: 1,
    createdAt: 1,
    lastRunAt: null,
    ...over,
  };
}

let io: FakeAppData;
beforeEach(() => {
  io = createFakeAppData();
});

test("the file round-trips, carries a newer build's entry through, and changes bump the revision", async () => {
  expect(await loadTopicSearches(io)).toEqual([]);
  expect(io.files.has(TOPIC_SEARCHES_FILE)).toBe(false);
  io.files.set(TOPIC_SEARCHES_FILE, JSON.stringify({ version: 1, searches: [{ id: "ts-future", shape: "new" }] }));
  await putTopicSearch(search("ts-1"), io);
  const ids = (io.json(TOPIC_SEARCHES_FILE) as { searches: { id: string }[] }).searches.map((s) => s.id);
  expect(ids).toEqual(["ts-1", "ts-future"]);

  const changed = await changeTopicSearch("ts-1", stopTopicSearch, io);
  expect(`${changed?.status} ${changed?.revision}`).toBe("stopped 2");
  expect((await loadTopicSearches(io))[0]?.status).toBe("stopped");
  expect(await changeTopicSearch("ts-nope", stopTopicSearch, io)).toBeNull();
});

test("parse refuses what is not the shape and sets duplicates aside", () => {
  expect(parseTopicSearchesFile([])).toBeNull();
  const parsed = parseTopicSearchesFile({ searches: [search("ts-1"), search("ts-1"), { name: "no id" }] });
  expect(parsed?.searches.map((s) => s.id)).toEqual(["ts-1"]);
  expect(parsed?.repaired).toBe(true);
  expect(newTopicSearchId(() => 0)).toBe("ts-00000000");
});

test("a study's sources and seeds are read; a malformed one leaves the entry to be carried through", () => {
  const seed = { key: "arxiv:2501.00001", title: "KeplerAgent", said: "the Kepler one", at: 5 };
  const study = search("ts-2", { once: true, sources: ["arxiv", "huggingface"], seeds: [seed] });
  const parsed = parseTopicSearchesFile({
    searches: [
      search("ts-1"),
      study,
      search("ts-3", { sources: ["x", "mastodon"] as never }),
      search("ts-4", { seeds: [{ key: "arxiv:1" }] as never }),
    ],
  });
  expect(parsed?.searches.map((s) => s.id)).toEqual(["ts-1", "ts-2"]);
  expect(parsed?.searches[1]).toMatchObject({ once: true, sources: ["arxiv", "huggingface"], seeds: [seed] });
  expect(parsed?.foreign.map((e) => (e as { id: string }).id)).toEqual(["ts-3", "ts-4"]);
  // Old records without the fields still read, and are followed nightly.
  expect(parsed?.searches[0].sources).toBeUndefined();
  expect(nightlyTopicSearches(parsed?.searches ?? []).map((s) => s.id)).toEqual(["ts-1"]);
  expect(isOpenStudy(study)).toBe(true);
  expect(isOpenStudy(stopTopicSearch(study))).toBe(false);
  expect(isOpenStudy(search("ts-1"))).toBe(false);
});

test("drafted subtopics and queries are numbered and weighed by the program", () => {
  const subtopics = numberSubtopics([
    { name: "Materials", picked: true },
    { name: "materials", picked: false },
    { name: "Weather", picked: false },
  ]);
  expect(subtopics).toEqual([
    { id: "st1", name: "Materials", picked: true },
    { id: "st2", name: "Weather", picked: false },
  ]);
  const queries = numberQueries(
    [
      { subtopic: "", x: "AI for science", arxiv: "", ranking: "what is new" },
      { subtopic: "Materials", x: "a", arxiv: "b", ranking: "" },
      { subtopic: "st1", x: "c", arxiv: "", ranking: "" },
      { subtopic: "materials", x: "d", arxiv: "", ranking: "" },
      { subtopic: "Weather", x: "unpicked", arxiv: "", ranking: "" },
      { subtopic: "Nowhere", x: "unknown", arxiv: "", ranking: "" },
    ],
    subtopics,
  );
  expect(queries.map((q) => `${q.id}:${q.subtopic}:${q.x}:${q.arxiv}:${q.weight}`)).toEqual([
    "q1:null:AI for science:null:1",
    "q2:st1:a:b:0.7",
    "q3:st1:c:null:0.7",
  ]);
});

test("an update edits lists, picks subtopics, keeps answers word for word, and bumps the revision", () => {
  const before = search("ts-1");
  const after = applyTopicSearchUpdate(
    before,
    {
      avoid: { add: ["funding news", "Funding News"] },
      want: { remove: ["PAPERS WITH CODE"] },
      unpick: ["Materials"],
      addSubtopics: ["Proofs"],
      answers: [{ asked: "Funding news?", answer: "No, not here" }],
    },
    500,
  );
  expect(after.avoid).toEqual(["funding news"]);
  expect(after.want).toEqual([]);
  expect(after.subtopics.map((s) => `${s.id}:${s.name}:${s.picked}`)).toEqual([
    "st1:Materials:false",
    "st2:Weather:false",
    "st3:Proofs:true",
  ]);
  // The unpicked subtopic's query goes with it; the whole-topic one stays.
  expect(after.queries.map((q) => q.id)).toEqual(["q1"]);
  expect(after.answers).toEqual([{ asked: "Funding news?", answer: "No, not here", at: 500 }]);
  expect(after.revision).toBe(2);
  expect(before.revision).toBe(1);
  expect(isEmptyUpdate({ want: { add: [] }, pick: [] })).toBe(true);
  expect(resolveTopicSearch("nope", [before])).toBeNull();
  expect(resolveTopicSearch("TS-1", [before])?.id).toBe("ts-1");
  expect(resolveTopicSearch(" ts-1 ", [before])?.id).toBe("ts-1");
});

test("the first result is about half an hour away only while a webview desktop has beaten in two hours", () => {
  const now = 10 * 60 * 60_000;
  const claim = (over: Partial<DeviceClaim>): DeviceClaim => ({
    deviceId: "d",
    deviceName: "desk",
    platform: "linux",
    claimedAt: 1,
    heartbeatAt: now - 60 * 60_000,
    capabilities: [WEBVIEW_FETCH],
    ...over,
  });
  expect(firstRunEta([claim({})], now)).toBe("soon");
  expect(firstRunEta([claim({ heartbeatAt: now - 3 * 60 * 60_000 })], now)).toBe("tonight");
  expect(firstRunEta([claim({ capabilities: [] })], now)).toBe("tonight");
  expect(firstRunEta([claim({ claimedAt: null })], now)).toBe("tonight");
  expect(firstRunEta([], now)).toBe("tonight");
});

test("the guidance lists searches and live concerns, and a lapsed concern only behind a stopped search", () => {
  const st = (id: string, over: Partial<Statement>): Statement => ({
    id,
    kind: "concern",
    text: id,
    author: "reader",
    evidence: [],
    contradictedBy: [],
    established: "2026-10-01",
    lastSupported: "2026-10-01",
    ...over,
  });
  const text = topicSearchGuidance({
    searches: [search("ts-1", { status: "stopped", concernId: "s-back" })],
    statements: [
      st("s-live", {}),
      st("s-back", { lapsed: true }),
      st("s-gone", { lapsed: true }),
      st("s-old", { supersededBy: "s-live" }),
      st("s-prof", { kind: "profile" }),
    ],
  });
  expect(text).toContain("- ts-1 (id: ts-1, stopped) —");
  expect(text).toContain("(id s-live, reader)");
  expect(text).toContain("(id s-back, reader, lapsed)");
  expect(text).not.toContain("s-gone");
  expect(text).not.toContain("s-old");
  expect(text).not.toContain("s-prof");
  expect(text).toContain("keyword trap");
  expect(text).toContain("confirm_topic_search");
  expect(text).toContain("propose with once");
  expect(text).toContain("Write 2 to 4 short\n  keywords, the most specific first");
  expect(text).toContain("never a sentence");
  expect(text).not.toContain("X reading on this device");
});

test("the guidance says when X reading is held on this device", () => {
  const text = topicSearchGuidance({
    searches: [],
    statements: [],
    xPaused: "X reading is paused after a second challenge until the reader resumes it",
  });
  expect(text).toContain("X reading on this device: X reading is paused after a second challenge");
  expect(text).toContain("resume_x_reading");
  // The door says what it cannot do: X is read only by the runs.
  expect(text).toContain("This conversation cannot read X");
  expect(text).toContain("retry_topic_search_first_run");
});
