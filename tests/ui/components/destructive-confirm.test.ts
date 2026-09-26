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

test("the destructive confirmation runs the act from the AlertDialog's action", () => {
  const source = readFileSync(join(ROOT, "ui/components/common/ConfirmDestructiveDialog.tsx"), "utf8");
  // The delete hangs off the dialog's action, not off the trigger.
  expect(source).toContain('<AlertDialogAction variant="destructive" onClick={props.onConfirm}>');
  expect(source).toContain("<AlertDialogCancel>");
});

test("deleting a topic goes through the destructive confirmation", () => {
  const source = readFileSync(join(ROOT, "ui/components/library/LibraryScreen.tsx"), "utf8");
  const start = source.indexOf("{deleting && (");
  const dialog = source.slice(start, source.indexOf("/>", start));
  expect(dialog).toContain("<TopicDeleteDialog");
  const own = readFileSync(join(ROOT, "ui/components/library/TopicDeleteDialog.tsx"), "utf8");
  expect(own).toContain("<ConfirmDestructiveDialog");
  // The topic goes with the work done in it (reading/delete/delete-topic.ts);
  // its files go only when the box is ticked (shelf/topic-delete.ts).
  const words = readFileSync(join(ROOT, "ui/components/shelf/topic-delete.ts"), "utf8");
  expect(words).toContain("with the retells, talks and rehearsals made in it");
});

// deleteRetell takes the retell's rehearsals with it (reading/retell/store.ts),
// so the confirmation says so.
test("deleting a retell says its rehearsals go too", () => {
  const source = readFileSync(join(ROOT, "ui/components/library/topic/RetellSection.tsx"), "utf8");
  const start = source.indexOf("<ConfirmDestructiveDialog");
  const dialog = source.slice(start, source.indexOf("/>", start));
  expect(dialog).toContain("every rehearsal of its talk");
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
