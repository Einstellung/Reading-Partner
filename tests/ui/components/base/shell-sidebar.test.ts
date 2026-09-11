// The shell sidebar's widths, the rules that ride on them, and the stored
// choice (docs/51). The rendering is checked in app-sidebar-render.test.tsx.
// Run: bun test.

import { expect, test } from "bun:test";
import type { PrefStore } from "../../../../src/ui/components/base/pref-store";
import {
  LABELLED_WIDTH_PX,
  RAIL_WIDTH_PX,
  SIDEBAR_COLLAPSED_KEY,
  collapseToggleTitle,
  readSidebarCollapsed,
  showsCollapseToggle,
  showsLabels,
  sidebarLabelClass,
  sidebarNameClass,
  sidebarNavClass,
  sidebarRowClass,
  sidebarToggleClass,
  sidebarWidthPx,
  sidebarWordmarkClass,
  writeSidebarCollapsed,
} from "../../../../src/ui/components/base/shell-sidebar";

function fakeStore(initial: Record<string, string> = {}): PrefStore & {
  slots: Record<string, string>;
} {
  const slots = { ...initial };
  return {
    slots,
    getItem: (key) => slots[key] ?? null,
    setItem: (key, value) => {
      slots[key] = value;
    },
  };
}

// Three of the four combinations are the rail: the reader only gets a say where
// there is width to give away.
test("only an uncollapsed lg gets the labelled column", () => {
  expect(sidebarWidthPx(true, false)).toBe(LABELLED_WIDTH_PX);
  expect(sidebarWidthPx(true, true)).toBe(RAIL_WIDTH_PX);
  expect(sidebarWidthPx(false, false)).toBe(RAIL_WIDTH_PX);
  expect(sidebarWidthPx(false, true)).toBe(RAIL_WIDTH_PX);
});

test("the labels ride with the width", () => {
  expect(showsLabels(true, false)).toBe(true);
  expect(showsLabels(true, true)).toBe(false);
  expect(showsLabels(false, false)).toBe(false);
});

// Below the breakpoint the toggle would be a button that changes nothing.
test("the toggle is offered only where the choice exists", () => {
  expect(showsCollapseToggle(true)).toBe(true);
  expect(showsCollapseToggle(false)).toBe(false);
});

test("the toggle is named for what it does next", () => {
  expect(collapseToggleTitle(false)).toBe("Collapse sidebar");
  expect(collapseToggleTitle(true)).toBe("Expand sidebar");
});

// CSS carries the `atLg` half of the width rule, so the class strings have to
// say the same thing the rule above does: collapsed carries no `lg:` variant at
// all, and uncollapsed is the rail plus what `lg:` adds back.
test("the class strings encode the same rule the widths do", () => {
  for (const cls of [
    sidebarNavClass(true),
    sidebarRowClass(true),
    sidebarLabelClass(true),
    sidebarNameClass(true),
    sidebarWordmarkClass(true),
  ]) {
    expect(cls).not.toContain("lg:");
  }
  expect(sidebarNavClass(false)).toContain("w-[3.25rem]");
  expect(sidebarNavClass(false)).toContain("lg:w-56");
  expect(sidebarLabelClass(false)).toContain("lg:inline");
  expect(sidebarNameClass(false)).toContain("lg:inline");
  expect(sidebarLabelClass(true)).toBe("hidden");
  expect(sidebarNameClass(true)).toBe("hidden");
});

// The one class the toggle needs in both shapes: it is hidden below `lg`, and
// by a variant rather than by a display utility the button's own base class
// would then be free to override.
test("the toggle keeps its 44px box and leaves below lg", () => {
  for (const collapsed of [true, false]) {
    expect(sidebarToggleClass(collapsed)).toContain("h-11 w-11");
    expect(sidebarToggleClass(collapsed)).toContain("max-lg:hidden");
  }
  expect(sidebarToggleClass(false)).toContain("ml-auto");
  expect(sidebarToggleClass(true)).not.toContain("ml-auto");
});

test("the choice round-trips through one slot", () => {
  const store = fakeStore();
  expect(readSidebarCollapsed(store)).toBe(false);
  writeSidebarCollapsed(store, true);
  expect(store.slots[SIDEBAR_COLLAPSED_KEY]).toBe("1");
  expect(readSidebarCollapsed(store)).toBe(true);
  writeSidebarCollapsed(store, false);
  expect(readSidebarCollapsed(store)).toBe(false);
});

// Anything but the marker is the labelled column: it is the shape the shell was
// drawn against, so an unreadable slot must not move the app off it.
test("a missing, junk or broken storage reads as expanded", () => {
  expect(readSidebarCollapsed(null)).toBe(false);
  expect(readSidebarCollapsed(fakeStore({ [SIDEBAR_COLLAPSED_KEY]: "yes" }))).toBe(false);
  const throwing: PrefStore = {
    getItem() {
      throw new Error("no storage");
    },
    setItem() {
      throw new Error("no storage");
    },
  };
  expect(readSidebarCollapsed(throwing)).toBe(false);
  expect(() => writeSidebarCollapsed(throwing, true)).not.toThrow();
});
