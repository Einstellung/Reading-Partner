// The shell sidebar's rendered contract, pinned by a static render: three items
// plus Settings, every row a 44px target, the labels only from `lg` up, and the
// alert dot on the affordance that leads to it. Which item is lit is decided in
// shell-nav.test.ts. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import AppSidebar from "../../../src/ui/components/common/AppSidebar";

function render(over: { active?: "today" | "briefing" | "topics" | null; alert?: boolean } = {}) {
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

test("every row is a 44px touch target", () => {
  expect(render().match(/h-11/g)?.length).toBe(4);
});

// One item at a time, and none at all on a screen the sidebar does not name.
test("exactly one item is lit, or none", () => {
  expect(render({ active: "topics" }).match(/aria-current="page"/g)?.length).toBe(1);
  expect(render({ active: null })).not.toContain('aria-current="page"');
});

test("the sync alert rides on Settings and says so in the name", () => {
  const html = render({ alert: true });
  expect(html).toContain("Settings — sync needs attention");
  expect(render({ alert: false })).not.toContain("sync needs attention");
});
