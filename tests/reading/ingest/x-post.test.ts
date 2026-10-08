// An X link through reading's ingest (docs/84): the post's own content built by
// the bindery, each followed link handed to the bindery's registry the way a
// pasted link is, the record kept with the hashes of what came of it.

import { beforeEach, expect, test } from "bun:test";
import { importBook } from "../../../src/platform/app/library";
import { registerSiteAdapter, type FetchedBytes } from "../../../src/workshop/bindery";
import { ingestXPost, type XIngestDeps } from "../../../src/reading/ingest/x-post";
import { ingestUrlWorker } from "../../../src/reading/ingest/url-worker";
import type { XPostEntry } from "../../../src/info/x/store";
import type { WorkerContext } from "../../../src/legion/execute/worker";
import type { Run } from "../../../src/legion/run";
import { installAppData } from "../../support/appdata-fake";
import { fakeX, focalText, LONG_FULL, longPost, page, syn } from "../../info/x/fixtures";

const ID = "2106807332688580789";
const URL_ = `https://x.com/0xMovez/status/${ID}`;
const DRIVE = "https://drive.google.com/file/d/1PT/view";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const MISSING: FetchedBytes = { ok: false, status: 404, bytes: new Uint8Array(), contentType: null };

beforeEach(() => {
  installAppData();
});

function deps(x: ReturnType<typeof fakeX>): { deps: XIngestDeps; saved: XPostEntry[]; supplements: string[] } {
  const saved: XPostEntry[] = [];
  const supplements: string[] = [];
  return {
    saved,
    supplements,
    deps: {
      fetch: async () => MISSING,
      extractReadable: () => null,
      importBook,
      attachToTopic: async () => {},
      attachToBook: async (_book, ref) => {
        supplements.push(ref.title);
      },
      x: x.deps,
      saveRecord: async (entry) => {
        saved.push(entry);
      },
      now: () => 1_000,
    },
  };
}

test("a long post that links to a Drive file is a lead: the file is the document, handed to the adapter that claims it", async () => {
  const asked: string[] = [];
  // Stands in for the Drive adapter another change registers: the X path does
  // not know Drive, it hands the bindery a bare link and the registry decides.
  const undo = registerSiteAdapter({
    name: "fake-drive",
    claims: (m) => m.kind === "url" && m.url.startsWith("https://drive.google.com/"),
    async toManuscript(m) {
      asked.push(m.kind === "url" ? m.url : "");
      return { kind: "whole", format: "pdf", bytes: PDF, title: "Understanding Harness Engineering", sourceUrl: DRIVE };
    },
  });
  try {
    const x = fakeX(
      [longPost(ID, { entities: { urls: [{ url: "https://t.co/d", expanded_url: DRIVE }] } })],
      { [`https://x.com/0xMovez/status/${ID}`]: page({ handle: "0xMovez", id: ID, text: focalText("0xMovez", LONG_FULL) }) },
    );
    const r = deps(x);
    const got = await ingestXPost(URL_, { kind: "book", bookId: "b1" }, r.deps);

    expect(asked).toEqual([DRIVE]);
    expect(got.documents.map((d) => [d.kind, d.entry.format])).toEqual([["book", "pdf"]]);
    expect(r.supplements).toEqual(["Understanding Harness Engineering"]);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0].documents).toEqual(got.documents.map((d) => d.entry.hash));
    expect(r.saved[0].record.textComplete).toBe(true);
    expect(got.lead).toContain("a long post by @0xMovez (2026-10-04)");
    expect(got.lead).toContain("Followed 1 link");
    expect(got.notes).toEqual([]);
  } finally {
    undo();
  }
});

test("a short post with no link keeps only its record", async () => {
  const x = fakeX([syn({ id_str: ID, text: "Good morning.", display_text_range: [0, 13] })], null);
  const r = deps(x);
  const got = await ingestXPost(URL_, { kind: "book", bookId: "b1" }, r.deps);
  expect(got.documents).toEqual([]);
  expect(r.saved[0].documents).toEqual([]);
  expect(r.saved[0].record.text).toBe("Good morning.");
  expect(got.lead).toContain("only the record was kept");
});

test("without a hidden webview nothing truncated is filed and the receipt says it needs the desktop", async () => {
  const x = fakeX([longPost(ID)], null);
  const r = deps(x);
  const got = await ingestXPost(URL_, { kind: "book", bookId: "b1" }, r.deps);
  expect(got.documents).toEqual([]);
  expect(r.saved[0].record.textComplete).toBe(false);
  expect(got.lead).toContain("Nothing became a document.");
  expect(got.notes).toHaveLength(1);
  expect(got.notes[0]).toContain("needs the desktop app");
});

test("a followed link that cannot be read is in the receipt, beside what could", async () => {
  const x = fakeX(
    [syn({ id_str: ID, text: "read this", display_text_range: [0, 9], entities: { urls: [{ url: "https://t.co/a", expanded_url: "https://blog.example.com/posts/a-good-one" }] } })],
    null,
  );
  const r = deps(x);
  const got = await ingestXPost(URL_, { kind: "book", bookId: "b1" }, r.deps);
  expect(got.documents).toEqual([]);
  expect(got.notes).toHaveLength(1);
  expect(got.notes[0]).toContain("https://blog.example.com/posts/a-good-one");
});

test("the run's output says what came in and what did not", async () => {
  let written = "";
  const batch = {
    lead: "Read a post by @a (2026-10-04) and kept it as the source record of what it led to.",
    notes: ["Not taken: https://fly.io/: a site's homepage."],
    documents: [],
  };
  const worker = ingestUrlWorker({
    readAsk: async () => JSON.stringify({ url: URL_, bookId: "b1" }),
    ingest: async () => batch,
    fulltext: async () => null,
    pipeline: () => null,
    writeOutput: async (_id, text) => {
      written = text;
      return "out";
    },
  });
  const ctx = {
    run: { id: "r1" } as unknown as Run,
    report: async () => {},
  } as unknown as WorkerContext;
  await worker("brief", ctx).done;
  expect(written).toBe(`${batch.lead} ${batch.notes[0]}`);
});
