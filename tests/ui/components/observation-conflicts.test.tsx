// The conflict-copy notice in the AI observations panel
// (src/ui/components/reader/ObservationPanel.tsx). Sync parks the losing version
// of an observation two devices both edited beside the winner; nothing in the app
// mentioned that those files exist, so the reader's own writing sat on disk with
// no way to know. Rendered statically, so the assertions are about what reaches
// the DOM. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ObservationPanel from "../../../src/ui/components/reader/ObservationPanel";
import type { ObservationConflict } from "../../../src/memory";

function copy(over: Partial<ObservationConflict> = {}): ObservationConflict {
  return {
    path: "memory-topic-1/m-1a2b3c4d.conflict-deadbeef.md",
    id: "m-1a2b3c4d",
    summary: "Thinks attention is a soft lookup",
    body: "The version this device had.",
    updated: "2026-08-04",
    ...over,
  };
}

test("a topic with no conflict copies says nothing about them", () => {
  const html = renderToStaticMarkup(
    <ObservationPanel entries={[]} lastDistilledAt={null} conflicts={[]} />,
  );
  expect(html).not.toContain("conflict");
});

test("the notice counts the copies and names where they are", () => {
  const html = renderToStaticMarkup(
    <ObservationPanel
      entries={[]}
      lastDistilledAt={null}
      conflicts={[copy(), copy({ path: "memory-topic-1/m-99887766.conflict-cafebabe.md" })]}
    />,
  );
  expect(html).toContain("2 conflict copies");
  // Findable on disk: the path is in the markup, not only the count.
  expect(html).toContain("memory-topic-1/m-1a2b3c4d.conflict-deadbeef.md");
  expect(html).toContain("memory-topic-1/m-99887766.conflict-cafebabe.md");
});

test("one copy is one copy", () => {
  const html = renderToStaticMarkup(
    <ObservationPanel entries={[]} lastDistilledAt={null} conflicts={[copy()]} />,
  );
  expect(html).toContain("1 conflict copy");
  expect(html).not.toContain("1 conflict copies");
});

test("a copy that would not parse still shows its path", () => {
  const html = renderToStaticMarkup(
    <ObservationPanel
      entries={[]}
      lastDistilledAt={null}
      conflicts={[copy({ summary: "", body: "" })]}
    />,
  );
  expect(html).toContain("memory-topic-1/m-1a2b3c4d.conflict-deadbeef.md");
  expect(html).toContain("could not be read");
});
