// Host paths on the way in (src/platform/app/path.ts). iOS hands the app a
// percent-encoded file URL for a shared or picked PDF; everything else hands it
// a plain path, and a plain path must survive untouched even when it carries a
// literal "%". Run: bun test.

import { expect, test } from "bun:test";
import { basename, decodeLegacyName, normalizeFilePath } from "../src/platform/app/path";

// The real one: a Chinese title shared into the app on an iPad.
const IOS_URL =
  "file:///private/var/mobile/Containers/Data/Application/9F0CD313/tmp/" +
  "com.xinyuan.readingpartner-Inbox/%E5%85%A8%E7%90%83%E8%A7%86%E9%87%8E%E4%B8%8B" +
  "%E7%9A%84%E6%8A%95%E8%B5%84%E6%9C%BA%E4%BC%9A%20%E6%97%B6%E5%AF%92%E5%86%B0%E8%AF%B4" +
  "%20(%E6%97%B6%E5%AF%92%E5%86%B0)%20(z-library.sk,%201lib.sk,%20z-lib.sk).pdf";

test("an iOS share-sheet URL becomes a plain path with the real filename", () => {
  const path = normalizeFilePath(IOS_URL);
  expect(path.startsWith("/private/var/mobile/")).toBe(true);
  expect(basename(path)).toBe(
    "全球视野下的投资机会 时寒冰说 (时寒冰) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
  );
});

test("a plain path is returned as it came, literal percent and all", () => {
  expect(normalizeFilePath("/home/x/50%.pdf")).toBe("/home/x/50%.pdf");
  // Decoding this would have been "/home/x/a b.pdf" — but nothing said it was a
  // URL, so the file really is named "a%20b.pdf".
  expect(normalizeFilePath("/home/x/a%20b.pdf")).toBe("/home/x/a%20b.pdf");
  expect(normalizeFilePath("C:\\books\\a%20b.pdf")).toBe("C:\\books\\a%20b.pdf");
});

test("a malformed escape keeps its raw text instead of failing the import", () => {
  // decodeURIComponent throws on both of these.
  expect(normalizeFilePath("file:///tmp/50%.pdf")).toBe("/tmp/50%.pdf");
  expect(normalizeFilePath("file:///tmp/%E5%.pdf")).toBe("/tmp/%E5%.pdf");
  // The bad segment is the only one that keeps its escapes.
  expect(normalizeFilePath("file:///%E4%B8%AD/%zz.pdf")).toBe("/中/%zz.pdf");
});

test("normalizing is idempotent — a decoded path is not decoded twice", () => {
  const once = normalizeFilePath(IOS_URL);
  expect(normalizeFilePath(once)).toBe(once);
  const literal = normalizeFilePath("file:///tmp/100%25.pdf");
  expect(literal).toBe("/tmp/100%.pdf");
  expect(normalizeFilePath(literal)).toBe(literal);
});

test("a file URL's host: localhost and empty drop out, a share name stays", () => {
  expect(normalizeFilePath("file:///tmp/a.pdf")).toBe("/tmp/a.pdf");
  expect(normalizeFilePath("file://localhost/tmp/a.pdf")).toBe("/tmp/a.pdf");
  expect(normalizeFilePath("file://server/share/a.pdf")).toBe("//server/share/a.pdf");
});

test("a Windows file URL loses the slash in front of the drive letter", () => {
  expect(normalizeFilePath("file:///C:/books/%E4%B8%AD.pdf")).toBe("C:/books/中.pdf");
});

test("basename takes the last segment on either separator", () => {
  expect(basename("/home/x/a.pdf")).toBe("a.pdf");
  expect(basename("C:\\books\\a.pdf")).toBe("a.pdf");
  expect(basename("C:/books\\sub/a.pdf")).toBe("a.pdf");
  expect(basename("a.pdf")).toBe("a.pdf");
  // No last segment to take: the input is all there is to show.
  expect(basename("/home/x/")).toBe("/home/x/");
});

// --- repairing names already on disk ---------------------------------------

test("a stored name that is percent-encoded output is decoded", () => {
  expect(decodeLegacyName("%E4%B8%AD%E6%96%87.pdf")).toBe("中文.pdf");
  expect(decodeLegacyName("a%20b%20(c,%20d).pdf")).toBe("a b (c, d).pdf");
});

test("a name that could not be percent-encoded output is left alone", () => {
  // Already readable: a space or a non-ASCII character means it was never
  // encoded, whatever else it contains.
  expect(decodeLegacyName("Chapter 1 %E4%B8%AD.pdf")).toBe("Chapter 1 %E4%B8%AD.pdf");
  expect(decodeLegacyName("中%20文.pdf")).toBe("中%20文.pdf");
  // No escape at all.
  expect(decodeLegacyName("50%.pdf")).toBe("50%.pdf");
  expect(decodeLegacyName("plain.pdf")).toBe("plain.pdf");
  expect(decodeLegacyName("")).toBe("");
});

test("a decode that would break the name out of its filename is refused", () => {
  // "%2F" would turn a name into a path.
  expect(decodeLegacyName("a%2Fb.pdf")).toBe("a%2Fb.pdf");
  expect(decodeLegacyName("a%5Cb.pdf")).toBe("a%5Cb.pdf");
  // Invalid UTF-8 in the escapes.
  expect(decodeLegacyName("a%E5%.pdf")).toBe("a%E5%.pdf");
  expect(decodeLegacyName("a%zz.pdf")).toBe("a%zz.pdf");
});

test("repairing a name is idempotent", () => {
  const once = decodeLegacyName("%E4%B8%AD%E6%96%87%20a.pdf");
  expect(once).toBe("中文 a.pdf");
  expect(decodeLegacyName(once)).toBe(once);
  // The pathological one: a real file named "100%25.pdf" would be decoded once
  // to "100%.pdf" and then stop, because "100%.pdf" carries no escape.
  const twice = decodeLegacyName("100%25.pdf");
  expect(twice).toBe("100%.pdf");
  expect(decodeLegacyName(twice)).toBe(twice);
});
