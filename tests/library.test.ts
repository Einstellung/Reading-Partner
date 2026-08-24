// Content hash + library registry (src/platform/app/library.ts). The hash and the pure
// registry transform run headless; the Tauri fs copy path is exercised by the
// app. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { contentHash } from "../src/platform/app/content-hash";
import {
  LIBRARY_FILE,
  addEntry,
  getLibraryEntry,
  healLibrary,
  importBook,
  libraryPdfPath,
  type LibraryStore,
} from "../src/platform/app/library";
import { installAppData, QUARANTINE_SUFFIX, type FakeDisk } from "./support/appdata-fake";

test("contentHash is the sha256 hex truncated to 16 bytes", async () => {
  // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  const h = await contentHash(new TextEncoder().encode("abc"));
  expect(h).toBe("ba7816bf8f01cfea414140de5dae2223");
  expect(h).toHaveLength(32);
});

test("contentHash is stable and content-addressed", async () => {
  const a = await contentHash(new Uint8Array([1, 2, 3, 4]));
  const b = await contentHash(new Uint8Array([1, 2, 3, 4]));
  const c = await contentHash(new Uint8Array([1, 2, 3, 5]));
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test("contentHash accepts an ArrayBuffer and a Uint8Array alike", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  expect(await contentHash(bytes)).toBe(await contentHash(bytes.buffer));
});

test("libraryPdfPath keys the copy by book id", () => {
  expect(libraryPdfPath("deadbeef")).toBe("library/deadbeef.pdf");
});

test("addEntry registers a new book and is a no-op on re-import", () => {
  const empty: LibraryStore = { books: {} };
  const first = addEntry(empty, {
    hash: "h1",
    title: "Paper.pdf",
    originalFilename: "Paper.pdf",
    addedAt: 100,
  });
  expect(first.books.h1.title).toBe("Paper.pdf");

  // Re-importing the same content keeps the first-seen title/addedAt.
  const again = addEntry(first, {
    hash: "h1",
    title: "Renamed.pdf",
    originalFilename: "Renamed.pdf",
    addedAt: 200,
  });
  expect(again).toBe(first);
  expect(again.books.h1.title).toBe("Paper.pdf");
  expect(again.books.h1.addedAt).toBe(100);
});

test("addEntry does not mutate the input store", () => {
  const store: LibraryStore = { books: {} };
  addEntry(store, { hash: "h2", title: "t", originalFilename: "t", addedAt: 1 });
  expect(store.books).toEqual({});
});

// --- repairing names an iOS import left percent-encoded ---------------------

test("healLibrary decodes a title taken from a file URL", () => {
  const store: LibraryStore = {
    books: {
      h1: {
        hash: "h1",
        title: "%E4%B8%AD%E6%96%87%20(z-library.sk).pdf",
        originalFilename: "%E4%B8%AD%E6%96%87%20(z-library.sk).pdf",
        addedAt: 1,
      },
    },
  };
  const healed = healLibrary(store).books.h1;
  expect(healed.title).toBe("中文 (z-library.sk).pdf");
  expect(healed.originalFilename).toBe("中文 (z-library.sk).pdf");
  expect(healed.addedAt).toBe(1);
});

// The repair runs at every launch and the file is one sync unit, so a clean
// library has to come back as the very same object: that identity is what tells
// the caller not to write, and not writing is what keeps a launch from producing
// a revision the other device then has to pull.
test("healLibrary returns a clean store unchanged, by identity", () => {
  const store: LibraryStore = {
    books: {
      h1: { hash: "h1", title: "Paper.pdf", originalFilename: "Paper.pdf", addedAt: 1 },
      h2: { hash: "h2", title: "50%.pdf", originalFilename: "50%.pdf", addedAt: 2 },
      h3: { hash: "h3", title: "中文 书.pdf", originalFilename: "中文 书.pdf", addedAt: 3 },
    },
  };
  expect(healLibrary(store)).toBe(store);

  const dirty: LibraryStore = {
    books: {
      h1: { hash: "h1", title: "%E4%B8%AD.pdf", originalFilename: "%E4%B8%AD.pdf", addedAt: 1 },
    },
  };
  const once = healLibrary(dirty);
  expect(healLibrary(once)).toBe(once);
});

// --- the registry on disk ---------------------------------------------------

// The shelf's titles live only here: the PDFs survive in library/, their names
// do not. So a registry file that is there and will not open is a failure, not
// an empty shelf — answering "no books" would be the app telling the reader
// their library is gone, and the write that followed would make it true.

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

const REGISTERED = JSON.stringify({
  books: { h1: { hash: "h1", title: "Tracing JITs.pdf", originalFilename: "a.pdf", addedAt: 1 } },
});

test("an unreadable registry raises rather than reading as an empty shelf", async () => {
  disk.files.set(LIBRARY_FILE, REGISTERED);
  disk.unreadable.add(LIBRARY_FILE);

  expect(getLibraryEntry("h1")).rejects.toThrow(/could not be read/);
});

test("an import over an unreadable registry is refused, and the file is untouched", async () => {
  disk.files.set(LIBRARY_FILE, REGISTERED);
  disk.unreadable.add(LIBRARY_FILE);

  await expect(importBook(new Uint8Array([1, 2, 3]), "/books/new.pdf")).rejects.toThrow(
    /could not be read/,
  );
  expect(disk.files.get(LIBRARY_FILE)).toBe(REGISTERED);
  expect(disk.files.has(`${LIBRARY_FILE}${QUARANTINE_SUFFIX}`)).toBe(false);
});

// Bytes that will not parse are a different case: they are moved aside first, so
// a fresh registry is what is left and the import may go ahead.
test("an unparseable registry is moved aside and the import goes ahead", async () => {
  disk.files.set(LIBRARY_FILE, REGISTERED.slice(0, 20));

  const entry = await importBook(new Uint8Array([1, 2, 3]), "/books/new.pdf");

  expect(entry.title).toBe("new.pdf");
  expect(disk.files.get(`${LIBRARY_FILE}${QUARANTINE_SUFFIX}`)).toBe(REGISTERED.slice(0, 20));
  expect(Object.keys((JSON.parse(disk.files.get(LIBRARY_FILE)!) as LibraryStore).books)).toEqual([
    entry.hash,
  ]);
});

// A file that is not there is the first run, and it has to reach a write.
test("no registry at all still registers the first import", async () => {
  const entry = await importBook(new Uint8Array([4, 5, 6]), "/books/first.pdf");
  expect(Object.keys((JSON.parse(disk.files.get(LIBRARY_FILE)!) as LibraryStore).books)).toEqual([
    entry.hash,
  ]);
});
