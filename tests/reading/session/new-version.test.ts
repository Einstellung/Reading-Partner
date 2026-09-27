// "Replace with a new version…" from the pick to the pipeline
// (src/reading/session/new-version.ts): what is refused, what the pipeline is
// handed, and what the reader is moved onto and told.
// Run: bash scripts/t.sh tests/reading/session/new-version.test.ts

import { expect, test } from "bun:test";
import type { LibraryEntry } from "../../../src/platform/app/library";
import type { DocumentHome, SuccessorFile } from "../../../src/reading/replace/replace";
import {
  SAME_FILE,
  newVersionLine,
  replaceWithNewVersion,
  wrongFormat,
  type NewVersionIo,
} from "../../../src/reading/session/new-version";
import { buildEpub } from "../epub/fixture";

const V1 = buildEpub({ docs: [{ name: "c1.xhtml", body: "<p>First version.</p>" }] });
const V2 = buildEpub({ docs: [{ name: "c1.xhtml", body: "<div><p>First version.</p></div>" }] });
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");

const ENTRY: LibraryEntry = {
  hash: "hash-of-v1",
  title: "Booklet.epub",
  originalFilename: "Booklet.epub",
  addedAt: 1,
  format: "epub",
  sourceUrl: "https://example.com/b",
};

function fakeIo(picked: Uint8Array | null, path = "file:///private/var/Inbox/Booklet%20v2.epub") {
  const calls: Array<{ home: DocumentHome; original: Uint8Array; successor: SuccessorFile }> = [];
  const formats: string[][] = [];
  const io: NewVersionIo = {
    pickBook: async (f) => {
      formats.push([...f]);
      return picked === null ? null : path;
    },
    readFile: async () => picked as Uint8Array,
    readBook: async () => V1,
    hash: async (bytes) => (bytes === V1 ? "hash-of-v1" : "hash-of-other"),
    replace: async (entry, home, original, successor) => {
      calls.push({ home, original, successor });
      return {
        entry: { ...entry, hash: "hash-of-v2" },
        path: `library/hash-of-v2/${successor.fileName}`,
        moved: 5,
        unmatched: 1,
        threads: 2,
        orphanedThreads: 0,
      };
    },
  };
  return { io, calls, formats };
}

test("the picker asks for the book's own format, and a dismissed picker changes nothing", async () => {
  const { io, calls, formats } = fakeIo(null);
  expect(await replaceWithNewVersion(ENTRY, { kind: "topic", topicId: "t" }, "Booklet", io)).toEqual({
    kind: "cancelled",
  });
  expect(formats).toEqual([["epub"]]);
  expect(calls).toHaveLength(0);
});

test("a file of the other format is refused", async () => {
  const { io, calls } = fakeIo(PDF);
  expect(await replaceWithNewVersion(ENTRY, { kind: "topic", topicId: "t" }, "Booklet", io)).toEqual({
    kind: "refused",
    why: wrongFormat("epub"),
  });
  expect(calls).toHaveLength(0);
});

test("the very file already open is refused", async () => {
  const { io, calls } = fakeIo(V1);
  expect(await replaceWithNewVersion(ENTRY, { kind: "topic", topicId: "t" }, "Booklet", io)).toEqual({
    kind: "refused",
    why: SAME_FILE,
  });
  expect(calls).toHaveLength(0);
});

test("a new version goes through the pipeline under its own name, with the source fields kept", async () => {
  const { io, calls } = fakeIo(V2);
  const out = await replaceWithNewVersion(ENTRY, { kind: "topic", topicId: "t" }, "Booklet", io);

  expect(calls).toHaveLength(1);
  expect(calls[0].original).toBe(V1);
  expect(calls[0].successor.bytes).toBe(V2);
  // The picked URL's percent-encoding is gone from the name (docs/pitfall/106).
  expect(calls[0].successor.fileName).toBe("Booklet v2.epub");
  expect(calls[0].successor.meta).toEqual({
    kind: undefined,
    sourceUrl: "https://example.com/b",
    byline: undefined,
    publishedAt: undefined,
  });
  expect(out).toEqual({
    kind: "replaced",
    result: expect.anything(),
    reopen: {
      hash: "hash-of-v2",
      path: "library/hash-of-v2/Booklet v2.epub",
      topicId: "t",
      bookId: null,
      title: "Booklet v2.epub",
    },
    line: 'Replaced "Booklet" with the new version: 5 marks moved, 1 could not be moved.',
  });
});

test("a supplement's new version stays in its book's session", async () => {
  const { io } = fakeIo(V2);
  const out = await replaceWithNewVersion(ENTRY, { kind: "book", bookId: "the-book" }, "Booklet", io);
  expect(out.kind === "replaced" && out.reopen).toMatchObject({ topicId: null, bookId: "the-book", title: "Booklet v2" });
});

test("the closing line", () => {
  expect(newVersionLine("A", { moved: 0, unmatched: 0 })).toBe('Replaced "A" with the new version: no marks to move.');
  expect(newVersionLine("A", { moved: 1, unmatched: 0 })).toBe('Replaced "A" with the new version: 1 mark moved.');
});
