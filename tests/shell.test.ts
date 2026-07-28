// Unit tests for the shell choice (src/platform/app/shell.ts): which of the two
// shells a given viewport gets, and the ?shell= override that lets a desktop see
// the phone one. Run: bun test.

import { expect, test } from "bun:test";
import { detectShell, pickShell, readShellEnv } from "../src/platform/app/shell";

test("a narrow viewport with a finger gets the phone shell", () => {
  expect(pickShell({ width: 393, height: 852, coarsePointer: true, override: null })).toBe("phone");
});

test("a narrow window with a mouse stays on the desktop shell", () => {
  expect(pickShell({ width: 393, height: 852, coarsePointer: false, override: null })).toBe("desktop");
});

test("a tablet is wide enough for the desktop shell despite the finger", () => {
  expect(pickShell({ width: 834, height: 1194, coarsePointer: true, override: null })).toBe("desktop");
});

// The shell is chosen once at mount, so a phone that launches in landscape must
// not get the reader for the rest of the session.
test("a phone in landscape is still a phone", () => {
  expect(pickShell({ width: 852, height: 393, coarsePointer: true, override: null })).toBe("phone");
});

test("a tablet in landscape is still a tablet", () => {
  expect(pickShell({ width: 1194, height: 834, coarsePointer: true, override: null })).toBe("desktop");
});

test("the boundary is Tailwind's sm breakpoint: 640 is already desktop", () => {
  expect(pickShell({ width: 639, height: 900, coarsePointer: true, override: null })).toBe("phone");
  expect(pickShell({ width: 640, height: 900, coarsePointer: true, override: null })).toBe("desktop");
});

test("?shell= overrides both measurements, in either direction", () => {
  expect(pickShell({ width: 1440, height: 900, coarsePointer: false, override: "phone" })).toBe("phone");
  expect(pickShell({ width: 393, height: 852, coarsePointer: true, override: "desktop" })).toBe("desktop");
});

test("an unknown ?shell= value is ignored rather than treated as phone", () => {
  expect(pickShell({ width: 1440, height: 900, coarsePointer: false, override: "tablet" })).toBe("desktop");
  expect(pickShell({ width: 393, height: 852, coarsePointer: true, override: "" })).toBe("phone");
});

// A window object with only the parts the reader touches.
function fakeWindow(opts: { width: number; height?: number; coarse?: boolean; search?: string }): Window {
  return {
    innerWidth: opts.width,
    innerHeight: opts.height ?? 852,
    location: { search: opts.search ?? "" },
    matchMedia: opts.coarse === undefined
      ? undefined
      : (q: string) => ({ matches: q === "(pointer: coarse)" ? !!opts.coarse : false }),
  } as unknown as Window;
}

test("the environment is read off the window, override included", () => {
  expect(readShellEnv(fakeWindow({ width: 393, height: 852, coarse: true, search: "?shell=desktop" }))).toEqual({
    width: 393,
    height: 852,
    coarsePointer: true,
    override: "desktop",
  });
});

test("a webview without matchMedia is treated as a fine pointer", () => {
  expect(detectShell(fakeWindow({ width: 393 }))).toBe("desktop");
  expect(detectShell(fakeWindow({ width: 393, search: "?shell=phone" }))).toBe("phone");
});
