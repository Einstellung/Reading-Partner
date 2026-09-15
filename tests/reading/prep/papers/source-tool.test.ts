// Unit tests for the ingest_url chat tool (src/reading/prep/source-tool.ts).
// The pipeline work is a fake ingestor, so there is no network/AI. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildSourceTools,
  type IngestResult,
  type SourceIngestor,
} from "../../../../src/reading/prep/papers/source-tool";

function tool(ingestor: SourceIngestor) {
  const [t] = buildSourceTools(ingestor);
  return t;
}

// A book with a prep pipeline behind it: both halves come back.
function fake(
  prep: Partial<IngestResult["prep"]> = {},
  spy?: (url: string) => void,
): SourceIngestor {
  return {
    ingest: async (url) => {
      spy?.(url);
      return {
        title: "The Source",
        prep: { slug: "src", kind: "article", pages: 0, chars: 0, status: "done", ...prep },
        document: { title: "The Source" },
      };
    },
  };
}

// A book with none: the supplement is the whole of the ingest.
function supplementOnly(title = "The Source"): SourceIngestor {
  return { ingest: async () => ({ title, document: { title } }) };
}

test("article success: readable-now confirmation, slug, and a page-1 citation", async () => {
  let seen = "";
  const t = tool(fake({ kind: "article", chars: 4200 }, (u) => (seen = u)));
  const out = (await t.execute({ url: "https://a.test/post" })) as string;
  expect(seen).toBe("https://a.test/post");
  expect(out).toContain("The Source");
  expect(out).toContain("article");
  expect(out).toContain("4200 characters");
  expect(out).toContain('read_paper("src"');
  expect(out).toContain("reference material");
  // Never a bare [src]: that is not a citation shape the renderer knows, so
  // every one the model wrote rendered as plain text.
  expect(out).toContain("[src p.1]");
  expect(out).not.toContain("[src]");
});

test("pdf success: reports pages and a page citation", async () => {
  const t = tool(fake({ kind: "pdf", pages: 12 }));
  const out = (await t.execute({ url: "https://a.test/x.pdf" })) as string;
  expect(out).toContain("12 pages");
  expect(out).toContain("[src p.N]");
});

test("takes an http URL and rejects any other scheme before touching the ingestor", async () => {
  let called = false;
  const refuses = tool({
    ingest: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  await expect(refuses.execute({ url: "file:///etc/passwd" })).rejects.toThrow(/http/);
  expect(called).toBe(false);

  let seen = "";
  const t = tool(fake({}, (u) => (seen = u)));
  await t.execute({ url: "http://a.test/post" });
  expect(seen).toBe("http://a.test/post");
});

test("with no prep behind the book, the answer is the supplement and no read_paper", async () => {
  const t = tool(supplementOnly("A Plain Page"));
  const out = (await t.execute({ url: "https://a.test/post" })) as string;
  expect(out).toContain("A Plain Page");
  expect(out).toContain("supplement");
  expect(out).toContain("Outline");
  expect(out).toContain("reference material");
  expect(out).not.toContain("read_paper");
});

test("with no prep and no document, the ingest is a tool error", async () => {
  const t = tool({ ingest: async () => ({ title: "" }) });
  await expect(t.execute({ url: "https://a.test/post" })).rejects.toThrow(/could not ingest/);
});

test("the prep answer says the reader can open the supplement too", async () => {
  const t = tool(fake({ chars: 4200 }));
  const out = (await t.execute({ url: "https://a.test/post" })) as string;
  expect(out).toContain('read_paper("src"');
  expect(out).toContain("supplement of this book");
});

test("a failed ingest surfaces as a tool error", async () => {
  const t = tool(fake({ status: "failed", error: "could not fetch the link (HTTP 404)" }));
  await expect(t.execute({ url: "https://a.test/missing" })).rejects.toThrow(/404/);
});

test("an abstract-only outcome reports limited info without claiming readable full text", async () => {
  const t = tool({
    ingest: async () => ({
      title: "Thin One",
      prep: { slug: "src", kind: "article", pages: 0, chars: 0, status: "abstract-only" },
    }),
  });
  const out = (await t.execute({ url: "https://a.test/thin" })) as string;
  expect(out).toContain("Thin One");
  expect(out).toContain("limited");
  expect(out).not.toContain("readable now");
});
