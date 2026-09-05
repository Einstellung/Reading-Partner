// The topic tab row's rendered contract, pinned by a static render: four tabs in
// order, each a 44px target, and the open one marked. The sections themselves are
// in topic-nav.test.ts. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import TopicNav from "../../../src/ui/components/library/topic/TopicNav";

const html = renderToStaticMarkup(<TopicNav section="materials" onSelect={() => {}} />);

test("the four sections read as text in order", () => {
  expect(html.indexOf(">Materials<")).toBeGreaterThan(-1);
  expect(html.indexOf(">Retell<")).toBeGreaterThan(html.indexOf(">Materials<"));
  expect(html.indexOf(">Rehearsal<")).toBeGreaterThan(html.indexOf(">Retell<"));
  expect(html.indexOf(">AI observations<")).toBeGreaterThan(html.indexOf(">Rehearsal<"));
});

test("the open section is the current one", () => {
  expect(html).toContain('aria-current="page"');
});

test("every tab is a 44px touch target", () => {
  expect(html.match(/h-11/g)?.length).toBe(4);
});

// The underline is the tab. Exactly one of them carries it.
test("only the open tab is underlined", () => {
  expect(html.match(/border-primary/g)?.length).toBe(1);
});
