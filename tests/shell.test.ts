// Unit tests for the shell choice (src/platform/app/shell.ts): which of the two
// shells a given viewport gets, and the ?shell= override that lets a desktop see
// the phone one. Run: bun test.

import { expect, test } from "bun:test";
import { detectShell, pickShell, readShellEnv } from "../src/platform/app/shell";

test("a narrow viewport with a finger gets the phone shell", () => {
  expect(pickShell({ width: 393, coarsePointer: true, override: null })).toBe("phone");
});

test("a narrow window with a mouse stays on the desktop shell", () => {
  expect(pickShell({ width: 393, coarsePointer: false, override: null })).toBe("desktop");
});

test("a tablet is wide enough for the desktop shell despite the finger", () => {
  expect(pickShell({ width: 834, coarsePointer: true, override: null })).toBe("desktop");
});

test("the boundary is Tailwind's sm breakpoint: 640 is already desktop", () => {
  expect(pickShell({ width: 639, coarsePointer: true, override: null })).toBe("phone");
  expect(pickShell({ width: 640, coarsePointer: true, override: null })).toBe("desktop");
});

test("?shell= overrides both measurements, in either direction", () => {
  expect(pickShell({ width: 1440, coarsePointer: false, override: "phone" })).toBe("phone");
  expect(pickShell({ width: 393, coarsePointer: true, override: "desktop" })).toBe("desktop");
});

test("an unknown ?shell= value is ignored rather than treated as phone", () => {
  expect(pickShell({ width: 1440, coarsePointer: false, override: "tablet" })).toBe("desktop");
  expect(pickShell({ width: 393, coarsePointer: true, override: "" })).toBe("phone");
});

// A window object with only the parts the reader touches.
function fakeWindow(opts: { width: number; coarse?: boolean; search?: string }): Window {
  return {
    innerWidth: opts.width,
    location: { search: opts.search ?? "" },
    matchMedia: opts.coarse === undefined
      ? undefined
      : (q: string) => ({ matches: q === "(pointer: coarse)" ? !!opts.coarse : false }),
  } as unknown as Window;
}

test("the environment is read off the window, override included", () => {
  expect(readShellEnv(fakeWindow({ width: 393, coarse: true, search: "?shell=desktop" }))).toEqual({
    width: 393,
    coarsePointer: true,
    override: "desktop",
  });
});

test("a webview without matchMedia is treated as a fine pointer", () => {
  expect(detectShell(fakeWindow({ width: 393 }))).toBe("desktop");
  expect(detectShell(fakeWindow({ width: 393, search: "?shell=phone" }))).toBe("phone");
});
