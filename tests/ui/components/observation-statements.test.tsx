// The "About you" block of the AI observations panel
// (src/ui/components/reader/ObservationPanel.tsx): what is held to be true about
// the reader, shown to them read-only. Rendered statically, so the assertions
// are about what reaches the DOM. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ObservationPanel from "../../../src/ui/components/reader/ObservationPanel";
import type { Statement } from "../../../src/memory";

function statement(over: Partial<Statement> & { id: string }): Statement {
  return {
    kind: "profile",
    text: "Wants the full derivation, not a diagram of it.",
    author: "dream",
    evidence: ["m-1111111111111111", "m-2222222222222222"],
    contradictedBy: [],
    established: "2026-08-01",
    lastSupported: "2026-09-01",
    ...over,
  };
}

const panel = (statements: Statement[]) =>
  renderToStaticMarkup(
    <ObservationPanel entries={[]} statements={statements} lastDistilledAt={null} conflicts={[]} />,
  );

test("a reader with no statements is not told there are none", () => {
  expect(panel([])).not.toContain("About you");
});

test("a statement shows its text, kind, author, date and how much it rests on", () => {
  const html = panel([statement({ id: "s-1" })]);
  expect(html).toContain("About you");
  expect(html).toContain("Wants the full derivation, not a diagram of it.");
  expect(html).toContain("profile");
  expect(html).toContain("Concluded");
  expect(html).toContain("last supported 2026-09-01");
  expect(html).toContain("2 observations");
});

test("what the reader said themselves says so, and a concern is labelled a concern", () => {
  const html = panel([
    statement({ id: "s-1", author: "reader", kind: "concern", text: "Watching the RL papers." }),
  ]);
  expect(html).toContain("You said");
  expect(html).toContain("concern");
});

// Correcting one is a conversation (docs/48). A button here would be a second
// way to change what the AI believes, and the only one that loses the reasoning
// along with the claim.
test("nothing here edits or deletes a statement", () => {
  const html = panel([statement({ id: "s-1" })]);
  const block = html.slice(html.indexOf("About you"), html.indexOf("Nothing observed yet"));
  expect(block).not.toContain("<button");
  expect(block.toLowerCase()).not.toContain("delete");
});

test("a superseded statement is off the list", () => {
  const html = panel([
    statement({ id: "s-old", text: "Used to want pictures.", supersededBy: "s-new" }),
  ]);
  expect(html).not.toContain("Used to want pictures.");
  expect(html).not.toContain("About you");
});
