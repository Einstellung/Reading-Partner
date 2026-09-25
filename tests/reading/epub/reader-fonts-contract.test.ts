// The paged desk mounts no card before the reading faces are in, read off the
// source (docs/pitfall/425). A card measures its page's column once, when it is
// shown; against the fallback face it lands a column early and stays there.
//
// Source text rather than a run: createEpubReader mounts the book's parsed
// trees, which the suite parses with jsdom, into the window's document, and
// happy-dom neither imports jsdom nodes nor parses the package XML itself.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");

// Comments out, the way chat-scale-contract reads its files: prose about the
// wait would answer a search for the wait.
function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("the desk waits for the faces between the table and the first card", () => {
  const desk = read("reading/epub/reader-view.ts");
  const opened = desk.indexOf("await ensurePagination(");
  const faces = desk.indexOf("await readingFontsReady()");
  expect(opened).toBeGreaterThan(-1);
  expect(faces).toBeGreaterThan(opened);
  for (const mount of ["placePage(", "mountSlot(", "createPageCard("]) {
    expect(desk.indexOf(mount)).toBeGreaterThan(faces);
  }
});

test("the column waits the same way", () => {
  const column = read("reading/epub/flow-view.ts");
  const opened = column.indexOf("await ensurePagination(");
  const faces = column.indexOf("await readingFontsReady()");
  expect(faces).toBeGreaterThan(opened);
});
