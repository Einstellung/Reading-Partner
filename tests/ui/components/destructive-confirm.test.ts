// Two source-scanned rules that nothing at runtime would tell us about.
//
// No native confirm anywhere. Under Tauri the dialog plugin swaps in an async
// `window.confirm`, so `if (!confirm(...)) return` never returns and the ACL
// rejects the call besides — a delete that looked guarded ran unguarded, and
// `tsc` said nothing because the DOM lib still types it `boolean`
// (docs/pitfall/98).
//
// And the citation chip carries a touch target. It is a control drawn into a
// line of prose, 18–22px tall, and the way back to the page a note came from;
// HIT_44 gives it a 44px pseudo-element without touching the line box.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Comments out: the replacement names what it replaced.
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("nothing calls the native confirm or alert", () => {
  const offenders = sources(ROOT).filter((path) => /\bwindow\.(confirm|alert)\s*\(/.test(code(path)));
  expect(offenders).toEqual([]);
});

test("deleting a topic goes through an AlertDialog", () => {
  const source = readFileSync(join(ROOT, "ui/components/library/DeleteTopicButton.tsx"), "utf8");
  // The delete hangs off the dialog's action, not off the trigger.
  expect(source).toContain('<AlertDialogAction variant="destructive" onClick={onDelete}>');
  expect(source).toContain("<AlertDialogCancel>");
  // The original wording: the topic goes, the files do not.
  expect(source).toContain("The files stay on disk.");
});

test("the citation chip carries a 44px target without moving the line", () => {
  const source = readFileSync(join(ROOT, "ui/components/markdown/MarkdownRenderer.tsx"), "utf8");
  const start = source.indexOf("const CITATION_CHIP");
  const chip = source.slice(start, source.indexOf("].join(' ');", start));
  expect(chip).toContain("HIT_44");
  // HIT_44's pseudo-element needs a positioned element to centre itself on, and
  // `relative` is the one thing here that costs no layout.
  expect(chip).toMatch(/'relative /);
  expect(source).toContain("className={CITATION_CHIP}");
});
