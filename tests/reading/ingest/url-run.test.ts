// The ask a URL ingest is written down as, and the line the run leaves behind
// (src/reading/ingest/url-run.ts, docs/55). No AppData and no runner: both seams
// are injected. Run: scripts/t.sh tests/reading/ingest/url-run.test.ts

import { expect, test } from "bun:test";
import {
  INGEST_URL_KIND,
  ingestOutputLine,
  parseIngestAsk,
  startUrlIngest,
  type IngestAsk,
} from "../../../src/reading/ingest/url-run";
import type { DelegateInput } from "../../../src/legion/execute/worker";
import type { Run } from "../../../src/legion/run";

function runRecord(id: string): Run {
  return { id, kind: INGEST_URL_KIND } as unknown as Run;
}

function started(spy?: (input: DelegateInput) => void) {
  const written = new Map<string, IngestAsk>();
  return {
    written,
    deps: {
      write: async (ask: IngestAsk) => {
        const path = `legion/briefs/ingest-${written.size}.json`;
        written.set(path, ask);
        return path;
      },
      delegate: async (input: DelegateInput) => {
        spy?.(input);
        return { ok: true as const, run: runRecord("r-9"), existing: false };
      },
    },
  };
}

test("the ask is written first and the run carries its path, never the URL", async () => {
  let input: DelegateInput | null = null;
  const { written, deps } = started((i) => (input = i));
  const out = await startUrlIngest(
    { url: "https://a.test/x.pdf", bookId: "book-1", note: "compare with ch.3" },
    deps,
  );
  expect(out.runId).toBe("r-9");
  const sent = input as unknown as DelegateInput;
  expect(sent.kind).toBe(INGEST_URL_KIND);
  expect(sent.brief).toBe("legion/briefs/ingest-0.json");
  expect(sent.brief).not.toContain("a.test");
  expect(written.get(sent.brief)).toEqual({
    url: "https://a.test/x.pdf",
    bookId: "book-1",
    note: "compare with ch.3",
  });
});

// The place is the program's to fill in, exactly as delegate fills it: the model
// never sees it and so cannot address the answer anywhere the reader was not.
test("the run is delivered back to the place the turn was held, and the soul owns it", async () => {
  let input: DelegateInput | null = null;
  const { deps } = started((i) => (input = i));
  await startUrlIngest(
    { url: "https://a.test/x.pdf", bookId: "book-1" },
    { ...deps, origin: { place: "book", bookId: "book-1", threadId: "t-2", page: 4 } },
  );
  const sent = input as unknown as DelegateInput;
  expect(sent.delegator).toEqual({ kind: "soul" });
  expect(JSON.parse(sent.deliverTo!)).toEqual({
    place: "book",
    bookId: "book-1",
    threadId: "t-2",
    page: 4,
  });
});

test("a refused run is the runner's own sentence", async () => {
  const { deps } = started();
  await expect(
    startUrlIngest(
      { url: "https://a.test/x.pdf", bookId: "book-1" },
      { ...deps, delegate: async () => ({ ok: false, reason: "this run is too deep" }) },
    ),
  ).rejects.toThrow(/too deep/);
});

test("an ask reads back as it was written, and half an ask is not one", () => {
  const ask = { url: "https://a.test/x.pdf", bookId: "book-1", note: "why" };
  expect(parseIngestAsk(JSON.stringify(ask))).toEqual(ask);
  expect(parseIngestAsk('{"url":"https://a.test/x","bookId":"b"}')).toEqual({
    url: "https://a.test/x",
    bookId: "b",
  });
  expect(() => parseIngestAsk("not json")).toThrow(/readable JSON/);
  expect(() => parseIngestAsk('{"bookId":"b"}')).toThrow(/no URL/);
  expect(() => parseIngestAsk('{"url":"https://a.test/x"}')).toThrow(/no book/);
});

test("the output line says what came in, how big it is, and where it now is", () => {
  const article = ingestOutputLine({
    title: "A Plain Page",
    kind: "article",
    pages: 1,
    chars: 4200,
    slug: "plain",
  });
  expect(article).toContain("A Plain Page");
  expect(article).toContain("4200 characters");
  expect(article).toContain("Outline");
  expect(article).toContain("plain");

  const pdf = ingestOutputLine({ title: "A Paper", kind: "pdf", pages: 12, chars: 40000 });
  expect(pdf).toContain("12 pages");
  // No prep list behind this book: nothing claims the text is readable.
  expect(pdf).not.toContain("prep list");
});
