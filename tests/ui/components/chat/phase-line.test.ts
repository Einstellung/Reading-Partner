// What the row's status line says for each phase of a running turn
// (src/ui/components/chat/phase-line.ts). Pure — no React. Run: bun test.

import { expect, test } from "bun:test";
import { phaseLabel } from "../../../../src/ui/components/chat/phase-line";

test("thinking is the only phase with a line of its own", () => {
  expect(phaseLabel("thinking")).toBe("Thinking");
  // A running tool draws its own trace line, and a reply arriving is its own
  // evidence; a second line for either would be the same thing said twice.
  expect(phaseLabel("tool")).toBeNull();
  expect(phaseLabel("writing")).toBeNull();
});

test("a row whose turn has not reported anything yet reads as thinking", () => {
  expect(phaseLabel(undefined)).toBe("Thinking");
});
