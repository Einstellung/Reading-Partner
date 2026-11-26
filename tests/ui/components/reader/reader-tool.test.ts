// The navigation lock is on the rack only where there is touch input: with no
// stylus to lock, a desktop rack leaves it out (docs/09).

import { expect, test } from "bun:test";
import { hasTouchInput, rackOmits } from "../../../../src/ui/components/reader/reader-tool";

const media = (coarse: boolean) => ({
  matchMedia: (q: string) => ({ matches: q === "(any-pointer: coarse)" && coarse }) as MediaQueryList,
});

test("a device with a touch screen keeps the lock; one without drops it", () => {
  expect(rackOmits(hasTouchInput(media(true)))).toEqual([]);
  expect(rackOmits(hasTouchInput(media(false)))).toEqual(["navlock"]);
});

test("a webview with no matchMedia is read as having no touch input", () => {
  expect(hasTouchInput({} as Pick<Window, "matchMedia">)).toBe(false);
  expect(hasTouchInput(undefined)).toBe(false);
});
