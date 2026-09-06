// The shell sidebar's two shapes and the choice between them (docs/51). The
// rendering is AppSidebar.tsx; the widths, the rules for what each shape shows,
// and where the choice is kept are here, where a test can read them.
//
// Two inputs. `atLg` is the width — below 1024px the column is always the icon
// rail, because 224px of labels costs the shelf a card on a portrait iPad — and
// `collapsed` is the reader's own choice, which only has a say from `lg` up.
// CSS carries the first input (the `lg:` variants in the class strings below)
// and React carries the second, so a rotation moves the sidebar with no
// JavaScript and no frame of the wrong width.

import type { PrefStore } from "./pref-store";

export const RAIL_WIDTH_PX = 52;
// 224 and not 192: the wordmark row now ends in the 44px collapse toggle, and
// the app's own name — 107px of Georgia at 15px — no longer fits beside it in
// 192. The name being cut to "Reading Par…" is what the width has always been
// chosen to avoid (docs/51), and the reader who does not want the 224 can now
// take the rail instead.
export const LABELLED_WIDTH_PX = 224;

// The width rule, stated once. The class strings below encode the same thing in
// Tailwind's terms; the test holds the two together.
export function sidebarWidthPx(atLg: boolean, collapsed: boolean): number {
  return atLg && !collapsed ? LABELLED_WIDTH_PX : RAIL_WIDTH_PX;
}

// Labels ride with the width: a rail has no room for them, and the name a rail
// cannot show stays available as the button's title and aria-label.
export function showsLabels(atLg: boolean, collapsed: boolean): boolean {
  return sidebarWidthPx(atLg, collapsed) === LABELLED_WIDTH_PX;
}

// Below `lg` there is nothing to choose: the sidebar is the rail either way, so
// a toggle there would be a button that changes nothing.
export function showsCollapseToggle(atLg: boolean): boolean {
  return atLg;
}

// What the toggle does next, not what it is looking at.
export function collapseToggleTitle(collapsed: boolean): string {
  return collapsed ? "Expand sidebar" : "Collapse sidebar";
}

// localStorage, like the reader panel's open state and the paper tint: a
// per-device layout choice — one account's wide desk and narrow laptop want
// different answers — read synchronously, so the first frame is already the
// sidebar the reader left and nothing flashes wide and then narrows.
export const SIDEBAR_COLLAPSED_KEY = "shell.sidebarCollapsed";

// Expanded unless the slot holds exactly the marker: the labelled column is the
// shape every screen of the shell was drawn against, and an unreadable or
// hand-edited value must not quietly move the app off it.
export function readSidebarCollapsed(store: PrefStore | null): boolean {
  try {
    return store?.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    // A storage that throws on read is a storage that is not there.
    return false;
  }
}

export function writeSidebarCollapsed(store: PrefStore | null, collapsed: boolean): void {
  try {
    store?.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Full or disabled storage: the choice still holds for this session.
  }
}

// The class strings. Each is the rail's, plus what `lg:` adds back when the
// reader has not collapsed it — so `collapsed` drops every `lg:` variant and
// the rail becomes the shape at every width.

// Plain padding, not the `-safe-*` utilities: the shell already wears `p-safe`
// (App.tsx), and a rail whose gutters grow with the inset stops holding its
// 44px button. 52px is that button plus the two 4px gutters.
const NAV_RAIL =
  "flex w-[3.25rem] flex-none flex-col items-center gap-0.5 overflow-y-auto " +
  "border-r border-border bg-muted-faint px-1 py-4";

export function sidebarNavClass(collapsed: boolean): string {
  return collapsed ? NAV_RAIL : `${NAV_RAIL} lg:w-56 lg:items-stretch lg:px-2`;
}

// One row, in both widths. h-11 is the 44px touch target either way; the rail is
// 44 wide and grows to the full column when the labels join it.
const ROW_RAIL = "h-11 w-11 flex-none justify-center rounded-md px-0 text-muted-foreground";

export function sidebarRowClass(collapsed: boolean): string {
  return collapsed ? ROW_RAIL : `${ROW_RAIL} lg:w-full lg:justify-start lg:gap-2.5 lg:px-3`;
}

export function sidebarLabelClass(collapsed: boolean): string {
  return collapsed ? "hidden" : "hidden truncate text-[14px] font-medium lg:inline";
}

// The app's icon and name. On the rail the name goes and the icon stands alone,
// centred over the column of icons under it — the same 44px box as a row, so
// the three destinations start where they do in the wide shape.
export function sidebarWordmarkClass(collapsed: boolean): string {
  const rail = "mb-2 flex h-11 flex-none items-center justify-center";
  // No right padding, and the space beside the icon is the name's own margin
  // rather than a row gap: the toggle ends the row and brings its own 12px of
  // button padding, and a gap in front of it would take those 10px out of the
  // 116 the name has to fit its 107.
  return collapsed ? rail : `${rail} lg:justify-start lg:pl-2.5`;
}

export function sidebarNameClass(collapsed: boolean): string {
  return collapsed
    ? "hidden"
    : "hidden truncate font-display text-[15px] font-semibold text-foreground lg:ml-2.5 lg:inline";
}

// The toggle: the last thing in the wordmark row when the column is labelled,
// the first thing under the app icon when it is a rail. `max-lg:hidden` and not
// a `lg:` variant of a display utility, because the button's own base class
// already sets one and the later of two display rules would win by accident.
export function sidebarToggleClass(collapsed: boolean): string {
  return collapsed ? `${ROW_RAIL} max-lg:hidden` : `${ROW_RAIL} ml-auto max-lg:hidden`;
}
