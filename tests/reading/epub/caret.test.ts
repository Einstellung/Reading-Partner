import { describe, expect, test } from "bun:test";
import { lineOf, nearestOffset, type Box } from "../../../src/reading/epub/caret";

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
