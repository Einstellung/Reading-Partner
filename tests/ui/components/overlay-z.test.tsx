// The paint order of the app's overlays (src/ui/components/ui/overlay.tsx).
//
// The bug this is here for: Settings raised its own page to z-[70] while the
// Select list it hosts stayed at the generated z-50, so every dropdown on that
// page opened underneath an opaque white page. It was open, correctly placed
// and hit-testable the whole time — elementFromPoint over the list returned a
// row — which is why it was reported as a dead control (docs/pitfall/103).
//
// What these assertions prove: the full-screen page really renders with the
// layer OVERLAY_Z names, and the anchored layer the Select and DropdownMenu
// contents take outranks it and everything else on the scale. Both sides are
// read from the one map the components import, so a layer that moves moves here
// too.
//
// What they do not prove: that the browser paints it that way. There is no DOM
// and no stylesheet in this runner, so nothing here resolves a Tailwind class to
// a computed z-index, and nothing here can see the other half of the mechanism —
// Radix copies the content's computed z-index onto the popper wrapper it
// positions, and only a real engine does that. The device check is in
// docs/pitfall/103.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { Dialog, DialogFullScreenContent } from "../../../src/ui/components/ui/dialog";
import {
  OVERLAY_Z,
  overlayZIndex,
  type OverlayLayerName,
} from "../../../src/ui/components/ui/overlay";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");

const LAYERS = Object.keys(OVERLAY_Z) as OverlayLayerName[];

test("an anchored overlay outranks every surface a trigger can sit on", () => {
  // The invariant. A Select or a DropdownMenu is portalled to <body> and shares
  // one z axis with whatever opened it, so the only layer that always works is
  // one above the whole scale.
  for (const layer of LAYERS) {
    if (layer === "anchored") continue;
    expect(overlayZIndex("anchored")).toBeGreaterThan(overlayZIndex(layer));
  }
});

test("the full-screen page renders on the layer OVERLAY_Z names for it", () => {
  const markup = renderToStaticMarkup(
    <Dialog open>
      <DialogFullScreenContent aria-describedby={undefined}>Settings</DialogFullScreenContent>
    </Dialog>,
  );
  const className = /<div[^>]*\bdata-slot="dialog-full-screen-content"[^>]*/
    .exec(markup)?.[0]
    .match(/\sclass="([^"]+)"/)?.[1];
  expect(className).toBeTruthy();
  expect(className!.split(/\s+/)).toContain(OVERLAY_Z.page);
  // And it is the only z on the box: a second one at equal specificity would be
  // settled by the order Tailwind emits them in.
  expect(className!.split(/\s+/).filter((c) => /^z-/.test(c))).toHaveLength(1);
});

test("every generated overlay takes its layer from the scale", () => {
  // Read off the source: these contents are portalled, and Radix's portal
  // renders nothing on a server pass. One `shadcn add` puts the generated z back
  // on any of them (docs/pitfall/81), which is what the assertion is for.
  const expected: Record<string, string> = {
    "select.tsx": "OVERLAY_Z.anchored",
    "dropdown-menu.tsx": "OVERLAY_Z.anchored",
    "alert-dialog.tsx": "OVERLAY_Z.dialog",
    "toast.tsx": "OVERLAY_Z.toast",
  };
  for (const [file, layer] of Object.entries(expected)) {
    // Comments out: these files argue their own departures in prose.
    const source = readFileSync(join(SRC, "ui/components/ui", file), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(source).toContain(layer);
    expect(source).not.toMatch(/(^|[^\w-])z-(\[|\d)/m);
  }
});

test("no overlay invents a layer beside the scale", () => {
  // How the bug got in: a call site wrote z-[70] next to a set of overlays at
  // z-50. An arbitrary z-index anywhere but the scale itself is that move.
  const files = new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: SRC, absolute: true });
  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith(join("ui", "components", "ui", "overlay.tsx"))) continue;
    if (/(^|[^\w-])z-\[/m.test(readFileSync(file, "utf8"))) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
