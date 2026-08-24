// No test may swap a module out of the registry. Enforced instead of
// remembered, the way tests/layering.test.ts enforces the layer table.
//
// What it costs when one does. bun's module mock is process-wide and
// mock.restore() does not undo it (docs/pitfall/119): the stub a file registers
// is what every file loaded after it links against, for the rest of the run.
// Two files that each register their own in-memory disk therefore race, and the
// one that loses reads the other's memory. A stub carrying fewer exports than
// the real module is worse — the next file that imports a missing name fails to
// link and does not run at all, while bun still counts it in "Ran N tests
// across M files".
//
// Neither failure lands on the file that caused it. The suite spent months with
// tens of randomised-order failures in files nobody had touched, and each one
// was traced back to whichever file happened to load first that run.
//
// What to do instead: spyOn the module's namespace. Importers see the
// replacement (docs/pitfall/122), and the preload puts it back between test
// cases (docs/pitfall/171). tests/support/appdata-fake.ts is the filesystem
// case, and tests/platform/app/appdata.test.ts is the smallest example.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Everything under tests/, plus the tests that live beside their subject under
// src/. Non-test source under src/ is out of scope: bun:test is not importable
// there, and tests/layering.test.ts already says what src may import.
const SCANNED_DIRS = ["tests", "src"];

/**
 * Files that may still swap a module out. Empty, and meant to stay empty: an
 * entry here is a file whose failures land on other files. The list exists so
 * that adding one has to be written down.
 */
const ALLOWED: string[] = [];

// Assembled rather than written out, so this file does not match its own
// check.
const CALL_RE = new RegExp(`\\bmock\\s*\\.\\s*${"module"}\\s*\\(`);

function isTestFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith(".test.tsx");
}

// Under tests/ every source file counts, support helpers included: a helper
// that registers a stub does it on behalf of whichever file imported it. Under
// src/ only the test files do.
function scanned(dir: string, all: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...scanned(p, all));
      continue;
    }
    if (all ? entry.endsWith(".ts") || entry.endsWith(".tsx") : isTestFile(entry)) out.push(p);
  }
  return out;
}

const FILES = SCANNED_DIRS.flatMap((dir) => scanned(join(ROOT, dir), dir === "tests")).map((p) =>
  relative(ROOT, p),
);

test("the scan reaches the suite", () => {
  // A path typo or a rename would otherwise leave this file green over nothing.
  expect(FILES.length).toBeGreaterThan(200);
  expect(FILES).toContain("tests/support/appdata-fake.ts");
  expect(FILES.some((f) => f.startsWith("src/"))).toBe(true);
});

test("no test file swaps a module out of the registry", () => {
  const offenders = FILES.filter((rel) => !ALLOWED.includes(rel)).filter((rel) =>
    CALL_RE.test(readFileSync(join(ROOT, rel), "utf8")),
  );
  if (offenders.length > 0) {
    throw new Error(
      "\nThese files replace a module for the whole run:\n" +
        offenders.map((rel) => `  ${rel}`).join("\n") +
        "\nUse spyOn(namespace, \"export\") instead — it is one property, importers see" +
        " it, and the preload puts it back between cases (docs/pitfall/119, 122, 171)." +
        "\nFor the filesystem, installAppData() in tests/support/appdata-fake.ts does" +
        " all of it.\n",
    );
  }
  expect(offenders).toEqual([]);
});

test("the allowlist is empty, and every entry in it names a file that exists", () => {
  expect(ALLOWED).toEqual([]);
  expect(ALLOWED.filter((rel) => !FILES.includes(rel))).toEqual([]);
});
