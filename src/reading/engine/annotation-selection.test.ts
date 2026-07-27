import { expect, test } from "bun:test";
import { SELECT_AFTER_CREATE, popupEffect, selectionChanged } from "./annotation-selection";

// Every finished stroke used to pop the annotation editor over the page: the
// plugin selects what it creates by default, and the host opens the editor on a
// selection. Drawing a line has to draw a line and stop there.
test("a finished stroke leaves nothing selected", () => {
  expect(SELECT_AFTER_CREATE).toBe(false);
});

test("a create says nothing, and tapping the mark it made opens the editor", () => {
  // The create republishes the plugin state with the selection array it already
  // held — the same array, so nothing reaches the editor.
  const nothingSelected: string[] = [];
  expect(selectionChanged(nothingSelected, nothingSelected)).toBe(false);
  // The reader then taps the new mark: a select dispatch builds a new array.
  expect(selectionChanged(nothingSelected, ["new"])).toBe(true);
  expect(popupEffect("new", false)).toBe("open");
});

// The reported bug: switching from the pen to the palm popped the annotation
// editor over the middle of the page. The tool change made the annotation plugin
// republish its state with the selection the last pen stroke had left behind, the
// host read that as a fresh selection and armed the editor's fallback timer.
test("the same id array coming back is not a selection change", () => {
  const selected = ["a"];
  expect(selectionChanged(selected, selected)).toBe(false);
});

test("selecting, re-selecting and deselecting are all changes", () => {
  expect(selectionChanged(null, ["a"])).toBe(true);
  expect(selectionChanged([], ["a"])).toBe(true);
  // A second tap on the mark whose editor was just dismissed: same id, new array.
  expect(selectionChanged(["a"], ["a"])).toBe(true);
  expect(selectionChanged(["a"], ["b"])).toBe(true);
  expect(selectionChanged(["a"], [])).toBe(true);
});

test("nothing selected before and nothing selected now says nothing", () => {
  expect(selectionChanged(null, [])).toBe(false);
  expect(selectionChanged([], [])).toBe(false);
});

test("a tool change may neither open the editor nor close it", () => {
  expect(popupEffect("a", true)).toBe("ignore");
  expect(popupEffect(null, true)).toBe("ignore");
});

test("outside a tool change, a selection opens the editor and a deselection closes it", () => {
  expect(popupEffect("a", false)).toBe("open");
  expect(popupEffect(null, false)).toBe("close");
});
