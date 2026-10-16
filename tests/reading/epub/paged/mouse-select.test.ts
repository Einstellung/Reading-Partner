// A mouse selects words only where the shell lets it (a brief, docs/info/88):
// with no tool in hand, from a press on the words, once it moves. A press that
// put a selection away is not a click.

import { describe, expect, test } from "bun:test";
import { notePutAway, wasPutAway } from "../../../../src/reading/engine/gesture/put-away";
import {
  MOUSE_SELECT_SLOP,
  mousePress,
  mouseSelectBegins,
  type MousePressInput,
} from "../../../../src/reading/epub/paged/mouse-select";

const press = (over: Partial<MousePressInput> = {}): MousePressInput => ({
  enabled: true,
  tool: "none",
  pointer: "mouse",
  putAway: false,
  onWords: true,
  ...over,
});

describe("which presses the mouse's selection takes", () => {
  test("a mouse on the words with no tool, in a reader that lets it", () => {
    expect(mousePress(press())).toEqual({ selects: true, swallowsClick: false });
  });

  test("a book's reader: the mouse selects nothing, its drag stays the page turn", () => {
    expect(mousePress(press({ enabled: false }))).toBeNull();
    expect(mousePress(press({ enabled: false, putAway: true }))).toBeNull();
  });

  test("a tool in hand or the navigation lock keeps the press", () => {
    expect(mousePress(press({ tool: "annotate" }))).toBeNull();
    expect(mousePress(press({ tool: "navlock" }))).toBeNull();
  });

  test("a finger or a stylus is the touch router's, not the mouse's", () => {
    expect(mousePress(press({ pointer: "touch" }))).toBeNull();
    expect(mousePress(press({ pointer: "pen" }))).toBeNull();
  });

  test("off the words the press is the page's", () => {
    expect(mousePress(press({ onWords: false }))).toBeNull();
  });

  test("a press that put a selection away is no click; on the words it may still select", () => {
    expect(mousePress(press({ putAway: true }))).toEqual({ selects: true, swallowsClick: true });
    expect(mousePress(press({ putAway: true, onWords: false }))).toEqual({ selects: false, swallowsClick: true });
  });
});

test("a press becomes a selection once it moves past the slop", () => {
  expect(mouseSelectBegins(0, 0)).toBe(false);
  expect(mouseSelectBegins(MOUSE_SELECT_SLOP - 1, 0)).toBe(false);
  expect(mouseSelectBegins(MOUSE_SELECT_SLOP, 0)).toBe(true);
  expect(mouseSelectBegins(3, 3)).toBe(true);
});

test("the router's put-away mark is on that press alone", () => {
  const a = new Event("pointerdown");
  const b = new Event("pointerdown");
  notePutAway(a);
  expect(wasPutAway(a)).toBe(true);
  expect(wasPutAway(b)).toBe(false);
});
