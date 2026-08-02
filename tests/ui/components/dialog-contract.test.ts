// What ui/dialog.tsx has to keep, read off the source. None of it is visible to
// a render test — the layer registration only shows up as an effect, and the
// two absences (a second max-width, a portal around the full-screen page) show
// up as nothing at all — and all of it is one `bunx shadcn@latest add dialog`
// away from being silently overwritten (docs/pitfall/81).
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/ui/components/ui/dialog.tsx",
);
// Comments out: this file argues its own departures, so every string the
// assertions look for also appears in prose above the code that avoids it.
const source = readFileSync(SRC, "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

// The body of one exported component, from its declaration to the next one.
function component(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("the centred content clamps itself against the safe area", () => {
  expect(component("DialogContent")).toContain("OVERLAY_SAFE.centered");
});

test("max-width belongs to the safe-area utility alone", () => {
  // A second max-width at the same specificity is settled by the order Tailwind
  // emits the two in, which is not a decision anyone made (docs/30).
  expect(source).not.toMatch(/\bsm:max-w-|\bmax-w-\[/);
});

test("both contents register an overlay layer, inside the content", () => {
  // Inside the content, not at the top of the component: the component stays on
  // the React tree, and what mounts and unmounts with the dialog is the subtree
  // (docs/pitfall/80).
  for (const name of ["DialogContent", "DialogFullScreenContent"]) {
    expect(component(name)).toContain("<OverlayLayer />");
  }
});

test("the full-screen content is neither portalled nor backed by an overlay", () => {
  // Portalling it would take it out of the phone shell's sliding surface, and
  // the overlay is where Radix keeps the scroll lock a full-screen page has
  // nothing to use it on (docs/30).
  const full = component("DialogFullScreenContent");
  expect(full).not.toContain("DialogPortal");
  expect(full).not.toContain("DialogOverlay");
  expect(full).toContain("fixed inset-0");
});

test("nothing here imports lucide-react", () => {
  // The generated corner close button is the only thing that wanted it, and the
  // project does not install it: the import would break the build.
  expect(source).not.toContain("lucide-react");
});
