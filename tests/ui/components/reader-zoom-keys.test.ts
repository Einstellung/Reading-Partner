// The reader's zoom keys (src/ui/components/reader/reader-zoom-keys.ts): when a
// press is the page's, and what each action does to the view handle. The hook
// around them is three lines of binding. Run: bun test.

import { expect, test } from "bun:test";
import {
  applyReaderZoom,
  readerZoomKeyAction,
  zoomResetLabel,
} from "../../../src/ui/components/reader/reader-zoom-keys";
import type { ViewInstance } from "../../../src/platform/app/reader-contract";

function press(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) {
  return { key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt };
}

const reading = { inReader: true, chatFullWindow: false };

test("the zoom keys, while a book is open", () => {
  expect(readerZoomKeyAction(press("=", { ctrl: true }), reading)).toBe("in");
  expect(readerZoomKeyAction(press("-", { meta: true }), reading)).toBe("out");
  expect(readerZoomKeyAction(press("0", { ctrl: true }), reading)).toBe("reset");
  expect(readerZoomKeyAction(press("="), reading)).toBe(null);
});

test("no book, no claim", () => {
  const home = { inReader: false, chatFullWindow: false };
  expect(readerZoomKeyAction(press("=", { ctrl: true }), home)).toBe(null);
});

test("the full-window chat keeps the keys", () => {
  // Both bindings sit on window; claiming the press here too would zoom the
  // page and the chat column on one keystroke.
  const chat = { inReader: true, chatFullWindow: true };
  expect(readerZoomKeyAction(press("=", { ctrl: true }), chat)).toBe(null);
  expect(readerZoomKeyAction(press("0", { meta: true }), chat)).toBe(null);
});

function fakeView() {
  const calls: string[] = [];
  const view = {
    zoomIn: () => calls.push("zoomIn"),
    zoomOut: () => calls.push("zoomOut"),
    zoomReset: () => calls.push("zoomReset"),
    setLayout: (m: string) => calls.push(`setLayout:${m}`),
  } as unknown as ViewInstance;
  return { view, calls };
}

test("in and out are the handle's own steps", () => {
  const { view, calls } = fakeView();
  applyReaderZoom(view, "vertical", "in");
  applyReaderZoom(view, "vertical", "out");
  expect(calls).toEqual(["zoomIn", "zoomOut"]);
});

test("reset is fit-width scrolling vertically", () => {
  const { view, calls } = fakeView();
  applyReaderZoom(view, "vertical", "reset");
  expect(calls).toEqual(["zoomReset"]);
});

test("reset is the same call in the paged layout", () => {
  // Which fit that is belongs to the engine (layout-modes.resetZoom), not to
  // the key press.
  const { view, calls } = fakeView();
  applyReaderZoom(view, "paged", "reset");
  expect(calls).toEqual(["zoomReset"]);
});

test("the reset item names the fit its layout lands on", () => {
  expect(zoomResetLabel("vertical")).toBe("Fit page width");
  expect(zoomResetLabel("paged")).toBe("Fit page");
  // No stats yet: the reader opens vertical.
  expect(zoomResetLabel(undefined)).toBe("Fit page width");
});

test("a press before the view is ready is dropped", () => {
  expect(() => applyReaderZoom(null, "vertical", "in")).not.toThrow();
});
