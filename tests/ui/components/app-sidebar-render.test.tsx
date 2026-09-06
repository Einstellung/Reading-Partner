// The shell sidebar's rendered contract, pinned by a static render: the
// wordmark, three items plus Settings, every row a 44px target, the labels only
// from `lg` up, and the alert dot on the affordance that leads to it. Which item is lit is decided in shell-nav.test.ts. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import AppSidebar from "../../../src/ui/components/common/AppSidebar";

function render(
  over: {
    active?: "today" | "briefing" | "topics" | "settings" | null;
    alert?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <AppSidebar
      active={"active" in over ? (over.active ?? null) : "today"}
      onSelect={() => {}}
      onOpenSettings={() => {}}
      settingsAlert={over.alert ?? false}
    />,
  );
}

test("the three items and Settings read as text, in order", () => {
  const html = render();
  expect(html.indexOf(">Today<")).toBeGreaterThan(-1);
  expect(html.indexOf(">Briefing<")).toBeGreaterThan(html.indexOf(">Today<"));
  expect(html.indexOf(">Topics<")).toBeGreaterThan(html.indexOf(">Briefing<"));
  expect(html.indexOf(">Settings<")).toBeGreaterThan(html.indexOf(">Topics<"));
});

// The labels leave the flow on the rail, so every row keeps its name for a
// screen reader and its tooltip for a mouse.
test("every row is named whether or not its label is showing", () => {
  const html = render();
  for (const name of ["Today", "Briefing", "Topics", "Settings"]) {
    expect(html).toContain(`aria-label="${name}"`);
    expect(html).toContain(`title="${name}"`);
  }
});

// The rows, by the box they all share; the wordmark above them is the same
// height and is not one of them.
test("every row is a 44px touch target", () => {
  expect(render().match(/h-11 w-11/g)?.length).toBe(4);
});

// The app's own icon, at the size the artwork is drawn for, and its name in the
// display face. The name leaves on the rail; the icon does not.
test("the wordmark is the app icon and the app's name", () => {
  const html = render();
  expect(html).toContain("app-icon");
  expect(html).toContain("Reading Partner");
  expect(html).toContain("h-7 w-7 flex-none rounded-[7px]");
});

// One item at a time, and none at all on a screen the sidebar does not name.
test("exactly one item is lit, or none", () => {
  expect(render({ active: "topics" }).match(/aria-current="page"/g)?.length).toBe(1);
  expect(render({ active: null })).not.toContain('aria-current="page"');
});

// Settings is a screen now (docs/51), so the row that opens it lights like the
// three above it.
test("the Settings row lights on its own screen", () => {
  expect(render({ active: "settings" }).match(/aria-current="page"/g)?.length).toBe(1);
});

test("the sync alert rides on Settings and says so in the name", () => {
  const html = render({ alert: true });
  expect(html).toContain("Settings — sync needs attention");
  expect(render({ alert: false })).not.toContain("sync needs attention");
});
