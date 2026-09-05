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

// The body of one exported component, from its declaration to the next one. A
// declaration is either a plain function or a forwardRef wrapping one.
const DECL = /^(?:function (\w+)\(|const (\w+) = React\.forwardRef<)/gm;

function component(name: string): string {
  const decls = [...source.matchAll(DECL)];
  const index = decls.findIndex((m) => (m[1] ?? m[2]) === name);
  expect(index).toBeGreaterThan(-1);
  return source.slice(decls[index].index, decls[index + 1]?.index);
}

test("the centred content clamps itself against the safe area", () => {
  expect(component("DialogContent")).toContain("OVERLAY_SAFE.centered");
});

test("every box here takes its layer from the scale, and spells none of its own", () => {
  // The generated file writes z-50 on all three. A page raised past that at the
  // call site is what put the Settings dropdowns behind the page that opened
  // them (docs/pitfall/103); the ordering is decided in ui/overlay.tsx now.
  //
  // The floating box and its backdrop each resolve their own rung: which one
  // they land on depends on the surface that opened them, and a backdrop left on
  // the dialog rung while its content is raised dims the wrong things
  // (docs/pitfall/211). The full-screen page is a surface, not a box on one, so
  // it still names its rung outright.
  expect(component("DialogOverlay")).toContain("useDialogLayer()");
  expect(component("DialogContent")).toContain("useDialogLayer()");
  expect(component("DialogFullScreenContent")).toContain("OVERLAY_Z.page");
  expect(source).not.toMatch(/(^|[^\w-])z-(\[|\d)/m);
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
