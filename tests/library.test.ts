// Content hash + library registry (src/library.ts). The hash and the pure
// registry transform run headless; the Tauri fs copy path is exercised by the
// app. Run: bun test.

import { expect, test } from "bun:test";
import { addEntry, contentHash, libraryPdfPath, type LibraryStore } from "../src/library";

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
