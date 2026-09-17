// Importing an EPUB on the phone (src/reading/session/import-book): what is
// written, in what order, and what is said. Run: bun test.

import { expect, test } from "bun:test";
import {
  importEpub,
  uploadImported,
  NOT_AN_EPUB,
  UPLOAD_FAILED,
  type ImportBookIo,
} from "../../../src/reading/session/import-book";
import { buildEpub } from "../epub/fixture";

const EPUB = buildEpub({ docs: [{ name: "c1.xhtml", body: "<p>One</p>" }] });

function fakeIo(over: Partial<ImportBookIo> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const io: ImportBookIo = {
    pickEpub: async () => "/tmp/Inbox/book.epub",
    readFile: async () => EPUB,
    importBook: async () => ({ hash: "content-hash" }),
    addFileToTopic: async () => {},
    setFileHash: async () => {},
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

test("an EPUB is imported, filed under the topic and given its book id", async () => {
  const { io, calls } = fakeIo();

  const result = await importEpub("t1", io);

  expect(result).toEqual({ kind: "imported", bookId: "content-hash" });
  expect(calls).toEqual([
    ["pickEpub"],
    ["readFile", "/tmp/Inbox/book.epub"],
    ["importBook", "/tmp/Inbox/book.epub"],
    ["addFileToTopic", "t1", "/tmp/Inbox/book.epub"],
    ["setFileHash", "t1", "/tmp/Inbox/book.epub", "content-hash"],
  ]);
});

test("the picker's file URL is read and filed as the path the topic store keeps", async () => {
  const { io, calls } = fakeIo({
    pickEpub: async () => "file:///private/var/tmp/Inbox/%E4%B9%A6.epub",
  });

  await importEpub("t1", io);

  const path = "/private/var/tmp/Inbox/书.epub";
  expect(calls).toContainEqual(["readFile", path]);
  expect(calls).toContainEqual(["setFileHash", "t1", path, "content-hash"]);
});

test("a dismissed picker writes nothing", async () => {
  const { io, calls } = fakeIo({ pickEpub: async () => null });

  expect(await importEpub("t1", io)).toEqual({ kind: "cancelled" });
  expect(calls).toEqual([["pickEpub"]]);
});

test("a file that is not an EPUB is refused before anything is written", async () => {
  const { io, calls } = fakeIo({
    readFile: async () => new TextEncoder().encode("%PDF-1.7"),
  });

  expect(await importEpub("t1", io)).toEqual({
    kind: "refused",
    why: NOT_AN_EPUB,
  });
  expect(calls.map((c) => c[0])).toEqual(["pickEpub", "readFile"]);
});

test("a zip that is not an EPUB is refused too", async () => {
  const { io } = fakeIo({
    readFile: async () => buildEpub({ docs: [{ name: "c.xhtml", body: "" }], mimetype: null }),
  });

  expect(await importEpub("t1", io)).toEqual({
    kind: "refused",
    why: NOT_AN_EPUB,
  });
});

test("an unreadable pick fails the import", async () => {
  const { io } = fakeIo({
    readFile: async () => {
      throw new Error("no such file");
    },
  });

  await expect(importEpub("t1", io)).rejects.toThrow("no such file");
});

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
