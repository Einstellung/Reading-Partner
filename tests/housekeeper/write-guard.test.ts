// The two halves of a writable kind (docs/platform/687 登记): the palace row's
// `ai.write` mark and the entry a domain registers at boot. edit_data lets
// through only the kinds where both are there, so each half without the other
// is a mistake this file fails on. Domains that register entries are imported
// here so their registrations run, the way the retention guard imports markers.

import { expect, test } from "bun:test";
import { PALACE, type PalaceRow } from "../../src/palace";
import { genericMarker } from "../../src/housekeeper";
import { registeredWritables, registerWritable, writeGuardProblems } from "../../src/housekeeper/write";
import { NOTES_KIND, NOTES_ROW, memIo, notesEntry } from "./write-fixture";

test("every palace row marked ai.write has a registered entry, and every entry a marked row", () => {
  expect(writeGuardProblems(PALACE, registeredWritables())).toEqual([]);
});

test("the guard fails on either half alone, and on a remote-only row", () => {
  const unmarked: PalaceRow = { ...NOTES_ROW, kind: "test-unmarked" };
  delete (unmarked as { ai?: unknown }).ai;
  const remote: PalaceRow = { ...NOTES_ROW, kind: "test-remote", sync: "remote-only" };
  const rows = [NOTES_ROW, unmarked, remote];
  expect(writeGuardProblems(rows, [])).toEqual([
    "test-notes: marked ai.write but no entry is registered",
    "test-remote: marked ai.write but no entry is registered",
    "test-remote: marked ai.write but its sync is remote-only",
  ]);
  expect(writeGuardProblems(rows, [{ kind: NOTES_KIND }, { kind: "test-unmarked" }, { kind: "test-gone" }])).toEqual([
    "test-remote: marked ai.write but no entry is registered",
    "test-remote: marked ai.write but its sync is remote-only",
    "test-unmarked: an entry is registered but the row is not marked ai.write",
    "test-gone: an entry is registered but the palace has no such kind",
  ]);
});

test("a registered entry for a kind the palace does not mark fails the real table", () => {
  const undo = registerWritable(notesEntry(memIo()));
  try {
    expect(writeGuardProblems(PALACE, registeredWritables())).toEqual([
      "test-notes: an entry is registered but the palace has no such kind",
    ]);
  } finally {
    undo();
  }
});

test("versions are kept twenty to a kind directory, whatever the kind is called", async () => {
  const dirs: Record<string, string[]> = {
    "housekeeper-versions": ["a-kind", "b-kind"],
    "housekeeper-versions/a-kind": Array.from({ length: 22 }, (_, i) => `20261106T1200000${String(i).padStart(2, "0")}Z-abcdef.json`),
    "housekeeper-versions/b-kind": ["20261106T120000000Z-abcdef.json"],
  };
  const marks = await genericMarker().mark({
    now: Date.now(),
    io: {
      list: async (dir) =>
        (dirs[dir] ?? []).map((name) => ({ name, isFile: name.endsWith(".json") })),
      stat: async () => null,
      readText: async () => null,
    },
  });
  const versions = marks.filter((m) => m.path.startsWith("housekeeper-versions/")).map((m) => m.path);
  expect(versions).toEqual([
    "housekeeper-versions/a-kind/20261106T120000001Z-abcdef.json",
    "housekeeper-versions/a-kind/20261106T120000000Z-abcdef.json",
  ]);
});
