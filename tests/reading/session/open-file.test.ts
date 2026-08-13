// Which copy of a topic file is opened (src/reading/session/open-file), and what
// gets written down on the way. Run: bun test.

import { expect, test } from "bun:test";
import { resolveBookSource, type BookSourceIo } from "../../../src/reading/session/open-file";
import type { FileRef } from "../../../src/platform/app/topics";

const LIBRARY_BYTES = new Uint8Array([9, 9]);
const DISK_BYTES = new Uint8Array([1, 2]);

function fakeIo(over: Partial<BookSourceIo> = {}) {
  const calls: string[] = [];
  const io: BookSourceIo = {
    libraryHas: async () => false,
    readLibraryBook: async () => LIBRARY_BYTES,
    readFile: async () => DISK_BYTES,
    importBook: async () => ({ hash: "content-hash" }),
    migrateBookLive: async () => {},
    pathHash: (path) => `path-hash:${path}`,
    setFileHash: async () => {},
    ...over,
  };
  const traced = Object.fromEntries(
    Object.entries(io).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls.push(name);
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as BookSourceIo;
  return { io: traced, calls };
}

const file = (over: Partial<FileRef> = {}): FileRef => ({
  path: "/books/a.pdf",
  name: "a.pdf",
  addedAt: 1,
  ...over,
});

test("a book already in the library is read from it, not from where it came from", async () => {
  const { io, calls } = fakeIo({ libraryHas: async () => true });
  const opened = await resolveBookSource(file({ hash: "content-hash" }), "topic-1", io);

  expect(opened).toEqual({ bookId: "content-hash", bytes: LIBRARY_BYTES });
  expect(calls).toEqual(["libraryHas", "readLibraryBook"]);
});

test("a file with no id yet is imported, migrated and its id written back", async () => {
  const written: unknown[] = [];
  const migrated: unknown[] = [];
  const { io } = fakeIo({
    setFileHash: async (...args) => void written.push(args),
    migrateBookLive: async (...args) => void migrated.push(args),
  });
  const opened = await resolveBookSource(file(), "topic-1", io);

  expect(opened).toEqual({ bookId: "content-hash", bytes: DISK_BYTES });
  expect(migrated).toEqual([["path-hash:/books/a.pdf", "content-hash"]]);
  expect(written).toEqual([["topic-1", "/books/a.pdf", "content-hash"]]);
});

test("a known id whose copy is missing from the library is imported without being rewritten", async () => {
  const written: unknown[] = [];
  const { io, calls } = fakeIo({
    libraryHas: async () => false,
    setFileHash: async (...args) => void written.push(args),
  });
  const opened = await resolveBookSource(file({ hash: "content-hash" }), "topic-1", io);

  expect(opened.bookId).toBe("content-hash");
  expect(calls).toContain("importBook");
  // The file already carried this id; there is nothing to write and no sync
  // revision to spend.
  expect(written).toEqual([]);
});

test("a file whose bytes changed under it takes the new id", async () => {
  const written: unknown[] = [];
  const { io } = fakeIo({
    importBook: async () => ({ hash: "new-hash" }),
    setFileHash: async (...args) => void written.push(args),
  });
  const opened = await resolveBookSource(file({ hash: "old-hash" }), "topic-1", io);

  expect(opened.bookId).toBe("new-hash");
  expect(written).toEqual([["topic-1", "/books/a.pdf", "new-hash"]]);
});

test("a file that cannot be read stops there", async () => {
  const { io, calls } = fakeIo({ readFile: () => Promise.reject(new Error("ENOENT")) });

  await expect(resolveBookSource(file(), "topic-1", io)).rejects.toThrow("ENOENT");
  expect(calls).not.toContain("importBook");
});
