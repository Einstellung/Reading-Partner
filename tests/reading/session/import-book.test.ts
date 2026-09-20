// Filing a book at the door it came in by (src/reading/session/import-book):
// what is written, in what order, and what is said. Run: bun test.

import { expect, test } from "bun:test";
import {
  BOOKS,
  EPUB_ONLY,
  fileBook,
  importEpub,
  importPickedBook,
  sniffBookFormat,
  uploadImported,
  NOT_AN_EPUB,
  NOT_A_BOOK,
  UPLOAD_FAILED,
  type ImportBookIo,
} from "../../../src/reading/session/import-book";
import { buildEpub } from "../epub/fixture";

const EPUB = buildEpub({ docs: [{ name: "c1.xhtml", body: "<p>One</p>" }] });
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");

function fakeIo(over: Partial<ImportBookIo> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const io: ImportBookIo = {
    pickBook: async () => "/tmp/Inbox/book.epub",
    readFile: async () => EPUB,
    importBook: async () => ({ hash: "content-hash" }),
    addFileToTopic: async () => {},
    pushBook: async () => "uploaded",
    ...over,
  };
  const traced = Object.fromEntries(
    Object.entries(io).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls.push([name, ...args.filter((a) => !(a instanceof Uint8Array))]);
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as ImportBookIo;
  return { io: traced, calls };
}

test("what the bytes are is read from the bytes", () => {
  expect(sniffBookFormat(EPUB)).toBe("epub");
  expect(sniffBookFormat(PDF)).toBe("pdf");
  expect(sniffBookFormat(new TextEncoder().encode("<html></html>"))).toBeNull();
});

// --- the desk's door --------------------------------------------------------

test("a picked EPUB is imported and filed with its book id in one write", async () => {
  const { io, calls } = fakeIo();

  const result = await importPickedBook("t1", BOOKS, io);

  expect(result).toEqual({
    kind: "imported",
    bookId: "content-hash",
    path: "/tmp/Inbox/book.epub",
    format: "epub",
  });
  expect(calls).toEqual([
    ["pickBook", ["pdf", "epub"]],
    ["readFile", "/tmp/Inbox/book.epub"],
    ["importBook", "/tmp/Inbox/book.epub"],
    ["addFileToTopic", "t1", "/tmp/Inbox/book.epub", "content-hash"],
  ]);
});

test("a picked PDF is imported and filed with its book id in one write", async () => {
  const { io, calls } = fakeIo({
    pickBook: async () => "/books/tracing.pdf",
    readFile: async () => PDF,
  });

  const result = await importPickedBook("t1", BOOKS, io);

  expect(result).toEqual({
    kind: "imported",
    bookId: "content-hash",
    path: "/books/tracing.pdf",
    format: "pdf",
  });
  expect(calls.filter((c) => c[0] === "addFileToTopic")).toEqual([
    ["addFileToTopic", "t1", "/books/tracing.pdf", "content-hash"],
  ]);
});

test("the picker's file URL is read and filed as the path the topic store keeps", async () => {
  const { io, calls } = fakeIo({
    pickBook: async () => "file:///private/var/tmp/Inbox/%E4%B9%A6.epub",
  });

  await importPickedBook("t1", BOOKS, io);

  const path = "/private/var/tmp/Inbox/书.epub";
  expect(calls).toContainEqual(["readFile", path]);
  expect(calls).toContainEqual(["addFileToTopic", "t1", path, "content-hash"]);
});

test("a dismissed picker writes nothing", async () => {
  const { io, calls } = fakeIo({ pickBook: async () => null });

  expect(await importPickedBook("t1", BOOKS, io)).toEqual({ kind: "cancelled" });
  expect(calls).toEqual([["pickBook", ["pdf", "epub"]]]);
});

test("a picked file that is neither format is refused before anything is written", async () => {
  const { io, calls } = fakeIo({
    readFile: async () => new TextEncoder().encode("<html>not a book</html>"),
  });

  expect(await importPickedBook("t1", BOOKS, io)).toEqual({
    kind: "refused",
    why: NOT_A_BOOK,
  });
  expect(calls.map((c) => c[0])).toEqual(["pickBook", "readFile"]);
});

// --- a path handed over from outside ---------------------------------------

test("a handed-over path is filed without a picker", async () => {
  const { io, calls } = fakeIo({ readFile: async () => PDF });

  const filed = await fileBook("brief", "/tmp/Inbox/shared.pdf", BOOKS, io);

  expect(filed).toEqual({
    kind: "imported",
    bookId: "content-hash",
    path: "/tmp/Inbox/shared.pdf",
    format: "pdf",
  });
  expect(calls.map((c) => c[0])).toEqual(["readFile", "importBook", "addFileToTopic"]);
});

// --- the phone's door -------------------------------------------------------

test("the phone refuses a PDF: its shell draws EPUB and nothing else", async () => {
  const { io, calls } = fakeIo({ readFile: async () => PDF });

  expect(await importEpub("t1", io)).toEqual({ kind: "refused", why: NOT_AN_EPUB });
  expect(calls).toEqual([
    ["pickBook", ["epub"]],
    ["readFile", "/tmp/Inbox/book.epub"],
  ]);
});

test("a zip that is not an EPUB is refused too", async () => {
  const { io } = fakeIo({
    readFile: async () => buildEpub({ docs: [{ name: "c.xhtml", body: "" }], mimetype: null }),
  });

  expect(await importEpub("t1", io)).toEqual({ kind: "refused", why: NOT_AN_EPUB });
});

test("the phone files an EPUB with its book id", async () => {
  const { io, calls } = fakeIo();

  expect(await importEpub("t1", io)).toEqual({
    kind: "imported",
    bookId: "content-hash",
    path: "/tmp/Inbox/book.epub",
    format: "epub",
  });
  expect(calls).toContainEqual(["addFileToTopic", "t1", "/tmp/Inbox/book.epub", "content-hash"]);
});

test("an unreadable pick fails the import", async () => {
  const { io } = fakeIo({
    readFile: async () => {
      throw new Error("no such file");
    },
  });

  await expect(importPickedBook("t1", EPUB_ONLY, io)).rejects.toThrow("no such file");
});

// --- the upload the phone does afterwards ----------------------------------

test("an upload that lands, or has no account to go to, says nothing", async () => {
  expect(await uploadImported("h", fakeIo().io)).toBeNull();
  expect(await uploadImported("h", fakeIo({ pushBook: async () => "no-account" }).io)).toBeNull();
});

test("an upload that fails says the book stayed on the phone", async () => {
  const { io } = fakeIo({
    pushBook: async () => {
      throw new Error("network down");
    },
  });

  expect(await uploadImported("h", io)).toBe(UPLOAD_FAILED);
});
