// The reader's statements as a prompt block (src/memory/statements/section.ts):
// what the info side reads now that it no longer reads a profile document
// (docs/48, docs/61). Pure — no store, no filesystem. Run: bun test.

import { expect, test } from "bun:test";

import { readerStatementSection } from "../../src/memory/statements/section";
import type { Statement, StatementAuthor, StatementKind } from "../../src/memory/statements/types";

function statement(
  id: string,
  kind: StatementKind,
  text: string,
  author: StatementAuthor = "reader",
  supersededBy?: string,
): Statement {
  return {
    id,
    kind,
    text,
    author,
    evidence: [],
    contradictedBy: [],
    established: "2026-09-01",
    lastSupported: "2026-09-10",
    ...(supersededBy ? { supersededBy } : {}),
  };
}

test("nothing known prints nothing at all", () => {
  expect(readerStatementSection([])).toBe("");
  expect(readerStatementSection([statement("s-1", "profile", "   ")])).toBe("");
});

// The two kinds answer different questions, so they head their own blocks: who
// this person is, and what they are watching for.
test("profile and concern print as two blocks, each line carrying its id", () => {
  const out = readerStatementSection([
    statement("s-1", "profile", "Wants the derivation, not the diagram."),
    statement("s-2", "concern", "Watching whether arms get cheap."),
  ]);
  expect(out).toContain("Wants the derivation, not the diagram. (id s-1)");
  expect(out).toContain("Watching whether arms get cheap. (id s-2)");
  expect(out.indexOf("keeping an eye on")).toBeGreaterThan(out.indexOf("said about themselves"));
});

test("a concern alone prints its own block and no empty profile heading", () => {
  const out = readerStatementSection([statement("s-2", "concern", "Watching robotics funding.")]);
  expect(out).toContain("keeping an eye on");
  expect(out).not.toContain("said about themselves");
  expect(out.startsWith("\n")).toBe(false);
});

// Not because one is truer: they are not equally revisable, and the model acts
// on the first thing it reads (live/memory-section.ts holds the same order).
test("the reader's own words come before what a pass concluded", () => {
  const out = readerStatementSection([
    statement("s-1", "profile", "Concluded from how they read.", "dream"),
    statement("s-2", "profile", "Said it themselves."),
  ]);
  expect(out.indexOf("Said it themselves.")).toBeLessThan(out.indexOf("Concluded from how they read."));
});

test("a superseded statement is not what is known about the reader any more", () => {
  const out = readerStatementSection([
    statement("s-1", "profile", "Used to want diagrams.", "reader", "s-2"),
    statement("s-2", "profile", "Wants the derivation."),
  ]);
  expect(out).not.toContain("Used to want diagrams.");
  expect(out).toContain("Wants the derivation.");
});
