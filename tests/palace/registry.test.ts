// The runtime registrations keyed on a palace kind (docs/61).
//
// The table is static; what a kind can do is registered at startup — an opener
// with desk, a way to read the raw material with the distiller. Both are keyed
// by the kind name, and both start from a path: something on disk resolves to a
// row, and the row's name finds the registration. So the guard the registrations
// rest on is that a path resolves to exactly one row, and that the row it
// resolves to is the one that claims it.
//
// The desk and distill-source assertions arrive with the packages that register
// them (P2, P3a). Until then this holds the resolution guard alone. Run: bun test.

import { expect, test } from "bun:test";
import { PALACE, resolvePalace, rowOf, rowsWhere, type PalaceKind } from "../../src/palace";

test("a sample path finds one row, and it is the row that named it", () => {
  for (const row of PALACE) {
    for (const path of row.samples) {
      const hit = resolvePalace(path);
      expect(`${path} -> ${hit?.row.kind ?? "nothing"}`).toBe(`${path} -> ${row.kind}`);
      expect(rowOf(row.kind as PalaceKind).kind).toBe(row.kind);
    }
  }
});

test("a path nothing claims resolves to nothing", () => {
  for (const path of ["random.txt", "", "nowhere/at/all.json"]) {
    expect(resolvePalace(path)).toBe(null);
  }
});

// A distilled source is read one unit at a time and its cursor is kept under the
// unit's id, so a kind with no key of its own could not be resumed.
test("every distilled kind has an id to key its cursor under", () => {
  const keyless = rowsWhere((r) => r.distill !== undefined && r.id === "fixed").map((r) => r.kind);
  expect(keyless).toEqual([]);
});

test("no kind is registered as being on the desk yet", () => {
  // P3a registers the first opener. Until a package registers one, a desk mark
  // here would be a guard failing against nothing.
  expect(rowsWhere((r) => r.desk === true || r.deskKind !== undefined)).toEqual([]);
});
