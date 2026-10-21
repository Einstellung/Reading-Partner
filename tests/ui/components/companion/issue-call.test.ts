// The brief open in the reader, as a voice call at the door reads it
// (src/ui/components/companion/issue-call.ts, docs/info/88 「简报的对话」).
// Run: scripts/t.sh tests/ui/components/companion/issue-call.test.ts

import { expect, test } from "bun:test";

import type { Fulltext } from "../../../../src/fulltext/types";
import type { Annotation } from "../../../../src/platform/app/reader-contract";
import { ISSUE_DESK_KIND } from "../../../../src/reading/issue-desk";
import { issueCallMaterial } from "../../../../src/ui/components/companion/issue-call";
import type { OpenIssue } from "../../../../src/ui/components/companion/issue-context";

const FULLTEXT = {
  status: "ok",
  pages: ["Contents\nOpen weights\nCheap chips", "Open weights\nThe lab released them.", "Cheap chips\nPrices fell."],
} as unknown as Fulltext;

function brief(bookId: string, at: { page: number }, marks: Annotation[] = []): OpenIssue {
  return {
    bookId,
    title: `Brief ${bookId}`,
    where: () => ({ page: at.page, pageCount: 3 }),
    fulltext: async () => FULLTEXT,
    marks: () => marks,
    jump: () => {},
  };
}

test("nothing open: no place, no desk", async () => {
  const material = issueCallMaterial({ open: () => null, headings: async () => [] });
  expect(material.opened()).toBe(false);
  expect(await material.place()).toBe("");
  expect(await material.desk()).toBeNull();
});

test("the place is the brief open at each turn: its page, its marks and its contents", async () => {
  const at = { page: 2 };
  const marks = [{ id: "m1", type: "highlight", text: "Prices fell.", position: { pageIndex: 2 } } as Annotation];
  let open: OpenIssue | null = brief("b1", at, marks);
  const asked: string[] = [];
  const material = issueCallMaterial({
    open: () => open,
    headings: async (bookId) => {
      asked.push(bookId);
      return ["Open weights", "Cheap chips"];
    },
  });
  expect(material.opened()).toBe(true);
  const first = await material.place();
  expect(first).toContain('the brief "Brief b1" open in the reader, on page 2 of 3.');
  expect(first).toContain('They marked: p.3 "Prices fell.".');
  expect(first).toContain("In it: p.2 Open weights; p.3 Cheap chips.");

  // The reader turns a page between turns.
  at.page = 3;
  expect(await material.place()).toContain("on page 3 of 3.");
  // The headings are read once per brief.
  expect(asked).toEqual(["b1"]);

  // Another brief opened mid-call, then put away.
  open = brief("b2", { page: 1 });
  expect(await material.place()).toContain('"Brief b2"');
  expect(asked).toEqual(["b1", "b2"]);
  open = null;
  expect(material.opened()).toBe(false);
  expect(await material.place()).toBe("");
});

test("a think run's desk is the issue the door's text turn lays, with the note on where the reader is", async () => {
  const material = issueCallMaterial({ open: () => brief("b1", { page: 2 }), headings: async () => [] });
  const laid = await material.desk();
  expect(laid?.desk).toEqual([{ kind: ISSUE_DESK_KIND, ref: { bookId: "b1", title: "Brief b1", fulltext: FULLTEXT } }]);
  expect(laid?.note).toContain('The reader has the brief "Brief b1" open, on page 2 of 3.');
  expect(laid?.note).not.toContain("quoted");
});
