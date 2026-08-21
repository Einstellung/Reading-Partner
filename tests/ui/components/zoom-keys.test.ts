// Which presses are a zoom (src/ui/components/base/zoom-keys.ts). Shared by the
// chat column and the reader, so it is tested apart from either binding.
// Run: bun test.

import { expect, test } from "bun:test";
import { zoomKeyAction } from "../../../src/ui/components/base/zoom-keys";

function press(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) {
  return { key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt };
}

test("the zoom keys, on either modifier", () => {
  expect(zoomKeyAction(press("=", { ctrl: true }))).toBe("in");
  expect(zoomKeyAction(press("+", { ctrl: true }))).toBe("in");
  expect(zoomKeyAction(press("-", { meta: true }))).toBe("out");
  expect(zoomKeyAction(press("_", { meta: true }))).toBe("out");
  expect(zoomKeyAction(press("0", { ctrl: true }))).toBe("reset");
});

test("an unmodified press is the document's, not the zoom's", () => {
  expect(zoomKeyAction(press("="))).toBe(null);
  expect(zoomKeyAction(press("0"))).toBe(null);
  expect(zoomKeyAction(press("a", { ctrl: true }))).toBe(null);
});

test("AltGr is left alone", () => {
  // Layouts that put a character on AltGr send it with ctrlKey set. Claiming
  // those presses would eat the character and zoom instead of typing it.
  expect(zoomKeyAction(press("0", { ctrl: true, alt: true }))).toBe(null);
  expect(zoomKeyAction(press("-", { ctrl: true, alt: true }))).toBe(null);
});
