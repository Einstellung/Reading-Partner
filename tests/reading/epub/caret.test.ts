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
});
