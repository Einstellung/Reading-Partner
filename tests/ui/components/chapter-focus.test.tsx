// The chapter-focus status line (docs/09): the wording it composes, and that the
// row is absent — not empty — when the conversation has no chapter focus. The
// pills that used to sit in this slot were a mode switch; this is a statement of
// what the AI is holding, with one control on it. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import ChapterFocusBar from "../../../src/ui/components/chat/ChapterFocusBar";
import { chapterFocusLabel } from "../../../src/ui/components/chat/chapterFocus";

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

test("the row renders nothing at all without a focus", () => {
  expect(renderToStaticMarkup(<ChapterFocusBar />)).toBe("");
  expect(renderToStaticMarkup(<ChapterFocusBar firstPage={64} lastPage={107} />)).toBe("");
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
