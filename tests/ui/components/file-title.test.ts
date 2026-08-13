// What a book is called on screen (src/ui/components/shelf/file-title.ts).
// The name on disk is what a download left behind, and a pirate site's domains
// were being read out on the card; the author in the same kind of brackets is
// worth keeping, so this cannot be "drop every parenthesis". Run: bun test.

import { expect, test } from "bun:test";
import {
  displayFileTitle,
  readingLabel,
  readingProgress,
} from "../../../src/ui/components/shelf/file-title";

test("the source brackets go and the author's stay", () => {
  expect(displayFileTitle("智能简史 (麦克斯·班尼特) (z-library.sk, 1lib.sk, z-lib.sk).pdf")).toBe(
    "智能简史 (麦克斯·班尼特)",
  );
});

test("a name with only an author keeps it whole", () => {
  expect(displayFileTitle("A Brief History of Intelligence (Max Bennett).pdf")).toBe(
    "A Brief History of Intelligence (Max Bennett)",
  );
});

test("a name with only a source loses it", () => {
  expect(displayFileTitle("Structure and Interpretation (annas-archive.org).pdf")).toBe(
    "Structure and Interpretation",
  );
  expect(displayFileTitle("Deep Learning [libgen.li].pdf")).toBe("Deep Learning");
});

test("a plain name only loses its extension", () => {
  expect(displayFileTitle("attention-is-all-you-need.pdf")).toBe("attention-is-all-you-need");
  expect(displayFileTitle("读书分享准备.pdf")).toBe("读书分享准备");
});

test("a source outside brackets goes too, with the separator it leaves", () => {
  expect(displayFileTitle("Deep Learning - z-lib.org.pdf")).toBe("Deep Learning");
  expect(displayFileTitle("Compilers www.example.com.pdf")).toBe("Compilers");
});

test("a name that is nothing but a source falls back to the file name", () => {
  expect(displayFileTitle("(z-lib.org).pdf")).toBe("(z-lib.org).pdf");
  expect(displayFileTitle("libgen.rs.pdf")).toBe("libgen.rs.pdf");
});

test("a dot that is part of the title survives", () => {
  expect(displayFileTitle("Node.js in Action.pdf")).toBe("Node.js in Action");
  expect(displayFileTitle("Vol.2 - Standard Lib.pdf")).toBe("Vol.2 - Standard Lib");
});

test("the reading line carries the page and the marks, and no timestamp", () => {
  expect(readingLabel({ page: 195, pages: 318, marks: 84 })).toBe("Page 195 of 318 · 84 marks");
  expect(readingLabel({ page: 12, marks: 1 })).toBe("Page 12 · 1 mark");
  expect(readingLabel({ marks: 0 })).toBe("");
  expect(readingLabel(undefined)).toBe("");
});

test("progress needs both ends of the fraction, and never runs past the card", () => {
  expect(readingProgress({ page: 159, pages: 318, marks: 0 })).toBeCloseTo(0.5, 6);
  expect(readingProgress({ page: 5, marks: 0 })).toBeNull();
  expect(readingProgress({ marks: 3 })).toBeNull();
  expect(readingProgress(undefined)).toBeNull();
  // A position kept from a longer edition of the same book.
  expect(readingProgress({ page: 400, pages: 318, marks: 0 })).toBe(1);
});
