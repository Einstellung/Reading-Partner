// The two published names on disk (src/info/briefing/publish.ts), against an
// in-memory AppData: what a collector writes over them, and the two cases where
// it must write nothing at all. tests/info/publish.test.ts covers the pure half;
// this file is here for the writes.
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

import { beforeEach, expect, test } from "bun:test";
import {
  PUBLISHED_BODIES_FILE,
  PUBLISHED_BRIEFING_FILE,
  backfillPublish,
  publishBriefing,
} from "../../src/info/briefing/publish";
import type { CachedArticle } from "../../src/info/briefing/store";
import type { Briefing } from "../../src/info/briefing/types";
import type { InfoItem } from "../../src/info/sources/item";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

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
  disk.files.set(`briefing-${b.date}.json`, JSON.stringify(b, null, 2));
  disk.files.set(`info-articles-${b.date}.json`, JSON.stringify(articles));
  disk.files.set(`info-items-${b.date}.json`, JSON.stringify([item("a"), item("b")]));
}

test("a backfill publishes the briefing the readers never got", async () => {
  const local = briefing(1_000);
  putDayFiles(local);

  expect(await backfillPublish()).toBe("published");
  expect(JSON.parse(disk.files.get(PUBLISHED_BRIEFING_FILE) ?? "null").generatedAt).toBe(1_000);
  expect(JSON.parse(disk.files.get(PUBLISHED_BODIES_FILE) ?? "null").bodies.a.text).toBe(
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
  disk.files.set(PUBLISHED_BRIEFING_FILE, newer);
  disk.files.set(PUBLISHED_BODIES_FILE, JSON.stringify({ date: DATE, generatedAt: 9_000, bodies: {} }));
  disk.unreadable.add(PUBLISHED_BRIEFING_FILE);

  expect(await backfillPublish()).toBe("unreadable-published");

  // Byte for byte: not overwritten, and not moved aside either — nothing is
  // known to be wrong with it.
  expect(disk.files.get(PUBLISHED_BRIEFING_FILE)).toBe(newer);
  expect([...disk.files.keys()].some((k) => k.includes(".corrupt-"))).toBe(false);

  // It opens on the next launch, and then the newer briefing wins on its own.
  disk.unreadable.clear();
  expect(await backfillPublish()).toBe("published-newer");
  expect(disk.files.get(PUBLISHED_BRIEFING_FILE)).toBe(newer);
});

// The briefing already out is this machine's own, so what is left to decide is
// whether the bodies match it — and the bodies are the half that will not open.
// Read as absent they make the pair look half-published, the verdict is
// "publish", and this machine writes over bytes it never saw.
test("the bodies file counts too: neither half is published over an unread one", async () => {
  const local = briefing(1_000);
  putDayFiles(local);
  const published = JSON.stringify(local, null, 2);
  const bodies = JSON.stringify({ date: DATE, generatedAt: 1_000, bodies: {} });
  disk.files.set(PUBLISHED_BRIEFING_FILE, published);
  disk.files.set(PUBLISHED_BODIES_FILE, bodies);
  disk.unreadable.add(PUBLISHED_BODIES_FILE);

  expect(await backfillPublish()).toBe("unreadable-published");
  expect(disk.files.get(PUBLISHED_BODIES_FILE)).toBe(bodies);
  expect(disk.files.get(PUBLISHED_BRIEFING_FILE)).toBe(published);

  // It opens on the next launch, and the pair turns out to have been whole.
  disk.unreadable.clear();
  expect(await backfillPublish()).toBe("up-to-date");
});

// Content that will not parse is the other branch: the name is free, and the
// bytes are replaced where they lie. Nothing is quarantined at either published
// name — these are a copy of a briefing the collector still has, and a reader
// with a stale one has a screen where a reader with none has nothing.
test("a published briefing that is not JSON is replaced, not set aside", async () => {
  const local = briefing(1_000);
  putDayFiles(local);
  disk.files.set(PUBLISHED_BRIEFING_FILE, "{ half a briefi");

  expect(await backfillPublish()).toBe("published");
  expect(JSON.parse(disk.files.get(PUBLISHED_BRIEFING_FILE) ?? "null").generatedAt).toBe(1_000);
  expect([...disk.files.keys()].some((k) => k.includes(".corrupt-"))).toBe(false);
});

// The two branches at once, which is where quarantining lost the name outright:
// the briefing will not parse and the bodies will not open, so the republish
// that would have replaced the briefing is refused. Set it aside and the readers
// have nothing at that name — and nothing again on every launch until the bodies
// open. Left alone, the unparseable bytes are still there to be replaced.
test("an unparseable briefing survives a refused republish", async () => {
  const local = briefing(1_000);
  putDayFiles(local);
  disk.files.set(PUBLISHED_BRIEFING_FILE, "{ half a briefi");
  disk.files.set(PUBLISHED_BODIES_FILE, JSON.stringify({ date: DATE, generatedAt: 9_000, bodies: {} }));
  disk.unreadable.add(PUBLISHED_BODIES_FILE);

  expect(await backfillPublish()).toBe("unreadable-published");
  expect(disk.files.get(PUBLISHED_BRIEFING_FILE)).toBe("{ half a briefi");

  // The bodies open again, and the same briefing name is repaired in place.
  disk.unreadable.clear();
  expect(await backfillPublish()).toBe("published");
  expect(JSON.parse(disk.files.get(PUBLISHED_BRIEFING_FILE) ?? "null").generatedAt).toBe(1_000);
});

// A re-triage on a day whose article cache has already been pruned. Every body
// rebuilds empty, and an empty body is a claim about the source: "this one only
// ever publishes summaries". Neither half goes out, so the readers keep the pair
// they have.
test("a briefing whose bodies rebuilt empty is not published, and takes nothing with it", async () => {
  const first = briefing(1_000);
  putDayFiles(first);
  expect(await publishBriefing(first)).toBe("published");
  const publishedBriefing = disk.files.get(PUBLISHED_BRIEFING_FILE);
  const publishedBodies = disk.files.get(PUBLISHED_BODIES_FILE);

  // The day's files are pruned once a run starts on a new day; the briefing
  // outlives them, and a re-triage rewrites it.
  disk.files.delete(`info-articles-${DATE}.json`);
  disk.files.delete(`info-items-${DATE}.json`);
  const retriaged = { ...first, generatedAt: 2_000, overview: "same day, moved around" };

  expect(await publishBriefing(retriaged)).toBe("no-bodies");
  expect(disk.files.get(PUBLISHED_BRIEFING_FILE)).toBe(publishedBriefing);
  expect(disk.files.get(PUBLISHED_BODIES_FILE)).toBe(publishedBodies);
  // What the readers still have is the whole pair, text and all.
  expect(JSON.parse(publishedBodies ?? "null").bodies.a.text).toBe("the whole of article a");
});
