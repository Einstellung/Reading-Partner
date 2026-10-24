// Shrinking a drawn picture before it is kept (src/info/meals/photos/picture-shrink.ts),
// with the host's decode and encode replaced by a fake.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  MAX_PICTURE_EDGE,
  PICTURE_JPEG_QUALITY,
  shrinkDrawnPicture,
  webviewPictureResizer,
  type PictureResizer,
} from "../../../../src/info/meals/photos/picture-shrink";
import { saveDrawingFile } from "../../../../src/info/meals/photos/photo-store";
import { contentHash } from "../../../../src/platform/app/content-hash";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 7, 7, 7]);

interface Call {
  width: number;
  height: number;
  quality: number;
}

/** A resizer that says the picture is `width` x `height` and encodes to a marked JPEG. */
function fakeResizer(width: number, height: number, opts: { failOpen?: boolean; failEncode?: boolean; encodeTo?: Uint8Array } = {}) {
  const calls: Call[] = [];
  let closed = 0;
  const resizer: PictureResizer = {
    async open() {
      if (opts.failOpen) throw new Error("will not decode");
      return {
        width,
        height,
        async jpeg(w, h, quality) {
          calls.push({ width: w, height: h, quality });
          if (opts.failEncode) throw new Error("will not encode");
          return opts.encodeTo ?? new Uint8Array([0xff, 0xd8, 0xff, w & 0xff, h & 0xff]);
        },
        close() {
          closed += 1;
        },
      };
    },
  };
  return { resizer, calls, closed: () => closed };
}

test("a large PNG comes down to a JPEG no longer than 1024 on its long side", async () => {
  const fake = fakeResizer(1536, 1024);
  const kept = await shrinkDrawnPicture(PNG, "image/png", fake.resizer);
  expect(kept.mediaType).toBe("image/jpeg");
  expect(fake.calls).toEqual([{ width: MAX_PICTURE_EDGE, height: 683, quality: PICTURE_JPEG_QUALITY }]);
  expect(Array.from(kept.bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  expect(fake.closed()).toBe(1);
});

test("a large JPEG is redrawn smaller, a tall one by its height", async () => {
  const fake = fakeResizer(1000, 2000);
  const kept = await shrinkDrawnPicture(JPEG, "image/jpeg", fake.resizer);
  expect(fake.calls).toEqual([{ width: 512, height: 1024, quality: PICTURE_JPEG_QUALITY }]);
  expect(kept.bytes).not.toBe(JPEG);
});

test("a JPEG already within 1024 is kept as sent, not re-encoded", async () => {
  const fake = fakeResizer(1024, 576);
  const kept = await shrinkDrawnPicture(JPEG, "image/jpeg", fake.resizer);
  expect(kept).toEqual({ bytes: JPEG, mediaType: "image/jpeg" });
  expect(fake.calls).toEqual([]);
  expect(fake.closed()).toBe(1);
});

test("a small PNG still becomes a JPEG, at its own size", async () => {
  const fake = fakeResizer(800, 450);
  const kept = await shrinkDrawnPicture(PNG, "image/png", fake.resizer);
  expect(kept.mediaType).toBe("image/jpeg");
  expect(fake.calls).toEqual([{ width: 800, height: 450, quality: PICTURE_JPEG_QUALITY }]);
});

test("a picture that will not decode, encode, or encodes to something else is kept as sent", async () => {
  for (const opts of [{ failOpen: true }, { failEncode: true }, { encodeTo: new Uint8Array() }, { encodeTo: PNG }]) {
    const fake = fakeResizer(1536, 1024, opts);
    expect(await shrinkDrawnPicture(PNG, "image/png", fake.resizer)).toEqual({ bytes: PNG, mediaType: "image/png" });
  }
  // A host with no canvas (this test runner) keeps it too.
  expect(await shrinkDrawnPicture(PNG, "image/png", webviewPictureResizer)).toEqual({ bytes: PNG, mediaType: "image/png" });
});

function memoryDrawings() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    io: {
      readBytes: async (path: string) => files.get(path) ?? new Uint8Array(),
      writeBytes: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes);
      },
      mkdirp: async () => {},
    },
  };
}

test("the kept file is named for the shrunk bytes, with their extension", async () => {
  const disk = memoryDrawings();
  const shrunk = new Uint8Array([0xff, 0xd8, 0xff, 42]);
  const path = await saveDrawingFile(PNG, "image/png", disk.io, fakeResizer(1536, 1024, { encodeTo: shrunk }).resizer);
  expect(path).toBe(`meals-pictures/${await contentHash(shrunk)}.jpg`);
  expect(disk.files.get(path)).toEqual(shrunk);
  expect(disk.files.size).toBe(1);
});

test("a picture that could not be shrunk is kept under its own hash and type", async () => {
  const disk = memoryDrawings();
  const path = await saveDrawingFile(PNG, "image/png", disk.io, fakeResizer(1536, 1024, { failOpen: true }).resizer);
  expect(path).toBe(`meals-pictures/${await contentHash(PNG)}.png`);
  expect(disk.files.get(path)).toEqual(PNG);
});
