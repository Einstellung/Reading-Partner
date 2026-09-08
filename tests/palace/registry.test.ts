// The runtime registrations keyed on a palace kind (docs/61).
//
// The table is static; what a kind can do is registered at startup — an opener
// with desk, a way to read the raw material with the distiller. Both are keyed
// by the kind name, and both start from a path: something on disk resolves to a
// row, and the row's name finds the registration. So the guard the registrations
// rest on is that a path resolves to exactly one row, and that the row it
// resolves to is the one that claims it.
//
// The distill-source assertion arrives with the package that registers them
// (P2). Run: bun test.

import { expect, test } from "bun:test";
import { deskKindRegistered } from "../../src/desk";
import { registerReadingDesk } from "../../src/reading/desk";
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

// A row marked `desk` says this data can be put in front of the AI. Nothing on
// the desk opens itself: a domain registers the opener at startup
// (useShellBootstrap's bootDomains), and the mark on the row is the claim that
// one exists. Registered here the way the shell does it, so the guard is against
// the real openers and not against a fixture.
test("every kind marked as desk material has an opener registered", () => {
  registerReadingDesk();
  const unopenable = rowsWhere((r) => r.desk === true)
    .map((r) => r.deskKind ?? r.kind)
    .filter((kind) => !deskKindRegistered(kind));
  expect(unopenable).toEqual([]);
});

// deskKind is how a row says the opener goes by another name; on its own it
// says nothing, and the guard above would never read it.
test("a row naming a desk kind is marked as desk material", () => {
  const dangling = rowsWhere((r) => r.deskKind !== undefined && r.desk !== true).map((r) => r.kind);
  expect(dangling).toEqual([]);
});
