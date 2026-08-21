// The status line above a conversation (docs/09): the wording it composes, and
// that the row is absent — not empty — when it has nothing to say. The pills that
// used to sit in this slot were a mode switch; this is a statement of what the AI
// is holding, with one control on it. Two things share the row, the chapter focus
// and how far preparation has got, and either one alone draws it. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import ChapterFocusBar from "../../../src/ui/components/chat/ChapterFocusBar";
import { chapterFocusLabel, prepProgressLabel } from "../../../src/ui/components/chat/chapterFocus";

test("names the chapter and its page range", () => {
  expect(
    chapterFocusLabel({ chapter: "Chapter 3 Coding Attention Mechanisms", firstPage: 64, lastPage: 107 }),
  ).toBe("Chapter 3 Coding Attention Mechanisms · p.64-107");
});

test("a one-page chapter is one page, not a range of itself", () => {
  expect(chapterFocusLabel({ chapter: "Preface", firstPage: 9, lastPage: 9 })).toBe("Preface · p.9");
});

// The chapter table is what carries the pages, and it is not always available
// (docs/09: fewer than three usable entries and there is no table at all). The
// chapter still has a name.
test("an unknown page range leaves the chapter named on its own", () => {
  expect(chapterFocusLabel({ chapter: "Chapter 3" })).toBe("Chapter 3");
  expect(chapterFocusLabel({ chapter: "Chapter 3", firstPage: 64 })).toBe("Chapter 3");
});

test("no chapter is no line", () => {
  expect(chapterFocusLabel({})).toBeNull();
  expect(chapterFocusLabel({ chapter: null, firstPage: 64, lastPage: 107 })).toBeNull();
  expect(chapterFocusLabel({ chapter: "   " })).toBeNull();
});

test("the row renders nothing at all with neither a focus nor a run", () => {
  expect(renderToStaticMarkup(<ChapterFocusBar />)).toBe("");
  expect(renderToStaticMarkup(<ChapterFocusBar firstPage={64} lastPage={107} />)).toBe("");
  expect(renderToStaticMarkup(<ChapterFocusBar prep={null} />)).toBe("");
});

// Preparation runs on the book and can be going long before any chapter is in
// focus — the entry starts it on a book the reader has never marked — so the
// count alone has to be able to draw the row.
test("a run with no chapter focus still draws the row", () => {
  const html = renderToStaticMarkup(<ChapterFocusBar prep={{ done: 5, total: 12 }} />);
  expect(html).toContain("Preparing 5/12");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("·");
});

test("a focus and a run share one row", () => {
  const html = renderToStaticMarkup(
    <ChapterFocusBar chapter="Chapter 3" firstPage={64} lastPage={107} prep={{ done: 5, total: 12 }} />,
  );
  expect(html).toContain("Chapter 3 · p.64-107");
  expect(html).toContain("· Preparing 5/12");
});

test("the count reads in whole items, and says so before it knows how many", () => {
  expect(prepProgressLabel({ done: 5, total: 12 })).toBe("Preparing 5/12");
  expect(prepProgressLabel({ done: 12, total: 12 })).toBe("Preparing 12/12");
  // The planning phase: a run has started and has no list yet. Silence here
  // would make the line show up a minute after the reader triggered it.
  expect(prepProgressLabel({ done: 0, total: 0 })).toBe("Preparing…");
});

// Nothing running is nothing said. There is no finished wording, because the
// caller stops passing a progress the moment the run stops.
test("no run is no words about preparation", () => {
  expect(prepProgressLabel(null)).toBeNull();
  expect(prepProgressLabel(undefined)).toBeNull();
});

test("the focus is stated, and clearing it is the only control offered", () => {
  const withClear = renderToStaticMarkup(
    <ChapterFocusBar chapter="Chapter 3" firstPage={64} lastPage={107} onClear={() => {}} />,
  );
  expect(withClear).toContain("Chapter 3 · p.64-107");
  expect(withClear).toContain('aria-label="Clear chapter focus"');
  expect(withClear.match(/<button/g)?.length).toBe(1);

  // Read-only host: the line still states the focus, with nothing to press.
  const readOnly = renderToStaticMarkup(<ChapterFocusBar chapter="Chapter 3" firstPage={64} lastPage={107} />);
  expect(readOnly).toContain("Chapter 3 · p.64-107");
  expect(readOnly).not.toContain("<button");
});

// docs/09: classroom stopped being a mode, so there is no switch for it and no
// replacement switch either. Source text, because what is being asserted is the
// absence of props no caller passes any more.
test("the call carries the focus line and no mode switches", () => {
  const callView = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../src/ui/components/chat/CallView.tsx"),
    "utf8",
  );
  expect(callView).toContain("ChapterFocusBar");
  for (const gone of ["classroom", "Classroom", "rehearsal", "Rehearsal"]) {
    expect(callView).not.toContain(gone);
  }
});
