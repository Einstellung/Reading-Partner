// Every .ts/.tsx file in the repo has to stay text as grep defines it. A source
// file holding a raw NUL byte, or a byte sequence that is not UTF-8, is binary to
// GNU grep: it reports no match and exits 1 without printing "Binary file
// matches", so the whole file drops out of every plain grep in silence. That cost
// a live module: an audit read "no importers" off a grep that had skipped the one
// file importing it. Both forms are avoidable in source — a NUL in a string is
// written `\0`, everything else is already text — so the rule is flat.
// Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCANNED = ["src", "tests", "scripts"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...sourceFiles(p));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const files = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)));

test("every source file scans as text, so grep can see it", () => {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const bad: string[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const rel = relative(ROOT, file);
    if (bytes.includes(0)) {
      bad.push(`${rel}: NUL byte (write it as the \\0 escape)`);
      continue;
    }
    try {
      utf8.decode(bytes);
    } catch {
      bad.push(`${rel}: not valid UTF-8`);
    }
  }
  expect(bad).toEqual([]);
});

test("the scan reaches the source tree", () => {
  expect(files.length).toBeGreaterThan(100);
});
