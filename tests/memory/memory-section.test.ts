// The three-block memory paragraph of a reading turn (docs/48, 消费侧;
// src/memory/live/memory-section.ts). Run: bun test.

import { expect, test } from "bun:test";
import { dropCoveredObservations, memorySection } from "../../src/memory/live/memory-section";
import type { Observation } from "../../src/memory/observations/types";
import type { Statement } from "../../src/memory/statements/types";

const BOOK = "book-a";
const STUCK = "m-1111111111111111";
const READ = "m-2222222222222222";

function statement(over: Partial<Statement> & { id: string }): Statement {
  return {
    kind: "profile",
    text: "wants the full derivation, not a picture",
    author: "dream",
    evidence: [],
    contradictedBy: [],
    established: "2026-08-01",
    lastSupported: "2026-08-20",
    ...over,
  };
}

function observation(over: Partial<Observation> & { id: string }): Observation {
  return {
    type: "stuck-point",
    summary: "stuck on the softmax scaling",
    body: "",
    created: "2026-08-01",
    updated: "2026-08-01",
    anchors: { annotationIds: [], messageIds: [] },
    bookId: BOOK,
    ...over,
  };
}

const line = (id: string, summary = "a thing that happened", type = "stuck-point") =>
  `- [${type}] ${summary} (updated 2026-08-01, id ${id})`;

test("the three blocks come out in order: statements, what is open, observations", () => {
  const out = memorySection({
    statements: [statement({ id: "s-a" })],
    observations: [observation({ id: STUCK })],
    bookId: BOOK,
    observationSnapshot: line(READ, "asked about entropy", "belief"),
    hasObservationTools: true,
  });
  const at = (needle: string) => out.indexOf(needle);
  expect(at("wants the full derivation")).toBeGreaterThanOrEqual(0);
  expect(at("wants the full derivation")).toBeLessThan(at("stuck on the softmax scaling"));
  expect(at("stuck on the softmax scaling")).toBeLessThan(at("asked about entropy"));
});

test("each statement carries its id, and the reader's own come before the concluded ones", () => {
  const out = memorySection({
    statements: [
      statement({ id: "s-guessed", text: "reads past the maths" }),
      statement({ id: "s-said", text: "no diagrams", author: "reader" }),
    ],
    observations: [],
    bookId: BOOK,
    observationSnapshot: "",
    hasObservationTools: false,
  });
  expect(out).toContain("- no diagrams (id s-said)");
  expect(out).toContain("- reads past the maths (id s-guessed)");
  expect(out.indexOf("no diagrams")).toBeLessThan(out.indexOf("reads past the maths"));
});

test("superseded statements, concerns and empty text are not in the block", () => {
  const out = memorySection({
    statements: [
      statement({ id: "s-old", text: "used to want pictures", supersededBy: "s-new" }),
      statement({ id: "s-concern", text: "watching the RL papers", kind: "concern" }),
      statement({ id: "s-blank", text: "   " }),
    ],
    observations: [],
    bookId: BOOK,
    observationSnapshot: "",
    hasObservationTools: false,
  });
  expect(out).toBe("");
});

// No block, not an empty one: a heading over nothing spends the window saying
// there is nothing to say, and reads as a fact about the reader.
test("a block with nothing in it does not appear at all", () => {
  const out = memorySection({
    statements: [],
    observations: [observation({ id: STUCK })],
    bookId: BOOK,
    observationSnapshot: "",
    hasObservationTools: false,
  });
  expect(out).not.toMatch(/known about this reader/i);
  expect(out).toContain("Still open in this book");
  expect(out.startsWith("Still open")).toBe(true);
});

test("observations a standing statement rests on are left out of the third block", () => {
  const snapshot = [line(READ, "explained attention back"), line(STUCK, "stuck on softmax")].join(
    "\n\n",
  );
  const out = memorySection({
    statements: [statement({ id: "s-a", evidence: [READ] })],
    observations: [],
    bookId: BOOK,
    observationSnapshot: snapshot,
    hasObservationTools: false,
  });
  expect(out).not.toContain("explained attention back");
  expect(out).toContain("stuck on softmax");
});

test("a superseded statement stops covering its evidence", () => {
  const snapshot = line(READ, "explained attention back");
  const covering = statement({ id: "s-a", evidence: [READ] });
  const out = memorySection({
    statements: [{ ...covering, supersededBy: "s-b" }],
    observations: [],
    bookId: BOOK,
    observationSnapshot: snapshot,
    hasObservationTools: false,
  });
  expect(out).toContain("explained attention back");
});

test("dropping an entry takes its body and leaves the rest of the snapshot alone", () => {
  const snapshot = [
    `${line(READ, "explained attention back")}\nThe body of the covered one.\n- a bullet in it`,
    `${line(STUCK, "stuck on softmax")}\nThe body of the open one.`,
  ].join("\n\n");
  const kept = dropCoveredObservations(snapshot, new Set([READ]));
  expect(kept).toBe(`${line(STUCK, "stuck on softmax")}\nThe body of the open one.`);
});

test("nothing covered leaves the snapshot byte for byte", () => {
  const snapshot = `${line(READ)}\nbody\n\n${line(STUCK)}`;
  expect(dropCoveredObservations(snapshot, new Set())).toBe(snapshot);
  expect(dropCoveredObservations(snapshot, new Set(["m-9999999999999999"]))).toBe(snapshot);
});
