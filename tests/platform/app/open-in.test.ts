// The Open in… wrapper (src/platform/app/open-in.ts) where there is no native
// half. bun is not a phone and there is no Tauri host under it, which is the
// desktop and browser case too, and the whole contract of the probe is that a
// caller never hears about it: it answers false and the control is not drawn.
//
// Run: scripts/t.sh tests/platform/app/open-in.test.ts

import { expect, test } from "bun:test";

import { openIn, openInAvailable, shareFileName } from "../../../src/platform/app/open-in";

test("no host means no Open in…", async () => {
  expect(await openInAvailable()).toBe(false);
});

test("handing a file over with no host behind it rejects rather than resolving", async () => {
  // A caller that skipped the probe has to find out. Resolving would leave the
  // reader waiting for a sheet that is never coming.
  await expect(openIn("/tmp/whatever.pdf")).rejects.toThrow();
});

// shareFileName: what the reader sees the file called in the app it lands in.
// The library names its copy after the content hash, so this is the only place
// the book's own title reaches the other app.

test("the title becomes the file name, with the extension on it", () => {
  expect(shareFileName("Attention Is All You Need", "pdf")).toBe(
    "Attention Is All You Need.pdf",
  );
});

test("separators and control characters cannot leave the name a path", () => {
  // One component, and not a hidden one: no slash survives and no dot leads.
  expect(shareFileName("../../etc/passwd", "pdf")).toBe("-..-etc-passwd.pdf");
  expect(shareFileName("a\u0000b", "pdf")).toBe("a b.pdf");
  expect(shareFileName("Notes: volume\\two", "pdf")).toBe("Notes- volume-two.pdf");
});

test("newlines and runs of space fold to one line", () => {
  expect(shareFileName("  Two\nlines   here \t", "pdf")).toBe("Two lines here.pdf");
});

test("a title that already ends in the extension does not get a second one", () => {
  expect(shareFileName("scan.PDF", "pdf")).toBe("scan.pdf");
});

test("a long title is cut to fit a filesystem name, extension kept", () => {
  const name = shareFileName("字".repeat(200), "pdf");
  expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
  expect(name.endsWith(".pdf")).toBe(true);
  // Cut between characters, never inside one.
  expect(name.includes("�")).toBe(false);
});

test("a title with nothing usable in it asks for no name at all", () => {
  // The caller passes no name then, and the file keeps the one on disk —
  // ugly, but a name the filesystem accepts.
  expect(shareFileName("  ", "pdf")).toBe("");
  expect(shareFileName("...", "pdf")).toBe("");
});
