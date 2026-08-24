// Every primitive in src/ui/components/ui that renders a DOM node has to be a
// forwardRef. shadcn now generates React 19 components, where `ref` is an
// ordinary prop; this project is on React 18, where a plain function component
// drops the ref, tsc stays green (ComponentProps<"button"> declares ref) and a
// production build prints nothing (docs/pitfall/95). One `bunx shadcn@latest
// add button` puts it back.
//
// The test environment renders statically (react-dom/server), which never
// attaches a ref, so what is asserted here is the two things that make a ref
// land: the component is a forwardRef, and it hands the ref on. Whether the node
// it lands on is the right one is measured in a build (docs/30).
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { useDom } from "../../support/dom";

// The primitives come in dynamically, after the window is up. Eleven of the
// sixteen wrap a Radix package that reaches for a portal, and that pulls in
// react-dom's client bundle, which decides at module evaluation whether it is
// in a browser and never reconsiders (docs/pitfall/121). Static imports are
// evaluated before any top-level await in the file, so importing them the
// ordinary way evaluates react-dom before this file — or any file — has
// called useDom(), and every useDom() in the run then throws. It is harmless
// only for as long as this file happens to run late (docs/pitfall/175).
//
// Nothing below needs a DOM. The window is here so that react-dom's feature
// detection lands where it would have landed if this file had never run.
await useDom();

const { Slot } = await import("@radix-ui/react-slot");

const alertDialog = await import("../../../src/ui/components/ui/alert-dialog");
const badge = await import("../../../src/ui/components/ui/badge");
const button = await import("../../../src/ui/components/ui/button");
const checkbox = await import("../../../src/ui/components/ui/checkbox");
const collapsible = await import("../../../src/ui/components/ui/collapsible");
const dialog = await import("../../../src/ui/components/ui/dialog");
const dropdownMenu = await import("../../../src/ui/components/ui/dropdown-menu");
const input = await import("../../../src/ui/components/ui/input");
const label = await import("../../../src/ui/components/ui/label");
const overlay = await import("../../../src/ui/components/ui/overlay");
const select = await import("../../../src/ui/components/ui/select");
const separator = await import("../../../src/ui/components/ui/separator");
const switchModule = await import("../../../src/ui/components/ui/switch");
const tabs = await import("../../../src/ui/components/ui/tabs");
const textarea = await import("../../../src/ui/components/ui/textarea");
const toast = await import("../../../src/ui/components/ui/toast");

const UI = join(dirname(fileURLToPath(import.meta.url)), "../../../src/ui/components/ui");
const FORWARD_REF = Symbol.for("react.forward_ref");

const MODULES: Record<string, Record<string, unknown>> = {
  "alert-dialog.tsx": alertDialog,
  "badge.tsx": badge,
  "button.tsx": button,
  "checkbox.tsx": checkbox,
  "collapsible.tsx": collapsible,
  "dialog.tsx": dialog,
  "dropdown-menu.tsx": dropdownMenu,
  "input.tsx": input,
  "label.tsx": label,
  "overlay.tsx": overlay,
  "select.tsx": select,
  "separator.tsx": separator,
  "switch.tsx": switchModule,
  "tabs.tsx": tabs,
  "textarea.tsx": textarea,
  "toast.tsx": toast,
};

// The exports that render nothing of their own, so there is no node for a ref to
// reach: Radix roots (context and state only), portals, and the layer counter.
// Anything else that is a component and not a forwardRef is the bug.
const NO_DOM = new Set([
  "AlertDialog",
  "AlertDialogPortal",
  "Dialog",
  "DialogPortal",
  "DropdownMenu",
  "DropdownMenuPortal",
  "OverlayLayer",
  "Select",
  "ToastProvider",
]);

// A component by convention: capitalised, and either a function or an element
// type object (forwardRef, memo). Leaves out the cva tables and the hooks.
function components(module: Record<string, unknown>): [string, unknown][] {
  return Object.entries(module).filter(
    ([name, value]) =>
      /^[A-Z]/.test(name) &&
      (typeof value === "function" ||
        (typeof value === "object" && value !== null && "$$typeof" in value)),
  );
}

function isForwardRef(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $$typeof?: symbol }).$$typeof === FORWARD_REF
  );
}

test("every file in ui/ is covered here", () => {
  // A new primitive has to be added to MODULES, or it goes unguarded.
  const files = readdirSync(UI).filter((f) => f.endsWith(".tsx"));
  expect(files.sort()).toEqual(Object.keys(MODULES).sort());
});

test("every primitive that renders a node is a forwardRef", () => {
  const plain: string[] = [];
  for (const module of Object.values(MODULES)) {
    for (const [name, value] of components(module)) {
      if (NO_DOM.has(name) || isForwardRef(value)) continue;
      plain.push(name);
    }
  }
  expect(plain).toEqual([]);
});

test("every forwardRef hands its ref on", () => {
  // A forwardRef that never writes ref={ref} swallows it just as quietly as a
  // plain function does.
  for (const file of Object.keys(MODULES)) {
    const source = readFileSync(join(UI, file), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    const wrappers = (source.match(/React\.forwardRef</g) ?? []).length;
    const handovers = (source.match(/\bref=\{ref\}/g) ?? []).length;
    expect(`${file}: ${wrappers} forwardRef, ${handovers} passed on`).toBe(
      `${file}: ${wrappers} forwardRef, ${wrappers} passed on`,
    );
  }
});

// The render function of a forwardRef, called the way React calls it. No DOM is
// needed: what comes back is the element, and React 18 keeps a host element's
// ref beside its props rather than in them.
function renderWithRef(component: unknown, props: Record<string, unknown>, ref: unknown) {
  expect(isForwardRef(component)).toBe(true);
  return (component as { render: (p: unknown, r: unknown) => { type: unknown; ref: unknown } })
    .render(props, ref);
}

test("Button puts the ref on the button it renders", () => {
  const ref = { current: null };
  const element = renderWithRef(button.Button, {}, ref);
  expect(element.type).toBe("button");
  expect(element.ref).toBe(ref);
});

test("Button under asChild puts the ref on the Slot, which merges it into the child", () => {
  // Slot is a forwardRef itself and composes the ref it is given with whatever
  // ref the replaced child already carries, so the node the caller gets is the
  // child's own (docs/30).
  const ref = { current: null };
  const element = renderWithRef(button.Button, { asChild: true }, ref);
  expect(element.type).toBe(Slot);
  expect(element.ref).toBe(ref);
  expect(isForwardRef(Slot)).toBe(true);
});
