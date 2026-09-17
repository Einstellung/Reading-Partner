// The shelf asking for a cover a second time (docs/70). A card's files do not
// change when the phone downloads the book behind one of them, so the effect
// that fetches covers has nothing to react to; `revision` is what the host bumps
// to say the answer is a different answer now.
//
// The real covers.ts against tests/support/appdata-fake.ts, so what is being
// asserted is that the band shows the cover, not that a stub was called.
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { installAppData, type FakeDisk } from "../../../support/appdata-fake";
import { useDom } from "../../../support/dom";
import { libraryBookPath } from "../../../../src/platform/app/library";
import type { FileRef } from "../../../../src/platform/app/topics";
import * as raster from "../../../../src/reading/engine/raster";
import { useCovers } from "../../../../src/ui/components/shelf/useCovers";

const { cleanup, renderHook, waitFor } = await useDom();

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
  spyOn(raster, "renderFirstPageJpeg").mockImplementation(async () => ({
    kind: "ok",
    jpeg: new Uint8Array([0xff, 0xd8, 0xff]),
    metadata: null,
  }));
});

afterEach(() => cleanup());

// A book filed on the desk, listed on a phone that does not hold it.
function elsewhere(hash: string): FileRef {
  return { path: `/Users/someone/Books/${hash}.epub`, name: `${hash}.epub`, addedAt: 0, hash };
}

function downloaded(hash: string): void {
  disk.blobs.set(libraryBookPath(hash, "pdf"), PDF_BYTES);
}

function band(file: FileRef) {
  return renderHook(({ revision }: { revision: number }) => useCovers([file], revision), {
    initialProps: { revision: 0 },
  });
}

test("a bump asks again, and the downloaded book's cover arrives", async () => {
  const file = elsewhere("b1");
  const { result, rerender } = band(file);
  await waitFor(() => expect(result.current.covers[file.path]).toBeNull());

  downloaded("b1");
  rerender({ revision: 1 });

  await waitFor(() => expect(result.current.covers[file.path]).toStartWith("data:image/jpeg"));
});

test("without one, a re-render asks nothing: the files are the same files", async () => {
  const file = elsewhere("b2");
  const { result, rerender } = band(file);
  await waitFor(() => expect(result.current.covers[file.path]).toBeNull());

  downloaded("b2");
  rerender({ revision: 0 });
  await Promise.resolve();

  expect(result.current.covers[file.path]).toBeNull();
});
