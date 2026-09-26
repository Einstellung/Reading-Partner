import { expect, test } from "bun:test";
import {
  COLUMN_MEDIA_QUERY,
  COLUMN_MIN_WIDTH_PX,
  SIDEBAR_OPEN_KEY,
  browserPrefStore,
  closesOnNavigate,
  columnLayoutNow,
  readSidebarOpen,
  writeSidebarOpen,
  type PrefStore,
} from "./sidebar-column";

function store(initial?: Record<string, string>): PrefStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

test("a stored open column comes back open", () => {
  expect(readSidebarOpen(store({ [SIDEBAR_OPEN_KEY]: "1" }), true)).toBe(true);
  expect(readSidebarOpen(store({ [SIDEBAR_OPEN_KEY]: "0" }), true)).toBe(false);
  expect(readSidebarOpen(store(), true)).toBe(false);
});

// The drawer covers the book. Whatever a wide screen last decided, a narrow one
// opens on the page.
test("a narrow window never restores an open panel", () => {
  expect(readSidebarOpen(store({ [SIDEBAR_OPEN_KEY]: "1" }), false)).toBe(false);
});

test("anything but the on marker reads as shut", () => {
  for (const v of ["", "true", "yes", "01", " 1"]) {
    expect([v, readSidebarOpen(store({ [SIDEBAR_OPEN_KEY]: v }), true)]).toEqual([v, false]);
  }
});

test("a storage that throws is a storage that is not there", () => {
  const hostile: PrefStore = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  expect(readSidebarOpen(hostile, true)).toBe(false);
  expect(() => writeSidebarOpen(hostile, true)).not.toThrow();
  expect(readSidebarOpen(null, true)).toBe(false);
  expect(() => writeSidebarOpen(null, true)).not.toThrow();
});

test("what was written is what comes back", () => {
  const s = store();
  writeSidebarOpen(s, true);
  expect(readSidebarOpen(s, true)).toBe(true);
  writeSidebarOpen(s, false);
  expect(readSidebarOpen(s, true)).toBe(false);
});

// The drawer's backdrop eats the scroll, so a jump has to close it; the column
// takes nothing from the reader, so a jump leaves the list where it was.
test("only the drawer closes when the reader follows an outline entry", () => {
  expect(closesOnNavigate(false)).toBe(true);
  expect(closesOnNavigate(true)).toBe(false);
});

test("the media query is the breakpoint the class names encode", () => {
  expect(COLUMN_MEDIA_QUERY).toBe(`(min-width: ${COLUMN_MIN_WIDTH_PX}px)`);
  expect(COLUMN_MIN_WIDTH_PX).toBe(1024);
});

test("a window with no matchMedia gets the drawer", () => {
  expect(columnLayoutNow(null)).toBe(false);
  expect(columnLayoutNow({} as Window)).toBe(false);
  const wide = { matchMedia: (q: string) => ({ matches: q === COLUMN_MEDIA_QUERY }) };
  expect(columnLayoutNow(wide as unknown as Window)).toBe(true);
});

test("a window that refuses storage yields no store rather than throwing", () => {
  const win = {
    get localStorage(): PrefStore {
      throw new Error("blocked");
    },
  };
  expect(browserPrefStore(win as unknown as Window)).toBeNull();
});
