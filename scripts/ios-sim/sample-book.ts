// A book to share into the simulator, written out on demand rather than kept in
// the repository. The real books this was developed against are copyrighted and
// not a byte of one is here; this reuses the same builder the EPUB tests use.
//
//   bun scripts/ios-sim/sample-book.ts /tmp/sample.epub ["A marker line"]
//
// The marker goes in the first chapter's body, so two books built from this
// script are told apart by what the reader renders — which is how the duplicate
// delivery case is checked (the same URL twice must not reopen the book).

import { writeFileSync } from "node:fs";
import { buildEpub } from "../../tests/reading/epub/fixture";

const [out, marker = "A synthetic book used to verify the iOS share path."] =
  process.argv.slice(2);

if (!out) {
  console.error("usage: bun scripts/ios-sim/sample-book.ts <out.epub> [marker]");
  process.exit(2);
}

writeFileSync(
  out,
  buildEpub({
    title: "Share Verify Sample",
    docs: [
      { name: "ch1.xhtml", body: `<h1>Chapter One</h1><p>${marker}</p>` },
      { name: "ch2.xhtml", body: "<h1>Chapter Two</h1><p>Second chapter.</p>" },
    ],
    toc: [
      { label: "Chapter One", href: "ch1.xhtml" },
      { label: "Chapter Two", href: "ch2.xhtml" },
    ],
  }),
);
console.log(`wrote ${out}`);
