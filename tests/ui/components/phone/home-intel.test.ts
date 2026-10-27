// The phone home's Intel covers (src/ui/components/phone/home-intel.ts): which
// of the info shelf's books it shows, in what order, and the label under each.

import { expect, test } from "bun:test";
import type { InfoShelfView, IssueCard, VolumeCard } from "../../../../src/ui/components/info/info-shelf";
import {
  intelFile,
  intelLabel,
  intelTotals,
  intelTotalsLine,
  recentIntel,
  volumeFallbackCover,
  type IntelItem,
} from "../../../../src/ui/components/phone/home-intel";

function issue(bookId: string, at: number, isNew = false, over: Partial<IssueCard> = {}): IssueCard {
  return {
    key: `night:${bookId}`,
    bookId,
    title: `Brief No. ${at}`,
    dateLabel: "Oct 15",
    topicsLine: "AI agents, Robotics",
    itemsLine: "4 items",
    isNew,
    study: null,
    failure: null,
    at,
    items: 4,
    ...over,
  };
}

function volume(bookId: string, createdAt: number, items: number | null = 18): VolumeCard {
  return { id: bookId, bookId, title: `Volume ${bookId}`, createdAt, items };
}

const keys = (items: IntelItem[]) => items.map((i) => i.card.bookId);

test("read books go by when they were last read; a book never read here by when it was made", () => {
  const view: InfoShelfView = {
    issues: [issue("i3", 30), issue("i2", 20), issue("i1", 10)],
    volumes: [volume("v2", 25), volume("v1", 5)],
  };
  expect(keys(recentIntel(view, {}))).toEqual(["i3", "v2", "i2", "i1"]);
  expect(keys(recentIntel(view, { v1: 100, i1: 90 }))).toEqual(["v1", "i1", "i3", "v2"]);
});

test("unread issues stay on top whatever was read since, two at most", () => {
  const view: InfoShelfView = {
    issues: [issue("new3", 50, true), issue("new2", 40, true), issue("new1", 35, true), issue("old", 10)],
    volumes: [volume("v1", 5), volume("v2", 6)],
  };
  // Read after the new ones came: the two newest unread still lead, the third waits its turn by date.
  expect(keys(recentIntel(view, { old: 100, v1: 90, v2: 80 }))).toEqual(["new3", "new2", "old", "v1"]);
  expect(keys(recentIntel(view, {}))).toEqual(["new3", "new2", "new1", "old"]);
});

test("a failed search's card opens nothing and is not a cover; fewer books, fewer covers", () => {
  const view: InfoShelfView = { issues: [issue("", 99, false, { failure: "no" }), issue("i1", 10)], volumes: [] };
  expect(keys(recentIntel(view, {}))).toEqual(["i1"]);
  expect(intelTotals(view)).toEqual({ issues: 1, volumes: 0 });
  expect(intelTotalsLine({ issues: 14, volumes: 1 })).toBe("14 issues · 1 volume");
});

test("the label: an issue's topics, a study's version in the accent, a volume's kind and count", () => {
  expect(intelLabel({ kind: "issue", card: issue("i1", 1, true) })).toEqual({
    title: "Brief No. 1",
    line: "AI agents, Robotics",
    meta: "4 items",
    accent: false,
    isNew: true,
  });
  const study = issue("s1", 1, false, { study: { name: "Small language models on phones", version: 2 }, items: 9 });
  expect(intelLabel({ kind: "issue", card: study })).toEqual({
    title: "Small language models on phones",
    line: "Study · version 2",
    meta: "9 items",
    accent: true,
    isNew: false,
  });
  expect(intelLabel({ kind: "volume", card: volume("v1", 1) })).toMatchObject({ line: "Topic volume", meta: "18 items" });
  expect(intelLabel({ kind: "volume", card: volume("v1", 1, null) }).meta).toBe("");
});

test("the cover comes through the library's own path: the book as a shelf file under its id", () => {
  const library = { i1: { hash: "i1", title: "Brief", originalFilename: "brief-14.epub", addedAt: 0 } };
  expect(intelFile({ kind: "issue", card: issue("i1", 1) }, library)).toEqual({
    path: "library/i1/brief-14.epub",
    name: "brief-14.epub",
    hash: "i1",
    addedAt: 0,
  });
  expect(intelFile({ kind: "volume", card: volume("v9", 1) }, {}).name).toBe("Volume v9.epub");
});

test("a volume with no cover of its own is drawn the bindery's way, its count in the UI's words", () => {
  const svg = (count: number | null) => decodeURIComponent(volumeFallbackCover(volume("v1", 1, count)).split(",")[1]);
  expect(volumeFallbackCover(volume("v1", 1, 18)).startsWith("data:image/svg+xml")).toBe(true);
  expect(svg(18)).toContain("Volume v1");
  expect(svg(18)).toContain("18 pieces");
  expect(svg(null)).not.toContain("pieces");
});
