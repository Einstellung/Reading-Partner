// read_supplement: a supplement's pages are readable by title, whatever prep the
// book has (docs/67 「辅助资料」, feedback 辅助资料读不到).
// Run: bash scripts/t.sh tests/reading/ingest/read-supplement-tool.test.ts

import { expect, test } from "bun:test";
import { buildReadSupplementTools } from "../../../src/reading/ingest/read-supplement-tool";
import type { SupplementListing } from "../../../src/reading/ingest/remove-tool";
import type { Fulltext } from "../../../src/fulltext/types";
import { toolText } from "../../support/tool-text";

const LIST: SupplementListing[] = [
  { hash: "gate", title: "Gated Attention for Large Language Models" },
  { hash: "scan", title: "A scanned appendix" },
];

const TEXTS: Record<string, Fulltext> = {
  gate: { status: "ok", pages: ["abstract", "sigmoid gate after SDPA", "results"] } as Fulltext,
  scan: { status: "no-text-layer", pages: [""] } as Fulltext,
};

function run(args: Record<string, unknown>, list = LIST): Promise<string> {
  const tool = buildReadSupplementTools({
    list: async () => list,
    fulltext: async (hash) => TEXTS[hash] ?? null,
  })[0];
  return tool.execute(args).then(toolText);
}

test("pages come back under the supplement's own citation", async () => {
  expect(await run({ title: "gated attention", from: 2, to: 2 })).toBe(
    "=== Page 2 === [Gated Attention for Large Language Models p.2]\nsigmoid gate after SDPA",
  );
});

test("an unknown title is answered with the list", async () => {
  const text = await run({ title: "rope", from: 1, to: 1 });
  expect(text).toContain('There is no single supplement called "rope"');
  expect(text).toContain('"Gated Attention for Large Language Models"');
});

test("a document with no text says so, and a book with none says that", async () => {
  expect(await run({ title: "scanned appendix", from: 1, to: 1 })).toContain("has no readable text");
  expect(await run({ title: "x", from: 1, to: 1 }, [])).toBe("This book has no supplements.");
});
