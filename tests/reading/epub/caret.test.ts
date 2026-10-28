import { describe, expect, test } from "bun:test";
import { glyphBox, lineOf, nearestOffset, onGlyph, strokeRange, type Box } from "../../../src/reading/epub/caret";

// A text node laid out as ten characters a line, ten pixels a character,
// twenty pixels a line. `columns[k]` is how many lines column k holds; column k
// starts 200px to the right of the one before, at the top again.
function layout(columns: number[]): { length: number; lines: Box[]; caret: (i: number) => Box } {
  const lines: Box[] = [];
  columns.forEach((count, k) => {
    for (let row = 0; row < count; row++) {
      lines.push({ left: 200 * k, right: 200 * k + 100, top: 20 * row, bottom: 20 * row + 20 });
    }
  });
  const length = lines.length * 10;
  const caret = (i: number): Box => {
    const line = lines[Math.min(Math.floor(i / 10), lines.length - 1)];
    const x = line.left + (i === length ? 10 : i % 10) * 10;
    return { left: x, right: x, top: line.top, bottom: line.bottom };
  };
  return { length, lines, caret };
}

describe("the caret in a text node", () => {
  test("a point on the top line of a later column is after every line of the column before", () => {
    // Five lines in the first column, two in the second: the second column's
    // top line is higher on screen than most of the first column.
    const { length, lines, caret } = layout([5, 2]);
    expect(nearestOffset(length, caret, lines, 201, 5)).toBe(50);
    expect(nearestOffset(length, caret, lines, 234, 25)).toBe(63);
  });

  test("a point in the first column stays there", () => {
    const { length, lines, caret } = layout([5, 2]);
    expect(nearestOffset(length, caret, lines, 1, 5)).toBe(0);
    expect(nearestOffset(length, caret, lines, 42, 85)).toBe(44);
  });

  test("a point left of a line's first character is at that character, not the end of the line above", () => {
    // Left of the second column's top line, where a blockquote's padding
    // would be: the stroke starts the column, and the first column's last
    // character (the page before, on a sheet) is not in it.
    const { length, lines, caret } = layout([5, 2]);
    expect(nearestOffset(length, caret, lines, 195, 5)).toBe(50);
    expect(nearestOffset(length, caret, lines, -5, 25)).toBe(10);
  });

  test("a character at the start of a wrapped line is measured by its glyph, not the empty box before it", () => {
    // What WebKit reports for the first character of a column's top line whose
    // text node began in the column before: an empty box at the end of the
    // last line there, then the glyph (measured on the iPad simulator).
    const rects: Box[] = [
      { left: 27, right: 27, top: 1077, bottom: 1101 },
      { left: 66, right: 82, top: 151, bottom: 175 },
    ];
    expect(glyphBox(rects)).toEqual(rects[1]);
    expect(glyphBox([{ left: 5, right: 5, top: 0, bottom: 20 }])).toEqual({ left: 5, right: 5, top: 0, bottom: 20 });
    expect(glyphBox([])).toBeNull();
  });

  test("one column reads top to bottom, with or without the line boxes", () => {
    const { length, lines, caret } = layout([4]);
    expect(nearestOffset(length, caret, lines, 57, 45)).toBe(26);
    expect(nearestOffset(length, caret, [], 57, 45)).toBe(26);
  });

  test("a box is on the line that holds its middle, else the nearest", () => {
    const { lines } = layout([2, 2]);
    expect(lineOf(lines, { left: 210, right: 210, top: 20, bottom: 40 })).toBe(3);
    expect(lineOf(lines, { left: 150, right: 150, top: 0, bottom: 20 })).toBe(0);
  });

  test("a point past the end of a short last line is on that line, not the full line above", () => {
    // Glyph boxes sixteen pixels tall on a twenty-four pixel pitch, as the
    // engine reports them: the gap between lines is wider than the slack. Two
    // full lines of thirty characters, then six.
    const lines: Box[] = [
      { left: 0, right: 300, top: 0, bottom: 16 },
      { left: 0, right: 300, top: 24, bottom: 40 },
      { left: 0, right: 60, top: 48, bottom: 64 },
    ];
    const length = 66;
    const caret = (i: number): Box => {
      const row = Math.min(Math.floor(i / 30), 2);
      const x = i === length ? 60 : (i - row * 30) * 10;
      return { left: x, right: x, top: lines[row].top, bottom: lines[row].bottom };
    };
    expect(lineOf(lines, { left: 200, right: 200, top: 56, bottom: 56 })).toBe(2);
    expect(nearestOffset(length, caret, lines, 200, 56)).toBe(66);
  });
});

// docs/pitfall/676: the boundary nearest a finger on a character's right half
// is after it, so the caret steps back when the point is on the character.
describe("the character under a point", () => {
  const glyph: Box = { left: 100, right: 118, top: 40, bottom: 64 };

  test("either half of a character is on it", () => {
    expect(onGlyph(glyph, 104, 52)).toBe(true);
    expect(onGlyph(glyph, 114, 52)).toBe(true);
  });

  test("the next character's left edge is not on this one", () => {
    expect(onGlyph(glyph, 118, 52)).toBe(false);
    expect(onGlyph(glyph, 99, 52)).toBe(false);
  });

  test("the leading between lines counts as the line; the next line does not", () => {
    expect(onGlyph(glyph, 110, 70)).toBe(true);
    expect(onGlyph(glyph, 110, 90)).toBe(false);
    expect(onGlyph(glyph, 110, 10)).toBe(false);
  });

  test("a box with no width or no box is no character", () => {
    expect(onGlyph({ left: 100, right: 100, top: 40, bottom: 64 }, 100, 50)).toBe(false);
    expect(onGlyph(null, 100, 50)).toBe(false);
  });
});

describe("a pen stroke from the character it came down on", () => {
  const owner = new DOMParser().parseFromString("<p>人工智能的历史可以追溯</p>", "text/html");
  const node = owner.querySelector("p")!.firstChild as Text;
  const at = (offset: number) => ({ node, offset });
  const onChar = (i: number) => ({ start: at(i), end: at(i + 1) });

  test("forward: from that character to the boundary the pen reached", () => {
    expect(strokeRange(owner, onChar(5), at(9))?.toString()).toBe("历史可以");
  });

  test("backward: that character is still in the stroke", () => {
    expect(strokeRange(owner, onChar(8), at(5))?.toString()).toBe("历史可以");
  });

  test("a start on no character is a boundary both ways", () => {
    expect(strokeRange(owner, { start: at(5), end: at(5) }, at(3))?.toString()).toBe("能的");
  });
});
