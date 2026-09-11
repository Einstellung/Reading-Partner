// The catalogue holds itself together (src/palace/kinds.ts, docs/61).
//
// Everything derived from the table — the sync range, the never-infer-delete
// set, the walk's descend rule, and the merge strategies and dead paths that
// follow — reads a row's samples and its fields as if they were consistent. This
// is where that is checked, because a row is written once and read by five
// places that would each fail in a different silent way. Run: bun test.

import { expect, test } from "bun:test";
import { PALACE, resolvePalace } from "../../src/palace";

test("every kind is named once", () => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const row of PALACE) {
    if (seen.has(row.kind)) dupes.push(row.kind);
    seen.add(row.kind);
  }
  expect(dupes).toEqual([]);
});

test("every row carries at least one sample, and no path is sampled twice", () => {
  const empty = PALACE.filter((r) => r.samples.length === 0).map((r) => r.kind);
  expect(empty).toEqual([]);

  const owner = new Map<string, string>();
  const shared: string[] = [];
  for (const row of PALACE) {
    for (const path of row.samples) {
      const first = owner.get(path);
      if (first) shared.push(`${path}: ${first} and ${row.kind}`);
      else owner.set(path, row.kind);
    }
  }
  expect(shared).toEqual([]);
});

// The table's order is its priority, and a general row above a specific one
// swallows it silently: threads-<bookId> would take every retell and info
// conversation, covers/<id>.json would take the failure markers. This is the
// check that the order and the anchoring agree.
test("every sample resolves to the row that listed it", () => {
  const wrong: string[] = [];
  for (const row of PALACE) {
    for (const path of row.samples) {
      const hit = resolvePalace(path);
      if (hit?.row.kind !== row.kind) {
        wrong.push(`${path}: listed under ${row.kind}, resolved to ${hit?.row.kind ?? "nothing"}`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("a row that syncs on the data channel says how it merges", () => {
  const missing = PALACE.filter((r) => r.sync === "data" && r.merge === undefined).map(
    (r) => r.kind,
  );
  expect(missing).toEqual([]);
});

test("a row that merges as records says where its records sit", () => {
  const missing = PALACE.filter((r) => r.merge === "records" && r.shape === undefined).map(
    (r) => r.kind,
  );
  expect(missing).toEqual([]);
});

// A path a tree comparison may never delete has to be a path that syncs at all
// (docs/59 §10.2): out of range, nothing would ever compare it and the
// protection would silently stop meaning anything.
test("nothing on the never-infer list is off the data channel", () => {
  const stray = PALACE.filter((r) => r.neverInferDelete && r.sync !== "data").map((r) => r.kind);
  expect(stray).toEqual([]);
});

// A tombstone names paths, so every kind that dies with a book has to be able to
// say what its path is for a given id.
test("everything that dies with a book can name its own path", () => {
  const unnameable = PALACE.filter((r) => r.deleteWith === "book" && !r.pathFor).map((r) => r.kind);
  expect(unnameable).toEqual([]);
});

// A directory row is the walker's whole permission to open that directory, so
// the prefix has to be the first segment of the samples underneath it.
test("a descend rule matches the samples of the row that declares it", () => {
  const wrong: string[] = [];
  for (const row of PALACE) {
    const dir = row.dir;
    if (!dir) continue;
    for (const path of row.samples) {
      const head = path.split("/")[0] ?? "";
      const owns = dir.prefix.endsWith("-") ? head.startsWith(dir.prefix) : head === dir.prefix;
      if (!owns) wrong.push(`${row.kind}: ${path} is not under ${dir.prefix}`);
    }
  }
  expect(wrong).toEqual([]);
});

// The sentence a row is shown to the soul by (docs/67). The catalogue walk
// resolves a path and lists what the row's id names, so a row the soul may see
// has to be one of two things: a file with one name, whose records inside it are
// the items, or a name that captures an id. A row matching a subtree with no id
// would be counted and never nameable.
test("every kind the soul is shown is one the catalogue can list", () => {
  const unlistable: string[] = [];
  for (const row of PALACE) {
    if (row.about === undefined) continue;
    const claims = row.samples.map((path) => resolvePalace(path));
    const named =
      row.id === "fixed"
        ? claims.every((hit) => hit?.id === null)
        : claims.every((hit) => typeof hit?.id === "string" && hit.id !== "");
    if (!named) unlistable.push(row.kind);
  }
  expect(unlistable).toEqual([]);
});

// What the soul is shown is the reader's own material and never a derived one.
// A cache, a marker and a device ledger are this device's bookkeeping: telling
// the soul they exist would invite it to talk about them.
test("only what travels as the reader's data is shown to the soul", () => {
  const derived = PALACE.filter((r) => r.about !== undefined && r.sync !== "data").map(
    (r) => r.kind,
  );
  expect(derived).toEqual([]);
});
