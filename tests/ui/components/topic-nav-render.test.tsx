// The topic sidebar's rendered contract, pinned by a static render: three rows
// in order, labels only while it is open, and every row a 44px target either
// way. The expand/collapse decision itself is in topic-nav.test.ts.
// Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import TopicNav from "../../../src/ui/components/library/topic/TopicNav";

function render(open: boolean) {
  return renderToStaticMarkup(
    <TopicNav section="materials" onSelect={() => {}} open={open} onToggle={() => {}} />,
  );
}

test("open, the three sections read as text in order", () => {
  const html = render(true);
  expect(html.indexOf(">Materials<")).toBeGreaterThan(-1);
  expect(html.indexOf(">Talks<")).toBeGreaterThan(html.indexOf(">Materials<"));
  expect(html.indexOf(">AI observations<")).toBeGreaterThan(html.indexOf(">Talks<"));
});

// Collapsed it is an icon rail: the labels leave the flow, but the buttons keep
// their names for a screen reader and their tooltip for a mouse.
test("collapsed, the labels are gone but the names are not", () => {
  const html = render(false);
  expect(html).not.toContain(">Materials<");
  expect(html).toContain('aria-label="Materials"');
  expect(html).toContain('title="Talks"');
});

test("the open section is the current one", () => {
  expect(render(true)).toContain('aria-current="page"');
});

test("every row is a 44px touch target in both widths", () => {
  for (const open of [true, false]) {
    // One toggle plus three sections.
    expect(render(open).match(/h-11/g)?.length).toBe(4);
  }
});

test("the toggle says which way it goes", () => {
  expect(render(true)).toContain('aria-label="Collapse sidebar"');
  expect(render(false)).toContain('aria-label="Expand sidebar"');
});
