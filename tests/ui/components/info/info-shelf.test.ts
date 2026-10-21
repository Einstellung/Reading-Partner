import { expect, test } from "bun:test";
import { emptyShelf, type InfoShelf, type IssueEntry } from "../../../../src/info/issue/types";
import type { LibraryEntry } from "../../../../src/platform/app/library";
import type { Topic } from "../../../../src/platform/app/topics";
import {
  fileVolume,
  filedBookIds,
  infoShelfView,
  issueDateLabel,
  loadInfoShelf,
} from "../../../../src/ui/components/info/info-shelf";

function issue(n: number, date: string, items = 4): IssueEntry {
  return {
    key: `night:${date}`,
    number: n,
    date,
    topics: [
      { searchId: "ts-1", name: "AI for science" },
      { searchId: "ts-2", name: "Robotics" },
    ],
    results: [],
    items,
    bookId: `issue-${n}`,
    boxItemId: `box-${n}`,
    createdAt: n,
  };
}

function entry(hash: string, title = hash): LibraryEntry {
  return { hash, title, originalFilename: `${title}.epub`, addedAt: 0, format: "epub" };
}

function shelf(): InfoShelf {
  return {
    ...emptyShelf(),
    issues: [issue(1, "2026-10-13"), issue(3, "2026-10-15", 1), issue(2, "2026-10-14")],
    volumes: [
      { id: "v1", title: "Robot hands, vol. 1", bookId: "vol-1", searchId: "ts-2", createdAt: 1 },
      { id: "v2", title: "Materials, vol. 1", bookId: "vol-2", searchId: "ts-1", createdAt: 2 },
      { id: "v3", title: "Moved away", bookId: "vol-3", searchId: null, createdAt: 3 },
    ],
  };
}

const LIBRARY = Object.fromEntries(
  ["issue-1", "issue-2", "issue-3", "vol-1", "vol-2", "vol-3"].map((h) => [h, entry(h)]),
);

test("issues newest first; New on today's and on any not opened here; volumes filed or deleted drop out", () => {
  const library = { ...LIBRARY };
  delete library["vol-2"];
  const view = infoShelfView(shelf(), {
    library,
    filed: new Set(["vol-3"]),
    opened: new Set(["issue-1", "issue-3"]),
    today: "2026-10-15",
  });
  expect(view.issues.map((i) => [i.title, i.isNew])).toEqual([
    ["Brief No. 3", true],
    ["Brief No. 2", true],
    ["Brief No. 1", false],
  ]);
  expect(view.issues[0].topicsLine).toBe("AI for science, Robotics");
  expect(view.issues[0].itemsLine).toBe("1 item");
  expect(view.issues[1].itemsLine).toBe("4 items");
  expect(view.volumes.map((v) => v.id)).toEqual(["v1"]);
});

test("an issue whose book is gone from the library is not drawn", () => {
  const library = { ...LIBRARY };
  delete library["issue-2"];
  const view = infoShelfView(shelf(), { library, filed: new Set(), opened: new Set(), today: "2026-10-15" });
  expect(view.issues.map((i) => i.bookId)).toEqual(["issue-3", "issue-1"]);
});

test("the date label is the short month and day", () => {
  expect(issueDateLabel("2026-10-15", "en")).toBe("Oct 15");
  expect(issueDateLabel("someday", "en")).toBe("someday");
});

test("a volume's first Move to… adds it to the topic, under its library file", async () => {
  const calls: unknown[][] = [];
  const line = await fileVolume(
    { bookId: "vol-1", title: "Robot hands, vol. 1" },
    entry("vol-1", "Robot hands"),
    { id: "t1", name: "Robotics" },
    {
      addFileToTopic: async (...args) => {
        calls.push(args);
        return null;
      },
    },
  );
  expect(calls).toEqual([["t1", "library/vol-1/Robot hands.epub", "vol-1", "Robot hands, vol. 1"]]);
  expect(line).toBe("Moved to “Robotics”");
  const elsewhere = await fileVolume(
    { bookId: "vol-1", title: "Robot hands, vol. 1" },
    undefined,
    { id: "t1", name: "Robotics" },
    { addFileToTopic: async () => ({ hash: "vol-1", topic: { id: "t0", name: "Hands" } }) },
  );
  expect(elsewhere).toContain("Hands");
});

test("the screen's data: the index, the library, what is filed and what was opened", async () => {
  const topics = [{ id: "t1", name: "Robotics", files: [{ path: "p", name: "n", hash: "vol-3" }] }] as unknown as Topic[];
  expect([...filedBookIds(topics)]).toEqual(["vol-3"]);
  const data = await loadInfoShelf({
    readText: async () => JSON.stringify(shelf()),
    library: async () => LIBRARY,
    topics: async () => topics,
    opened: async (bookId) => bookId === "issue-2",
    today: () => "2026-10-15",
  });
  expect(data.shelf.issues).toHaveLength(3);
  expect([...data.ctx.opened]).toEqual(["issue-2"]);
  expect([...data.ctx.filed]).toEqual(["vol-3"]);
});

function studyRow(): IssueEntry {
  const v = (n: number) => ({ n, bookId: `study-${n}`, at: n * 10, date: `2026-10-2${n}`, line: "", items: n + 3, boxItemId: `sb-${n}` });
  return {
    key: "first:ts-s",
    number: 4,
    date: "2026-10-21",
    topics: [{ searchId: "ts-s", name: "AI mechanism discovery" }],
    results: [],
    items: 5,
    bookId: "study-2",
    boxItemId: "sb-1",
    createdAt: 9,
    study: { current: 2, versions: [v(1), v(2)] },
  };
}

test("a study's brief comes first under its own cover, opening its current version", () => {
  const library = { ...LIBRARY, "study-1": entry("study-1"), "study-2": entry("study-2") };
  const withStudy = { ...shelf(), issues: [...shelf().issues, studyRow()] };
  const ctx = { library, filed: new Set<string>(), opened: new Set(["study-1"]), today: "2026-10-15" };
  const [card] = infoShelfView(withStudy, ctx).issues;
  expect(card).toMatchObject({ key: "first:ts-s", bookId: "study-2", title: "Study · just this once", itemsLine: "Researching · version 2 · 5 items", isNew: true });
  expect(card.study).toEqual({ name: "AI mechanism discovery", version: 2 });
  expect(infoShelfView(withStudy, ctx).issues.slice(1).every((i) => i.study === null)).toBe(true);
  // The reader went back to version 1 after version 2 came.
  const back = infoShelfView(withStudy, { ...ctx, rollbacks: { "ts-s": [{ to: 1, at: 99 }] } }).issues[0];
  expect([back.bookId, back.itemsLine, back.isNew]).toEqual(["study-1", "Researching · version 1 · 4 items", false]);
  // A version filed into reading takes the card off this shelf.
  expect(infoShelfView(withStudy, { ...ctx, filed: new Set(["study-1"]) }).issues[0].study).toBeNull();
});

test("the screen's data reads each study's rollbacks from its record", async () => {
  const files: Record<string, string> = {
    "info-shelf.json": JSON.stringify({ ...emptyShelf(), issues: [studyRow()] }),
    "topic-study-ts-s.json": JSON.stringify({ version: 1, searchId: "ts-s", lines: [], rollbacks: { "rb-99": { to: 1, at: 99 } } }),
  };
  const data = await loadInfoShelf({
    readText: async (p) => files[p] ?? null,
    library: async () => ({}),
    topics: async () => [],
    opened: async (bookId) => bookId === "study-1",
    today: () => "2026-10-21",
  });
  expect(data.ctx.rollbacks).toEqual({ "ts-s": [{ to: 1, at: 99 }] });
  expect([...data.ctx.opened]).toEqual(["study-1"]);
});
