// The trace list's row contract, pinned by a static render: the star toggle is
// gone, every row carries a delete affordance, and only an AI-pen mark shows the
// thread shortcut. The gesture that reveals the Delete is covered in
// swipe-action.test.ts. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import TraceList from "../../../src/ui/components/reader/TraceList";
import type { Annotation } from "../../../src/ui/components/reader/types";

const MARKS: Annotation[] = [
  { id: "a", type: "highlight", color: "#ffd400", text: "first", sortIndex: "00001|000|00010", pageLabel: "1" },
  {
    id: "b",
    type: "underline",
    color: "#5fb236",
    text: "second",
    sortIndex: "00002|000|00010",
    pageLabel: "2",
    aiThreadId: "t-1",
  },
];

function render(props: Partial<Parameters<typeof TraceList>[0]> = {}) {
  return renderToStaticMarkup(
    <TraceList
      annotations={MARKS}
      hasThread={() => true}
      onSelect={() => {}}
      onDelete={() => {}}
      {...props}
    />,
  );
}

test("no row carries a star any more", () => {
  const html = render().toLowerCase();
  expect(html).not.toContain('aria-label="star"');
  expect(html).not.toContain('aria-label="unstar"');
  expect(html).not.toContain("aria-pressed"); // the star was the row's only toggle
});

test("every row carries a delete affordance, shut", () => {
  const html = render();
  expect(html.split('aria-label="Delete mark"').length - 1).toBe(MARKS.length);
  expect(html.split('aria-expanded="false"').length - 1).toBe(MARKS.length);
});

test("the delete action itself is not rendered until the row is opened", () => {
  // The red Delete lives under the row and is only mounted once the swipe (or
  // the pointer-device reveal) has uncovered it, so a shut row has nothing
  // pressable behind it.
  expect(render()).not.toContain(">Delete<");
});

test("the AI thread shortcut shows only on a mark that owns a thread", () => {
  const html = render();
  expect(html.split('aria-label="Open AI thread"').length - 1).toBe(1);
});

// A mark outlives the conversation it opened (docs/09): deleting the talk leaves
// the mark on the book. The id on it is then a door to nothing, and a button
// that cannot be answered is worse than no button.
test("the shortcut goes when the conversation it points at is no longer here", () => {
  expect(render({ hasThread: () => false })).not.toContain('aria-label="Open AI thread"');
});

test("rows come out in document order, whatever order they arrive in", () => {
  const html = render({ annotations: [MARKS[1], MARKS[0]] });
  expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
});

// The two groups (docs/09). A mark drawn on a reply has no page and no
// document-order key, and the list used to sort on that key alone, which put
// every classroom mark above every page mark.
const ON_A_REPLY: Annotation = {
  id: "c",
  type: "underline",
  color: "#a28ae5",
  text: "on a reply",
  chatAnchor: { threadId: "lesson", messageTs: 1000, text: "on a reply", occurrence: 0, pen: "underline" },
};

test("classroom marks sit under their own heading, below the page group", () => {
  const html = render({ annotations: [ON_A_REPLY, ...MARKS] });
  expect(html.indexOf("On the page")).toBeLessThan(html.indexOf("first"));
  expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  expect(html.indexOf("second")).toBeLessThan(html.indexOf("In the classroom"));
  expect(html.indexOf("In the classroom")).toBeLessThan(html.indexOf("on a reply"));
});

test("a group with nothing in it carries no heading", () => {
  expect(render({ annotations: [ON_A_REPLY] })).not.toContain("On the page");
  expect(render()).not.toContain("In the classroom");
});
