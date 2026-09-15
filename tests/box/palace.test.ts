// The box's row in the catalogue (docs/61): the item file has to be in sync
// range, resolve to its own row, and have its join registered — importing
// src/box is the whole of that wiring, because platform may not reach into box.

import { expect, test } from "bun:test";
import "../../src/box";
import { BOX_DIR, randomBoxItemId } from "../../src/box/store";
import { rowOf, resolvePalace } from "../../src/palace";
import { isLatticeRegistered, latticeFor } from "../../src/platform/sync/merge/lattice";
import { inSyncRange, neverInferDelete } from "../../src/platform/sync/syncFs";
import { strategyFor } from "../../src/platform/sync/merge/contract";

const SAMPLE = `${BOX_DIR}/b-0123456789abcdef0123456789abcdef.json`;

test("an item file is claimed by the box-item row and nothing else", () => {
  const hit = resolvePalace(SAMPLE);
  expect(hit?.row.kind).toBe("box-item");
  expect(hit?.id).toBe("b-0123456789abcdef0123456789abcdef");
  expect(rowOf("box-item").samples).toContain(SAMPLE);
  expect(rowOf("box-item").pathFor?.("b-0123456789abcdef0123456789abcdef")).toBe(SAMPLE);

  // The id an item is written under is the only shape the row admits, so a name
  // that arrived over sync can never become a path outside the directory.
  expect(resolvePalace(`${BOX_DIR}/notes.md`)).toBeNull();
  expect(resolvePalace(`${BOX_DIR}/sub/b-0123456789abcdef0123456789abcdef.json`)).toBeNull();
  expect(resolvePalace(`${BOX_DIR}/../secrets.json`)).toBeNull();
});

test("an item travels, merges as a lattice, and is never inferred away", () => {
  expect(inSyncRange(SAMPLE)).toBe(true);
  expect(inSyncRange(`${BOX_DIR}/${randomBoxItemId()}.json`)).toBe(true);
  expect(strategyFor(SAMPLE)).toBe("lattice");
  expect(isLatticeRegistered("box-item")).toBe(true);
  expect(latticeFor(SAMPLE)).not.toBeNull();
  expect(neverInferDelete(SAMPLE)).toBe(true);
  expect(rowOf("box-item").gc).toBe("never");
});
