// The brief on the desk (src/reading/issue-desk.ts, docs/info/88).

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../src/fulltext/types";
import { DEFAULT_SETTINGS } from "../../src/platform/app/settings";
import { ISSUE_DESK_KIND, issueDeskKind, issuePrompt, issueText } from "../../src/reading/issue-desk";

const text = (pages: string[], status: Fulltext["status"] = "ok"): Fulltext => ({
  version: FULLTEXT_VERSION,
  status,
  pages,
  outline: [],
});

test("a short brief is inlined page by page, with the anchor the model copies", () => {
  expect(issueText(text(["Cover", " Contents "]))).toBe("=== Page 1 === [p.1]\nCover\n\n=== Page 2 === [p.2]\nContents");
  const prompt = issuePrompt("Oct 15 brief", text(["Cover", "Contents"]), []);
  expect(prompt).toContain("=== Page 2 === [p.2]\nContents");
  expect(prompt).toContain('[p.N "words copied from that page"]');
  expect(prompt).not.toContain("supplements");
});

test("a long brief is read with read_pages, and one still being read says so", () => {
  const long = text(Array.from({ length: 40 }, () => "word ".repeat(2000)));
  expect(issuePrompt("B", long, [])).toContain("Read it with read_pages");
  expect(issuePrompt("B", null, [])).toContain("still being read");
  expect(issuePrompt("B", text([], "no-text-layer"), [])).toContain("still being read");
});

test("the item brings material and tools, and no conversation, memory or place", async () => {
  const kind = issueDeskKind({
    listSupplements: async () => [{ hash: "o1", title: "The paper" }],
    fulltext: async () => text(["The paper's words."]),
  });
  expect(kind.kind).toBe(ISSUE_DESK_KIND);
  const item = await kind.open(
    { bookId: "issue-1", title: "Oct 15 brief", fulltext: text(["Cover", "Item"]) },
    { settings: DEFAULT_SETTINGS, thread: { key: "door-2026-10-15", id: "d1" } },
  );
  expect(item).not.toBeNull();
  expect(item!.history).toBeUndefined();
  expect(item!.memory).toBeUndefined();
  expect(item!.origin).toBeUndefined();
  expect(item!.tools.map((t) => t.name).sort()).toEqual(["read_pages", "read_supplement", "search_topic"]);
  expect(item!.prompt({ dropped: new Set(), memory: "", toolNames: [], toolPrompts: [] })).toContain("- The paper");
});

test("a turn abandoned while the originals are read lays nothing", async () => {
  const gone = new AbortController();
  gone.abort();
  const item = await issueDeskKind({ listSupplements: async () => [], fulltext: async () => null }).open(
    { bookId: "i", title: "B", fulltext: null },
    { settings: DEFAULT_SETTINGS, thread: { key: "k", id: "t" }, signal: gone.signal },
  );
  expect(item).toBeNull();
});
