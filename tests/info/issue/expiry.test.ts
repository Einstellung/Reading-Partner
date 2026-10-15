import { expect, test } from "bun:test";
import { runHousekeeper } from "../../../src/housekeeper";
import {
  ISSUE_EXPIRY_MARKER,
  expiredIssues,
  issueExpiryMarker,
  withoutIssues,
  type IssueExpiryDeps,
} from "../../../src/info/issue/expiry";
import { INFO_SHELF_FILE, emptyShelf, parseShelf, type InfoShelf, type IssueEntry } from "../../../src/info/issue/types";
import { memDisk } from "../../housekeeper/fixtures";

function issue(n: number, date: string): IssueEntry {
  return {
    key: `night:${date}`,
    number: n,
    date,
    topics: [{ searchId: "ts-1", name: "AI for science" }],
    results: [],
    items: 3,
    bookId: `book-${n}`,
    boxItemId: `box-${n}`,
    createdAt: 0,
  };
}

function shelf(): InfoShelf {
  return {
    ...emptyShelf(),
    issues: [issue(1, "2026-09-10"), issue(2, "2026-09-15"), issue(3, "2026-09-16"), issue(4, "2026-10-14")],
    volumes: [{ id: "v1", title: "AI for science, vol. 1", bookId: "vol-1", searchId: "ts-1", createdAt: 0 }],
  };
}

test("an issue dated more than 30 days back has expired; the volumes are not issues", () => {
  expect(expiredIssues(shelf(), "2026-10-15").map((i) => i.number)).toEqual([1]);
  expect(expiredIssues(shelf(), "2026-10-16").map((i) => i.number)).toEqual([1, 2]);
  expect(expiredIssues(shelf(), "not a date")).toEqual([]);
  expect(withoutIssues(shelf(), ["night:2026-09-10"]).issues.map((i) => i.number)).toEqual([2, 3, 4]);
  expect(withoutIssues(shelf(), ["night:2026-09-10"]).volumes).toHaveLength(1);
});

function deps(over: Partial<IssueExpiryDeps> = {}) {
  let text: string | null = JSON.stringify(shelf());
  const deleted: string[] = [];
  const d: IssueExpiryDeps = {
    isCollector: async () => true,
    deleteBook: async (bookId) => {
      deleted.push(bookId);
    },
    readShelf: async () => text,
    writeShelf: async (next) => {
      text = next;
    },
    today: () => "2026-10-15",
    ...over,
  };
  return { d, deleted, shelf: () => parseShelf(text) };
}

test("the night deletes each expired issue's book and drops its row; volumes and the rest stay", async () => {
  const s = deps();
  const disk = memDisk({ [INFO_SHELF_FILE]: { text: JSON.stringify(shelf()), mtimeMs: 1 } });
  const res = await runHousekeeper({
    now: Date.now(),
    readIo: disk.read,
    executeIo: disk.exec,
    markers: [issueExpiryMarker(s.d)],
  });
  expect(res).toMatchObject({ done: 1, refused: 0, failed: 0, purged: 0 });
  expect(s.deleted).toEqual(["book-1"]);
  expect(s.shelf().issues.map((i) => i.number)).toEqual([2, 3, 4]);
  expect(s.shelf().volumes.map((v) => v.id)).toEqual(["v1"]);
  // The index file itself is never removed by the housekeeper.
  expect(disk.calls).toEqual([]);
  expect(disk.log.every((l) => l.marker === ISSUE_EXPIRY_MARKER && l.path === INFO_SHELF_FILE)).toBe(true);
});

test("a device that is not the collector marks nothing", async () => {
  const s = deps({ isCollector: async () => false });
  const disk = memDisk({ [INFO_SHELF_FILE]: { text: JSON.stringify(shelf()), mtimeMs: 1 } });
  const marks = await issueExpiryMarker(s.d).mark({ io: disk.read, now: Date.now() });
  expect(marks).toEqual([]);
});

test("a book that would not go keeps its row for the next night", async () => {
  const s = deps({
    deleteBook: async () => {
      throw new Error("disk full");
    },
  });
  const marker = issueExpiryMarker(s.d);
  await expect(marker.carryOut!({ path: INFO_SHELF_FILE, action: "flow", subject: "night:2026-09-10", reason: "" })).rejects.toThrow();
  expect(s.shelf().issues).toHaveLength(4);
  // A subject already gone is nothing to do.
  const ok = deps();
  await issueExpiryMarker(ok.d).carryOut!({ path: INFO_SHELF_FILE, action: "flow", subject: "night:1999-01-01", reason: "" });
  expect(ok.deleted).toEqual([]);
});
