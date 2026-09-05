// The rows the observation panel's "About you" block prints
// (src/ui/components/reader/statements-view.ts). Run: bun test.

import { expect, test } from "bun:test";
import { statementRows } from "../../../src/ui/components/reader/statements-view";
import type { Statement } from "../../../src/memory";

function statement(over: Partial<Statement> & { id: string }): Statement {
  return {
    kind: "profile",
    text: "wants the full derivation",
    author: "dream",
    evidence: [],
    contradictedBy: [],
    established: "2026-08-01",
    lastSupported: "2026-08-20",
    ...over,
  };
}

test("a row carries the text, the kind, who said it and when it was last supported", () => {
  const [row] = statementRows([
    statement({
      id: "s-1",
      text: "  no diagrams  ",
      kind: "concern",
      author: "reader",
      lastSupported: "2026-09-01",
    }),
  ]);
  expect(row).toEqual({
    id: "s-1",
    text: "no diagrams",
    kind: "concern",
    author: "You said",
    lastSupported: "2026-09-01",
    evidence: "",
  });
});

test("what was concluded says so", () => {
  expect(statementRows([statement({ id: "s-1" })])[0].author).toBe("Concluded");
});

test("evidence is counted, observations and conversation turns apart", () => {
  const label = (evidence: string[]) =>
    statementRows([statement({ id: "s-1", evidence })])[0].evidence;
  expect(label(["m-1111111111111111"])).toBe("1 observation");
  expect(label(["m-1111111111111111", "m-2222222222222222", "m-3333333333333333"])).toBe(
    "3 observations",
  );
  expect(label(["t-4444444444444444@th-1:1756000000000"])).toBe("1 message");
  expect(label(["m-1111111111111111", "t-4444444444444444@th-1:1756000000000"])).toBe(
    "1 observation, 1 message",
  );
});

test("superseded statements and empty text are not rows", () => {
  expect(
    statementRows([
      statement({ id: "s-old", supersededBy: "s-new" }),
      statement({ id: "s-blank", text: "  " }),
    ]),
  ).toEqual([]);
});

test("the most recently supported come first, ties broken by id", () => {
  const rows = statementRows([
    statement({ id: "s-b", lastSupported: "2026-08-01" }),
    statement({ id: "s-c", lastSupported: "2026-09-01" }),
    statement({ id: "s-a", lastSupported: "2026-08-01" }),
  ]);
  expect(rows.map((r) => r.id)).toEqual(["s-c", "s-a", "s-b"]);
});
