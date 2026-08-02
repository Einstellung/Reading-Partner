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

test("nothing here imports lucide-react", () => {
  // The generated files draw their chevrons and ticks with it; this project
  // does not install it, so the import would break the build.
  for (const source of [select, checkbox, badge]) {
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

test("the select list registers an overlay layer, inside the content", () => {
  // Inside the content, not at the top of the component: what mounts and
  // unmounts with the list is the portalled subtree (docs/pitfall/80).
  const start = select.indexOf("function SelectContent(");
  const end = select.indexOf("\nfunction ", start + 1);
  expect(select.slice(start, end)).toContain("<OverlayLayer />");
});

test("the select trigger and its rows keep the 44px minimum", () => {
  expect(select.match(/coarse:min-h-\[44px\]/g) ?? []).toHaveLength(2);
});

test("the checkbox carries its touch target as HIT_44", () => {
  // A 44px box beside a line of label text would be a different control, so the
  // box stays 16px and the target is a centred pseudo-element.
  expect(checkbox).toContain("HIT_44");
  expect(checkbox).toContain("relative size-4");
});

test("the badge is an inline box with this app's two pills", () => {
  // shadcn's own is inline-flex with six variants; that would move every pill
  // on a line that is not a flex row.
  expect(badge).not.toContain("inline-flex");
  expect(badge).toContain("source:");
  expect(badge).toContain("aside:");
});
