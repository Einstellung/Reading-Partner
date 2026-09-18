// remove_supplement: which document a title names, and what the model is told
// in each case (docs/67 「辅助资料」).
// Run: bash scripts/t.sh tests/reading/ingest/remove-tool.test.ts

import { expect, test } from "bun:test";
import {
  buildSupplementTools,
  matchSupplement,
  type SupplementListing,
  type SupplementToolDeps,
} from "../../../src/reading/ingest/remove-tool";
import { toolText } from "../../support/tool-text";

const LIST: SupplementListing[] = [
  { hash: "h1", title: "How a web page becomes a book" },
  { hash: "h2", title: "The Anthropic post on context" },
  { hash: "h3", title: "The Anthropic post on tools" },
];

function tool(over: Partial<SupplementToolDeps> = {}): {
  run: (title: string) => Promise<string>;
  removed: SupplementListing[];
} {
  const removed: SupplementListing[] = [];
  const deps: SupplementToolDeps = {
    list: async () => LIST,
    remove: async (one) => {
      removed.push(one);
    },
    ...over,
  };
  const t = buildSupplementTools(deps)[0];
  return { run: async (title: string) => toolText(await t.execute({ title })), removed };
}

test("a title is matched the way a citation is: whitespace and case are nothing", () => {
  expect(matchSupplement("how a web PAGE\n becomes a book", LIST)?.hash).toBe("h1");
  expect(matchSupplement("context", LIST)?.hash).toBe("h2");
  expect(matchSupplement("nothing like it", LIST)).toBeNull();
});

test("a fragment two supplements answer to is not a guess worth deleting on", () => {
  expect(matchSupplement("the anthropic post", LIST)).toBeNull();
});

test("the one it names is removed, and the answer says so", async () => {
  const t = tool();
  const out = await t.run("How a web page becomes a book");
  expect(t.removed.map((one) => one.hash)).toEqual(["h1"]);
  expect(out).toContain("How a web page becomes a book");
});

test("a name that matches nothing removes nothing and lists what is there", async () => {
  const t = tool();
  const out = await t.run("the one about ducks");
  expect(t.removed).toEqual([]);
  expect(out).toContain("How a web page becomes a book");
  expect(out).toContain("The Anthropic post on tools");
});

test("a book with no supplements says so rather than looking for one", async () => {
  const t = tool({ list: async () => [] });
  expect(await t.run("anything")).toContain("no supplements");
  expect(t.removed).toEqual([]);
});
