// Every palace row says what reclaims it (docs/80), and the saying has to be
// backed by something: a rule the housekeeper applies itself, a flow that exists
// in the code, or a garbage marker that is registered. The `gc` field this
// replaced was a label nothing read, and a label with no code is the gap this
// file is here to fail on.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GENERIC_MARKER,
  garbageMarkerRegistered,
  isGenericRule,
  registerGarbageMarker,
} from "../../src/housekeeper";
import { infoDailyMarker } from "../../src/info/collect/store";
import { bellMarker } from "../../src/legion/bell";
import { runFilesMarker } from "../../src/legion/ledger";
import { PALACE, type PalaceRow } from "../../src/palace";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

function sourceOf(file: string): string | null {
  try {
    return readFileSync(`${REPO}${file}`, "utf8");
  } catch {
    return null;
  }
}

test("every with-parent and inline retention names a function that exists in the file it names", () => {
  const missing: string[] = [];
  for (const row of PALACE) {
    const r = row.retention;
    if (r.rule !== "with-parent" && r.rule !== "inline") continue;
    const text = sourceOf(r.flow.file);
    const defined =
      text !== null &&
      new RegExp(`\\b(function|const|let)\\s+${r.flow.symbol}\\b|\\b${r.flow.symbol}\\s*[,}]`).test(
        text,
      );
    if (!defined) missing.push(`${row.kind}: ${r.flow.file} ${r.flow.symbol}`);
  }
  expect(missing).toEqual([]);
});

// The parent is what the reader deletes: a thing a row's deleteWith can name, or
// a thread. A row that already says what its deletion rides on has to agree.
const PARENTS = new Set(["book", "retell", "outline", "rehearsal", "thread"]);

test("a with-parent retention names a parent the deletion flows know, and agrees with deleteWith", () => {
  const bad: string[] = [];
  for (const row of PALACE) {
    const r = row.retention;
    if (r.rule !== "with-parent") continue;
    if (!PARENTS.has(r.parent)) bad.push(`${row.kind}: unknown parent ${r.parent}`);
    if (row.deleteWith !== "never" && row.deleteWith !== r.parent) {
      bad.push(`${row.kind}: deleteWith ${row.deleteWith}, retention parent ${r.parent}`);
    }
  }
  expect(bad).toEqual([]);
});

test("the generic rules are only used where the housekeeper can apply them", () => {
  const bad: string[] = [];
  for (const row of PALACE) {
    const r = row.retention;
    if (r.rule === "age" && r.from === "name-date" && row.id !== "date") {
      bad.push(`${row.kind}: name-date on a row whose id is ${row.id}`);
    }
    // Truncating a synced file has no sync-safe path yet (docs/80).
    if (r.rule === "tail" && row.sync !== "local") bad.push(`${row.kind}: tail on ${row.sync}`);
    if ((r.rule === "age" || r.rule === "keep-last" || r.rule === "tail") && row.sync === "remote-only") {
      bad.push(`${row.kind}: a generic rule on a remote-only kind`);
    }
  }
  expect(bad).toEqual([]);
});

// What the reader keeps about themselves and what they saved, and the records a
// deletion travels as (docs/58). Nothing reclaims these, and the row has to say
// so rather than a convention.
const EXEMPT = [
  "observation",
  "observation-index",
  "observation-meta",
  "observation-tombstones",
  "statements",
  "user-profile",
  "saved-articles",
  "article-body",
  "deleted-books",
];

test("the permanent exemptions are never reclaimed", () => {
  const rows = EXEMPT.map((kind) => PALACE.find((r) => r.kind === kind) as PalaceRow);
  expect(rows.every(Boolean)).toBe(true);
  expect(rows.filter((r) => r.retention.rule !== "never").map((r) => r.kind)).toEqual([]);
});

// --- markers ------------------------------------------------------------

// The domains register their garbage markers on the way up (useShellBootstrap's
// bootDomains); this registers the same ones, inside the test and undone after,
// as tests/palace/registry.test.ts does with distillation sources. A domain
// marker is added here when it is written.
function withDomainMarkers<T>(body: () => T): T {
  const undo = [
    registerGarbageMarker(runFilesMarker()),
    registerGarbageMarker(bellMarker),
    registerGarbageMarker(infoDailyMarker),
  ];
  try {
    return body();
  } finally {
    for (const u of undo) u();
  }
}

test("every marker a palace row names is registered", () => {
  const unbacked = withDomainMarkers(() =>
    PALACE.flatMap((row) => {
      const r = row.retention;
      if (r.rule !== "marker") return [];
      return garbageMarkerRegistered(r.marker) ? [] : [`${row.kind}: ${r.marker}`];
    }),
  );
  expect(unbacked).toEqual([]);
});

test("every row that is reclaimed says by what: a generic rule, a flow or a marker", () => {
  const unaccounted = PALACE.filter((row) => {
    const r = row.retention;
    if (r.rule === "never") return false;
    if (isGenericRule(r)) return false;
    if (r.rule === "with-parent" || r.rule === "inline") return r.flow.file === "" || r.flow.symbol === "";
    return r.rule !== "marker" || r.marker === "" || r.marker === GENERIC_MARKER;
  }).map((r) => r.kind);
  expect(unaccounted).toEqual([]);
});
