// Where a study's books are on the info shelf when it ends (docs/info/91 结束):
// the version the reader has is moved, the others are deleted.

import { expect, test } from "bun:test";
import { emptyShelf, type IssueEntry, type IssueStudyVersion } from "../../../../src/info/issue/types";
import { studyRowBooks } from "../../../../src/ui/components/companion/study-end";

const v = (n: number, bookId: string) => ({ n, bookId, at: n * 100 }) as IssueStudyVersion;
const row = (key: string, bookId: string, versions?: IssueStudyVersion[]) =>
  ({ key, bookId, ...(versions ? { study: { current: versions.length, versions } } : {}) }) as unknown as IssueEntry;

test("the current version's book moves, the others go; a rollback changes which", () => {
  const shelf = { ...emptyShelf(), issues: [row("daily:x", "bx"), row("first:ts-1", "b3", [v(1, "b1"), v(2, "b2"), v(3, "b3")])] };
  expect(studyRowBooks(shelf, "ts-1", [])).toEqual({ current: { version: 3, bookId: "b3" }, others: ["b1", "b2"] });
  expect(studyRowBooks(shelf, "ts-1", [{ to: 2, at: 400 }])).toEqual({ current: { version: 2, bookId: "b2" }, others: ["b1", "b3"] });
});

test("a row from before versions is version 1; no row is nothing", () => {
  const shelf = { ...emptyShelf(), issues: [row("first:ts-1", "b0")] };
  expect(studyRowBooks(shelf, "ts-1", [])).toEqual({ current: { version: 1, bookId: "b0" }, others: [] });
  expect(studyRowBooks(shelf, "ts-2", [])).toEqual({ current: null, others: [] });
});
