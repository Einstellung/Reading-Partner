// Unit tests for the add_source chat tool (src/prep/source-tool.ts). The
// pipeline work is a fake ingestor, so there is no network/AI. Run: bun test.

import { expect, test } from "bun:test";
import { buildSourceTools, type IngestResult, type SourceIngestor } from "../../src/prep/source-tool";

function tool(ingestor: SourceIngestor) {
  const [t] = buildSourceTools(ingestor);
  return t;
}

function fake(result: Partial<IngestResult>, spy?: (url: string) => void): SourceIngestor {
  return {
    ingest: async (url) => {
      spy?.(url);
      return {
        slug: "src",
        title: "The Source",
        kind: "article",
        pages: 0,
        chars: 0,
        status: "done",
        ...result,
      };
    },
  };
}

test("article success: readable-now confirmation, slug, and no-page citation", async () => {
  let seen = "";
  const t = tool(fake({ kind: "article", chars: 4200 }, (u) => (seen = u)));
  const out = (await t.execute({ url: "https://a.test/post" })) as string;
  expect(seen).toBe("https://a.test/post");
  expect(out).toContain("The Source");
  expect(out).toContain("article");
  expect(out).toContain("4200 characters");
  expect(out).toContain('read_paper("src"');
  expect(out).toContain("reference material");
  expect(out).toContain("[src]");
});

test("pdf success: reports pages and a page citation", async () => {
  const t = tool(fake({ kind: "pdf", pages: 12 }));
  const out = (await t.execute({ url: "https://a.test/x.pdf" })) as string;
  expect(out).toContain("12 pages");
  expect(out).toContain("[src p.N]");
});

test("rejects a non-https URL before touching the ingestor", async () => {
  let called = false;
  const t = tool({
    ingest: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  await expect(t.execute({ url: "http://a.test/x" })).rejects.toThrow(/https/);
  expect(called).toBe(false);
});

test("a failed ingest surfaces as a tool error", async () => {
  const t = tool(fake({ status: "failed", error: "could not fetch the link (HTTP 404)" }));
  await expect(t.execute({ url: "https://a.test/missing" })).rejects.toThrow(/404/);
});

test("an abstract-only outcome reports limited info without claiming readable full text", async () => {
  const t = tool(fake({ status: "abstract-only", title: "Thin One" }));
  const out = (await t.execute({ url: "https://a.test/thin" })) as string;
  expect(out).toContain("Thin One");
  expect(out).toContain("limited");
  expect(out).not.toContain("readable now");
});
