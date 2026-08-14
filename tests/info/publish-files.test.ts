// The two published names on disk (src/info/briefing/publish.ts), against an
// in-memory AppData: what a collector writes over them, and the two cases where
// it must write nothing at all. tests/info/publish.test.ts covers the pure half;
// this file is here for the writes, so the mocked filesystem has to be in place
// before the module is imported.
//
// Both cases are the same mistake: an answer that stands in for a file, and a
// write that then makes it true.
//
//   info-briefing.json could not be read, and readJson's null said "no reader
//   ever got one" — so this machine published its own older briefing over a
//   newer one it had merely failed to open.
//
//   The day's article cache was pruned under a re-triage, so every body rebuilt
//   empty, and publishing them told every reader that each of those sources
//   only ever publishes summaries.
//
// Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import type { Briefing } from "../../src/info/briefing/types";
import type { CachedArticle } from "../../src/info/briefing/store";
import type { InfoItem } from "../../src/info/sources/item";
import { makeAppData } from "../support/appdata";

const app = makeAppData();
const { files, unreadable } = app;
mock.module("@tauri-apps/plugin-fs", () => app.pluginFs);
mock.module("@tauri-apps/api/core", () => app.core);
mock.module("../../src/platform/app/atomic-fs", () => app.atomicFs);

const {
  backfillPublish,
  publishBriefing,
  PUBLISHED_BODIES_FILE,
  PUBLISHED_BRIEFING_FILE,
} = await import("../../src/info/briefing/publish");

const DATE = "2026-08-12";

function meta(id: string) {
  return {
    title: `title ${id}`,
    url: `https://example.test/${id}`,
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-08-12T00:00:00Z",
  };
}

function briefing(generatedAt: number): Briefing {
  return {
    date: DATE,
    generatedAt,
    overview: "a day",
    mustRead: [{ itemId: "a", reason: "because" }],
    oneLiners: [{ itemId: "b", line: "the point" }],
    outOfLane: [],
    filtered: [],
    items: { a: meta("a"), b: meta("b") },
  };
}

function item(id: string): InfoItem {
  return {
    id,
    source: "src",
    sourceName: "Source",
    title: `title ${id}`,
    url: `https://example.test/${id}`,
    publishedAt: "2026-08-12T00:00:00Z",
    summary: "a summary",
    summaryOnly: false,
  } as InfoItem;
}

// The day's files a collector has beside the briefing it just wrote.
function putDayFiles(b: Briefing): void {
  const articles: Record<string, CachedArticle> = {
    a: { textContent: "the whole of article a", contentHtml: "<p>a</p>" } as CachedArticle,
    b: { textContent: "the whole of article b", contentHtml: "<p>b</p>" } as CachedArticle,
  };
  files.set(`briefing-${b.date}.json`, JSON.stringify(b, null, 2));
  files.set(`info-articles-${b.date}.json`, JSON.stringify(articles));
  files.set(`info-items-${b.date}.json`, JSON.stringify([item("a"), item("b")]));
}

beforeEach(() => app.reset());

test("a backfill publishes the briefing the readers never got", async () => {
  const local = briefing(1_000);
  putDayFiles(local);

  expect(await backfillPublish()).toBe("published");
  expect(JSON.parse(files.get(PUBLISHED_BRIEFING_FILE) ?? "null").generatedAt).toBe(1_000);
  expect(JSON.parse(files.get(PUBLISHED_BODIES_FILE) ?? "null").bodies.a.text).toBe(
    "the whole of article a",
  );
});

// The file is there and holds a briefing newer than this machine's. Reading it
// as absent is what turns a failed read into a downgrade every reader then
// pulls.
test("a published briefing that could not be read is not published over", async () => {
  const local = briefing(1_000);
  putDayFiles(local);
  const newer = JSON.stringify(briefing(9_000), null, 2);
  files.set(PUBLISHED_BRIEFING_FILE, newer);
  files.set(PUBLISHED_BODIES_FILE, JSON.stringify({ date: DATE, generatedAt: 9_000, bodies: {} }));
  unreadable.add(PUBLISHED_BRIEFING_FILE);

  expect(await backfillPublish()).toBe("unreadable-published");

  // Byte for byte: not overwritten, and not moved aside either — nothing is
  // known to be wrong with it.
  expect(files.get(PUBLISHED_BRIEFING_FILE)).toBe(newer);
  expect([...files.keys()].some((k) => k.includes(".corrupt-"))).toBe(false);

  // It opens on the next launch, and then the newer briefing wins on its own.
  unreadable.clear();
  expect(await backfillPublish()).toBe("published-newer");
  expect(files.get(PUBLISHED_BRIEFING_FILE)).toBe(newer);
});

test("the bodies file counts too: neither half is published over an unread one", async () => {
  const local = briefing(1_000);
  putDayFiles(local);
  const bodies = JSON.stringify({ date: DATE, generatedAt: 9_000, bodies: {} });
  files.set(PUBLISHED_BRIEFING_FILE, JSON.stringify(briefing(9_000), null, 2));
  files.set(PUBLISHED_BODIES_FILE, bodies);
  unreadable.add(PUBLISHED_BODIES_FILE);

  expect(await backfillPublish()).toBe("unreadable-published");
  expect(files.get(PUBLISHED_BODIES_FILE)).toBe(bodies);
});

// Content that will not parse is the other branch: the name is free again, but
// the bytes go somewhere first.
test("a published briefing that is not JSON is set aside before it is replaced", async () => {
  const local = briefing(1_000);
  putDayFiles(local);
  files.set(PUBLISHED_BRIEFING_FILE, "{ half a briefi");

  expect(await backfillPublish()).toBe("published");
  expect(JSON.parse(files.get(PUBLISHED_BRIEFING_FILE) ?? "null").generatedAt).toBe(1_000);
  expect(files.get(`${PUBLISHED_BRIEFING_FILE}.corrupt-1700000000000`)).toBe("{ half a briefi");
});

// A re-triage on a day whose article cache has already been pruned. Every body
// rebuilds empty, and an empty body is a claim about the source: "this one only
// ever publishes summaries". Neither half goes out, so the readers keep the pair
// they have.
test("a briefing whose bodies rebuilt empty is not published, and takes nothing with it", async () => {
  const first = briefing(1_000);
  putDayFiles(first);
  expect(await publishBriefing(first)).toBe("published");
  const publishedBriefing = files.get(PUBLISHED_BRIEFING_FILE);
  const publishedBodies = files.get(PUBLISHED_BODIES_FILE);

  // The day's files are pruned once a run starts on a new day; the briefing
  // outlives them, and a re-triage rewrites it.
  files.delete(`info-articles-${DATE}.json`);
  files.delete(`info-items-${DATE}.json`);
  const retriaged = { ...first, generatedAt: 2_000, overview: "same day, moved around" };

  expect(await publishBriefing(retriaged)).toBe("no-bodies");
  expect(files.get(PUBLISHED_BRIEFING_FILE)).toBe(publishedBriefing);
  expect(files.get(PUBLISHED_BODIES_FILE)).toBe(publishedBodies);
  // What the readers still have is the whole pair, text and all.
  expect(JSON.parse(publishedBodies ?? "null").bodies.a.text).toBe("the whole of article a");
});
