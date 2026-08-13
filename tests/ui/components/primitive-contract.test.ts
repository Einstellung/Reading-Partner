// What the fifth pass's hand-edited primitives have to keep, read off the
// source. None of it survives a `bunx shadcn@latest add select` (or checkbox, or
// badge), and that overwrite reports itself as one line of "Updated"
// (docs/pitfall/81). ui/dialog.tsx has its own file, dialog-contract.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../../../src/ui/components/ui");

// Comments out: these files argue their own departures, so every string the
// assertions look for also appears in prose above the code that avoids it.
function read(name: string): string {
  return readFileSync(join(UI, name), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const select = read("select.tsx");
const checkbox = read("checkbox.tsx");
const badge = read("badge.tsx");
const tabs = read("tabs.tsx");
const dropdown = read("dropdown-menu.tsx");

test("nothing here imports lucide-react", () => {
  // The generated files draw their chevrons and ticks with it; this project
  // does not install it, so the import would break the build.
  for (const source of [select, checkbox, badge, tabs, dropdown]) {
    expect(source).not.toContain("lucide-react");
  }
});

test("the select list is a popper, clamped and padded against the safe area", () => {
  // Item-aligned is the generated default and publishes no
  // --radix-popper-available-*, so both halves of OVERLAY_SAFE.anchored would
  // silently do nothing (docs/30).
  expect(select).toContain('position="popper"');
  expect(select).toContain("OVERLAY_SAFE.anchored");
  expect(select).toContain("collisionPadding={useOverlaySafePadding()}");
});

test("the select list paints above the surface its trigger sits on", () => {
  // The generated z-50 sits under every full-screen page and floater this app
  // has, and an open list under an opaque page still answers elementFromPoint —
  // it reads as a dropdown that will not open (docs/pitfall/103).
  expect(select).toContain("OVERLAY_Z.anchored");
  expect(select).not.toMatch(/(^|[^\w-])z-(\[|\d)/m);
});

test("the select list registers an overlay layer, inside the content", () => {
  // Inside the content, not at the top of the component: what mounts and
  // unmounts with the list is the portalled subtree (docs/pitfall/80).
  // A declaration is either a plain function or a forwardRef wrapping one.
  const decls = [...select.matchAll(/^(?:function (\w+)\(|const (\w+) = React\.forwardRef<)/gm)];
  const index = decls.findIndex((m) => (m[1] ?? m[2]) === "SelectContent");
  expect(index).toBeGreaterThan(-1);
  expect(select.slice(decls[index].index, decls[index + 1]?.index)).toContain("<OverlayLayer />");
});

test("the select trigger and its rows keep the 44px minimum", () => {
  expect(select.match(/coarse:min-h-\[44px\]/g) ?? []).toHaveLength(2);
});

test("a menu row is a 44px touch target, in the primitive and nowhere else", () => {
  // The generated item is `px-2 py-1.5 text-sm`, a 32px row. The three menus in
  // this app each used to re-add the same geometry in their own file; it lives
  // in ITEM_BASE now, which is what Item and CheckboxItem both take, so both
  // shapes of row are covered by the one string.
  expect(dropdown).toMatch(/const ITEM_BASE =\s*\n?\s*"[^"]*coarse:min-h-\[44px\][^"]*"/);
  expect(dropdown).toContain("min-h-[36px]");
  expect(dropdown).not.toContain("py-1.5 text-sm outline-hidden");

  // And no call site carries it back. A row that re-declares the minimum is a
  // row that will drift from the other two.
  const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), "../../../src/ui/components");
  for (const file of ["library/CardMenu.tsx", "talk/OutlinePane.tsx", "reader/MoreMenu.tsx"]) {
    expect(readFileSync(join(COMPONENTS, file), "utf8")).not.toContain("coarse:min-h-[44px]");
  }
});

test("the checkbox carries its touch target as HIT_44", () => {
  // A 44px box beside a line of label text would be a different control, so the
  // box stays 16px and the target is a centred pseudo-element.
  expect(checkbox).toContain("HIT_44");
  expect(checkbox).toContain("relative size-4");
});

test("a tab trigger is a 44px touch target and hovers only where hover exists", () => {
  // The generated trigger is `h-[calc(100%-1px)]` inside an `h-9` list, which
  // is 36px and cannot grow. Hover behind can-hover: keeps a tap from leaving
  // one lit (docs/30).
  expect(tabs).toContain("coarse:min-h-[44px]");
  // Every hover: in the file has to be the tail of a can-hover: chain, so the
  // chains are struck out first and what is left is the bare ones.
  expect(tabs.split("can-hover:hover:").join("")).not.toContain("hover:");
});

test("the tabs carry no dark-theme rules and no orientation styling", () => {
  // This app has no dark theme, and the visual orientation of the strip is a
  // breakpoint at the call site, not Radix's data-orientation (docs/30).
  expect(tabs).not.toContain("dark:");
  expect(tabs).not.toContain("data-[orientation=");
});

test("the badge is an inline box with this app's two pills", () => {
  // shadcn's own is inline-flex with six variants; that would move every pill
  // on a line that is not a flex row.
  expect(badge).not.toContain("inline-flex");
  expect(badge).toContain("source:");
  expect(badge).toContain("aside:");
});
