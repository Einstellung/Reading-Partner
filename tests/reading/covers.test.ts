// A book that is in the account and not on this device (docs/70): what the
// shelf does about its cover before the download and after it.
//
// The phone lists a topic filed on the desk, so a card's path is a path on that
// device and reading it throws. That is not the book being unreadable — it is
// the book not being here — and the difference decides whether a marker is
// written, whether the answer is kept for the session, and therefore whether
// the cover ever appears after the tap that downloads it.
//
// The disk is tests/support/appdata-fake.ts, so the code under test is the real
// covers.ts against the real library.ts. Only the raster is spied: PDFium is
// not what is being asked about here.
import { beforeEach, expect, spyOn, test } from "bun:test";
import { installAppData, type FakeDisk } from "../support/appdata-fake";
import { coverFailurePath, unreadableKey } from "../../src/reading/cover-cache";
import { bookCover } from "../../src/reading/covers";
import * as raster from "../../src/reading/engine/raster";
import { libraryBookPath } from "../../src/platform/app/library";
import type { FileRef } from "../../src/platform/app/topics";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

// Not a zip, so the shelf takes the PDFium path rather than the EPUB reader's.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function rendersAnything(): void {
  spyOn(raster, "renderFirstPageJpeg").mockImplementation(async () => ({
    kind: "ok",
    jpeg: new Uint8Array([0xff, 0xd8, 0xff]),
    metadata: { author: "A Writer", title: null },
  }));
}

// A file on the shelf as another device filed it: it has a book id, and its
// path is a path this device has never had.
function elsewhere(hash: string): FileRef {
  return { path: `/Users/someone/Books/${hash}.pdf`, name: `${hash}.pdf`, addedAt: 0, hash };
}

function downloaded(hash: string): void {
  disk.blobs.set(libraryBookPath(hash, "pdf"), PDF_BYTES);
}

function markers(): string[] {
  return disk.writes.filter((p) => p.endsWith(".failed.json"));
}

test("a book that is not on this device is not written off as unreadable", async () => {
  rendersAnything();
  const file = elsewhere("a1");

  expect(await bookCover(file)).toEqual({ url: null, author: null });
  expect(markers()).toEqual([]);
});

test("the cover appears on the next ask, once the book has been downloaded", async () => {
  rendersAnything();
  const file = elsewhere("a2");

  expect((await bookCover(file)).url).toBeNull();
  // What the tap does: the bytes arrive, and the card asks again.
  downloaded("a2");

  const cover = await bookCover(file);
  expect(cover.url).toStartWith("data:image/jpeg;base64,");
  expect(cover.author).toBe("A Writer");
});

test("a marker an earlier build left for the same path does not outlive the download", async () => {
  rendersAnything();
  const file = elsewhere("a3");
  // Written by the build that read the path and recorded what it found, minutes
  // ago — well inside the day a marker is honoured for.
  disk.files.set(
    coverFailurePath(unreadableKey(file.path)),
    JSON.stringify({
      reason: "unreadable",
      message: "no file",
      path: file.path,
      name: file.name,
      at: Date.now(),
      reader: "file",
    }),
  );
  downloaded("a3");

  expect((await bookCover(file)).url).toStartWith("data:image/jpeg;base64,");
});

test("a book whose own copy is here and will not open is still written off", async () => {
  rendersAnything();
  const file = elsewhere("a4");
  downloaded("a4");
  disk.unreadable.add(libraryBookPath("a4", "pdf"));

  expect((await bookCover(file)).url).toBeNull();
  expect(markers()).toEqual([coverFailurePath(unreadableKey(file.path))]);
});

test("a picked file that was never imported is still written off", async () => {
  rendersAnything();
  const file: FileRef = { path: "/Users/me/Books/gone.pdf", name: "gone.pdf", addedAt: 0 };

  expect((await bookCover(file)).url).toBeNull();
  expect(markers()).toEqual([coverFailurePath(unreadableKey(file.path))]);
});
