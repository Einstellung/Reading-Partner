// The paper tint's storage and the attribute it puts on <html>
// (src/ui/components/base/paper-tint.ts). What has to hold is the contract the
// reader's own page tinting is written against — one attribute, one value,
// absent when off — and that a storage which is missing, unreadable or full
// leaves the app on its default palette rather than half-tinted.
//
// Plain objects stand in for localStorage and for <html>, so no window is
// needed. Run: bun test.

import { expect, test } from "bun:test";
import {
  applyPaperTint,
  browserTintStore,
  initPaperTint,
  PAPER_TINT,
  PAPER_TINT_KEY,
  readPaperTint,
  TINT_ATTRIBUTE,
  writePaperTint,
  type TintRoot,
  type TintStore,
} from "../../../src/ui/components/base/paper-tint";

function memoryStore(initial: Record<string, string> = {}): TintStore & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

// Records the calls rather than the state, so a `setAttribute(name, "")` cannot
// pass as a removal.
function fakeRoot(): TintRoot & { calls: string[]; attribute: string | null } {
  const root = {
    calls: [] as string[],
    attribute: null as string | null,
    setAttribute(name: string, value: string) {
      root.calls.push(`set ${name}=${value}`);
      root.attribute = value;
    },
    removeAttribute(name: string) {
      root.calls.push(`remove ${name}`);
      root.attribute = null;
    },
  };
  return root;
}

test("only the on marker reads as on", () => {
  expect(readPaperTint(memoryStore({ [PAPER_TINT_KEY]: "1" }))).toBe(true);
  expect(readPaperTint(memoryStore({ [PAPER_TINT_KEY]: "0" }))).toBe(false);
  expect(readPaperTint(memoryStore())).toBe(false);
  // A hand-edited value must not move the whole app off its default palette.
  expect(readPaperTint(memoryStore({ [PAPER_TINT_KEY]: "true" }))).toBe(false);
  expect(readPaperTint(memoryStore({ [PAPER_TINT_KEY]: "" }))).toBe(false);
});

test("a storage that is absent or throws is off, not an error", () => {
  expect(readPaperTint(null)).toBe(false);
  const throwing: TintStore = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  expect(readPaperTint(throwing)).toBe(false);
  expect(() => writePaperTint(throwing, true)).not.toThrow();
  expect(() => writePaperTint(null, true)).not.toThrow();
});

test("both states are written, so turning the tint off survives a relaunch", () => {
  const store = memoryStore();
  writePaperTint(store, true);
  expect(readPaperTint(store)).toBe(true);
  writePaperTint(store, false);
  expect(store.values[PAPER_TINT_KEY]).toBe("0");
  expect(readPaperTint(store)).toBe(false);
});

test("off removes the attribute rather than setting a second value", () => {
  const root = fakeRoot();
  applyPaperTint(root, true);
  expect(root.attribute).toBe(PAPER_TINT);
  applyPaperTint(root, false);
  expect(root.attribute).toBe(null);
  expect(root.calls).toEqual([`set ${TINT_ATTRIBUTE}=${PAPER_TINT}`, `remove ${TINT_ATTRIBUTE}`]);
});

test("startup reads the store and paints the root in one call", () => {
  const root = fakeRoot();
  const win = {
    localStorage: memoryStore({ [PAPER_TINT_KEY]: "1" }),
    document: { documentElement: root },
  } as unknown as Window;
  expect(initPaperTint(win)).toBe(true);
  expect(root.attribute).toBe(PAPER_TINT);
});

test("startup on an untinted machine leaves the root untouched but for the removal", () => {
  const root = fakeRoot();
  const win = {
    localStorage: memoryStore(),
    document: { documentElement: root },
  } as unknown as Window;
  expect(initPaperTint(win)).toBe(false);
  expect(root.attribute).toBe(null);
});

test("a webview that refuses localStorage still boots", () => {
  const root = fakeRoot();
  const win = {
    get localStorage(): Storage {
      throw new Error("access denied");
    },
    document: { documentElement: root },
  } as unknown as Window;
  expect(browserTintStore(win)).toBe(null);
  expect(initPaperTint(win)).toBe(false);
  expect(root.attribute).toBe(null);
});
