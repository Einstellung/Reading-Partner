// The topic's Rehearsal list (src/reading/rehearsal/rows.ts): the join between
// the rehearsals on disk and the retells whose deck nobody has given yet, and
// the line each row shows. Run: bun test.

import { expect, test } from "bun:test";
import { rehearsalRows, rehearsalSummary, type RunCount } from "../../../src/reading/rehearsal/rows";
import { newRehearsal, type Rehearsal } from "../../../src/reading/rehearsal/types";

function aRehearsal(over: Partial<Rehearsal> & { id: string }): Rehearsal {
  return {
    ...newRehearsal({
      id: over.id,
      topicId: "topic-1",
      name: "Deck",
      deckFile: `rehearsals/${over.id}.html`,
      now: Number(over.id) || 0,
    }),
    ...over,
  };
}

const NO_RUNS = new Map<string, RunCount>();

test("a retell whose deck has never been given is a row with no rehearsal behind it", () => {
  const rows = rehearsalRows(
    [],
    [{ retellId: "900", name: "Eye and Brain", deckFile: "slides/900-eye.html" }],
    NO_RUNS,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBeNull();
  expect(rows[0].retellId).toBe("900");
  expect(rows[0].deckFile).toBe("slides/900-eye.html");
  expect(rehearsalSummary(rows[0])).toBe("From a retell · not rehearsed yet");
});

// The two doors are one object, so the list must not show both of them.
test("a retell that already has a rehearsal appears once, as the rehearsal", () => {
  const rows = rehearsalRows(
    [aRehearsal({ id: "1000", retellId: "900", name: "Eye and Brain" })],
    [{ retellId: "900", name: "Eye and Brain", deckFile: "slides/900-eye.html" }],
    new Map([["1000", { runs: 2, lastRunAt: 5 }]]),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe("1000");
  expect(rows[0].runs).toBe(2);
  expect(rehearsalSummary(rows[0])).toBe("From a retell · 2 rehearsals");
});

test("an imported deck says so, and counts one pass in the singular", () => {
  const rows = rehearsalRows(
    [aRehearsal({ id: "1000", name: "A Brief History of Intelligence" })],
    [],
    new Map([["1000", { runs: 1, lastRunAt: 5 }]]),
  );
  expect(rehearsalSummary(rows[0])).toBe("Brought in · 1 rehearsal");
});

test("newest first, whether or not the rehearsal exists yet", () => {
  const rows = rehearsalRows(
    [aRehearsal({ id: "3000", name: "Newest" }), aRehearsal({ id: "1000", name: "Oldest" })],
    [{ retellId: "2000", name: "Middle", deckFile: "slides/2000-middle.html" }],
    NO_RUNS,
  );
  expect(rows.map((r) => r.name)).toEqual(["Newest", "Middle", "Oldest"]);
});

test("keys are unique across the two kinds of row", () => {
  const rows = rehearsalRows(
    [aRehearsal({ id: "900", name: "Brought in" })],
    [{ retellId: "900", name: "A retell that happens to share the number", deckFile: "d.html" }],
    NO_RUNS,
  );
  expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
});
