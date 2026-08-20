// The shell's wiring (src/App.tsx), where the last round's bugs were.
//
// Everything under it was right: the pure decisions had tests, the session hook
// had tests, and all of them were green while the app did the wrong thing —
// because App.tsx listed the arguments by hand at each door and left one out.
// A `.tsx` this size cannot be rendered in a test (it opens files, drives the
// engine, talks to a model), so what is pinned here is its source: that each
// door hands over the whole thing rather than a list of fields, which is the
// only shape that cannot lose one.
//
// Source text, like tests/ui/components/chat-surface-contract.test.ts. What each
// handoff then produces is tested where it runs:
// tests/reading/session/use-call-reopen.test.tsx (the reopened conversation),
// tests/ui/components/chat-pen-strokes.test.tsx (the stroke a reply reports).
//
// Run: bun test.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/App.tsx"),
  "utf8",
);

// One top-level `const name = …` declaration, up to the next one.
function decl(name: string): string {
  const from = app.indexOf(`  const ${name} = `);
  expect(from).toBeGreaterThan(-1);
  const next = app.indexOf("\n  const ", from + 1);
  return app.slice(from, next < 0 ? app.length : next);
}

// A conversation that already exists is reopened as itself, from its record.
// Handing in a thread id and the mark the reader pressed is what opened the
// book's conversation as an ordinary one and anchored it on a sentence out of
// one of its replies (reading/reopen.ts).
const DOORS = [
  "onSetAnnotationPopup", // a mark on the page
  "openChatMark", // a mark on a reply
  "onTraceSelect", // a row of the trace list
  "openThreadForAnnotation", // the sparkle button beside a row
  "openAsideThread", // the receipt chip in a transcript
  "openBookThread", // the top bar's blackboard
];

test("every door back into a conversation hands over its record", () => {
  for (const door of DOORS) {
    const body = decl(door);
    expect(body).toContain("reopenThreadCall(");
    // Not one field of the identity picked out by hand at the door.
    expect(body).not.toMatch(/(?<![A-Za-z])openThreadCall\(/);
    expect(body).not.toContain("isBook");
  }
});

test("the only conversation opened field by field is one that has no record yet", () => {
  // The brand-new thread an AI-pen stroke on the page creates, written down in
  // the same breath. Every other openThread call would be reopening something.
  expect(app.match(/(?<![A-Za-z])openThreadCall\(/g)).toHaveLength(1);
  // Which of the three kinds a conversation is is derived in one place, and
  // that place is not here.
  expect(app).not.toContain("isBook: true");
});

