// The library shelf's arithmetic (src/ui/components/shelf/topic-shelf.ts):
// the column count at each form factor, which covers a card shows and how wide
// they are, and the two labels a card carries. All of it decides what the
// screen looks like and none of it is visible to a type checker, so the numbers
// are pinned here. Run: bun test.

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import {
  COVER_ASPECT,
  coverGridTemplate,
  coverInitial,
  coverTiles,
  fileCountLabel,
  MAX_COVERS,
  shelfOrder,
  singleCoverTile,
  tileStyle,
  TOPIC_GRID_COLUMNS_CLASS,
  TOPIC_GRID_STEPS,
  topicGridColumns,
} from "../../../src/ui/components/shelf/topic-shelf";

function file(name: string, addedAt: number, lastOpenedAt?: number): FileRef {
  return {
    path: `/books/${name}`,
    name,
    addedAt,
    ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
  };
}

function topic(name: string, files: FileRef[], createdAt = 0): Topic {
  return { id: name, name, createdAt, files };
}

test("the grid is dense enough to be a shelf at every form factor", () => {
  expect(topicGridColumns(390)).toBe(2); // phone
  expect(topicGridColumns(820)).toBe(3); // iPad portrait
  expect(topicGridColumns(1180)).toBe(4); // iPad landscape
  expect(topicGridColumns(1600)).toBe(5); // a wide desktop window
});

test("the grid class string is the same table the numbers come from", () => {
  expect(TOPIC_GRID_COLUMNS_CLASS).toBe("grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5");
  // A class Tailwind can only find by reading it: no interpolation anywhere.
  for (const step of TOPIC_GRID_STEPS) {
    expect(step.className).toContain(`grid-cols-${step.columns}`);
  }
});

test("the shelf lists the newest topic first", () => {
  const order = shelfOrder([topic("old", [], 100), topic("new", [], 300), topic("mid", [], 200)]);
  expect(order.map((t) => t.name)).toEqual(["new", "mid", "old"]);
});

test("shelfOrder copies rather than sorting the caller's array", () => {
  const topics = [topic("a", [], 1), topic("b", [], 2)];
  shelfOrder(topics);
  expect(topics.map((t) => t.name)).toEqual(["a", "b"]);
});

test("the covers are the most recently read books, at most four", () => {
  const t = topic("t", [
    file("added-first.pdf", 1),
    file("read-4th.pdf", 2, 200),
    file("read-1st.pdf", 3, 500),
    file("read-3rd.pdf", 4, 300),
    file("read-2nd.pdf", 5, 400),
  ]);
  const tiles = coverTiles(t);
  expect(tiles).toHaveLength(MAX_COVERS);
  expect(tiles.map((c) => c.file.name)).toEqual([
    "read-1st.pdf",
    "read-2nd.pdf",
    "read-3rd.pdf",
    "read-4th.pdf",
  ]);
});

// A cell left empty is what makes a card look unfinished, and one covered twice
// is a cover hidden under another. Both are counted here by walking the grid.
test("every layout fills its grid exactly once", () => {
  for (const count of [1, 2, 3, 4]) {
    const t = topic("t", Array.from({ length: count }, (_, i) => file(`${i}.pdf`, i)));
    const tiles = coverTiles(t);
    expect(tiles).toHaveLength(count);
    const template = coverGridTemplate(count);
    const columns = template.columns.split(" ").length;
    const rows = template.rows.split(" ").length;
    const cells: Record<string, number> = {};
    for (const tile of tiles) {
      for (let c = tile.column; c < tile.column + tile.columnSpan; c++) {
        for (let r = tile.row; r < tile.row + tile.rowSpan; r++) {
          expect(c).toBeLessThanOrEqual(columns);
          expect(r).toBeLessThanOrEqual(rows);
          cells[`${c},${r}`] = (cells[`${c},${r}`] ?? 0) + 1;
        }
      }
    }
    expect(Object.keys(cells)).toHaveLength(columns * rows);
    expect(Object.values(cells).every((n) => n === 1)).toBe(true);
  }
});

test("the most recently read book gets the biggest cell", () => {
  const area = (t: { columnSpan: number; rowSpan: number }) => t.columnSpan * t.rowSpan;
  for (const count of [1, 2, 3, 4]) {
    const topicOf = topic("t", Array.from({ length: count }, (_, i) => file(`${i}.pdf`, i)));
    const tiles = coverTiles(topicOf);
    for (const tile of tiles.slice(1)) {
      expect(area(tiles[0])).toBeGreaterThanOrEqual(area(tile));
    }
  }
  // Three books: one tall cover beside two half ones.
  const three = coverTiles(topic("t", [file("a.pdf", 1), file("b.pdf", 2), file("c.pdf", 3)]));
  expect(three[0].rowSpan).toBe(2);
  expect(three[1].rowSpan).toBe(1);
});

test("one book fills the box, on either screen", () => {
  const one = file("only.pdf", 1);
  const tiles = coverTiles(topic("t", [one]));
  expect(tiles).toEqual(singleCoverTile(one));
  expect(coverGridTemplate(1)).toEqual({ columns: "1fr", rows: "1fr" });
  expect(tileStyle(tiles[0])).toEqual({ gridColumn: "1 / span 1", gridRow: "1 / span 1" });
});

test("a topic with no files has no covers at all", () => {
  expect(coverTiles(topic("t", []))).toEqual([]);
});

test("every card on the page is the same shape", () => {
  // Fixed, and taller than it is wide: the cover is cropped to the card, never
  // the card to the cover, or a row of cards is a saw edge.
  expect(COVER_ASPECT).toBe(0.75);
});

test("the count label carries the empty case and the plural", () => {
  expect(fileCountLabel(0)).toBe("No files");
  expect(fileCountLabel(1)).toBe("1 file");
  expect(fileCountLabel(2)).toBe("2 files");
});

test("the placeholder initial drops the extension and keeps the script", () => {
  expect(coverInitial("attention.pdf")).toBe("A");
  expect(coverInitial("读书分享准备.pdf")).toBe("读");
  expect(coverInitial("v2.final.pdf")).toBe("V");
  // A file whose name is nothing but an extension, and an astral first letter.
  expect(coverInitial(".pdf")).toBe("?");
  expect(coverInitial("𝕏 notes.pdf")).toBe("𝕏");
});
