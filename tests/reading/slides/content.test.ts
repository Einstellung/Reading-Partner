// Unit tests for slide-fragment sanitization (src/reading/slides/content.ts). Run: bun test.

import { expect, test } from "bun:test";
import { contentSystemPrompt, contentUserMessage, sanitizeFragment } from "../../../src/reading/slides/content";
import type { SlideRun } from "../../../src/reading/slides/types";
import { languageInstruction } from "../../../src/platform/app/settings";

test("sanitizeFragment strips scripts, styles, and event handlers", () => {
  const out = sanitizeFragment(
    '<h2 onclick="alert(1)">Hi</h2><script>steal()</script><style>*{}</style>',
  );
  expect(out).toContain("<h2>Hi</h2>");
  expect(out).not.toContain("script");
  expect(out).not.toContain("onclick");
  expect(out).not.toContain("<style");
});

test("sanitizeFragment removes external URLs but keeps data: URLs", () => {
  const out = sanitizeFragment(
    '<a href="https://evil.test">x</a><img src="https://cdn.test/a.png"><img src="data:image/png;base64,AAA">',
  );
  expect(out).not.toContain("https://evil.test");
  expect(out).not.toContain("cdn.test");
  expect(out).toContain("data:image/png;base64,AAA");
});

test("sanitizeFragment drops markdown code fences", () => {
  const out = sanitizeFragment('```html\n<h2>Clean</h2>\n```');
  expect(out).toBe("<h2>Clean</h2>");
});

test("sanitizeFragment preserves the asset placeholders", () => {
  const out = sanitizeFragment('<div class="figwrap"><!--illustration--></div>');
  expect(out).toContain("<!--illustration-->");
  const out2 = sanitizeFragment("<div><!--figure--></div>");
  expect(out2).toContain("<!--figure-->");
});

test("sanitizeFragment removes iframes and their content", () => {
  const out = sanitizeFragment('<p>ok</p><iframe src="https://x.test"></iframe>');
  expect(out).toContain("<p>ok</p>");
  expect(out).not.toContain("iframe");
});

test("contentUserMessage relays the slide meta, asset slot, and notes", () => {
  const slide: SlideRun = {
    index: 3,
    title: "The result",
    kind: "content",
    contentStatus: "pending",
    assetStatus: "pending",
    illustration: { prompt: "a graph rising" },
  };
  const msg = contentUserMessage(slide, "chapter note text");
  expect(msg).toContain('Title: "The result"');
  expect(msg).toContain("illustration slot");
  expect(msg).toContain("a graph rising");
  expect(msg).toContain("chapter note text");
});

test("contentUserMessage handles a slide with no notes", () => {
  const slide: SlideRun = { index: 1, title: "Opening", kind: "title", contentStatus: "pending" };
  expect(contentUserMessage(slide, "")).toContain("No source notes");
});

// The reader's own points come from the rehearsal (docs/31) and reach this stage
// without having gone through the plan call's wording. They are what the slide
// says; the chapter notes under them are only background for filling them out.
test("contentUserMessage carries the reader's points verbatim, above the notes", () => {
  const slide: SlideRun = { index: 2, title: "Openings", kind: "content", contentStatus: "pending" };
  const points = ["the 1962 data does the work", "and nothing else does"];
  const msg = contentUserMessage(slide, "chapter note text", undefined, points);
  for (const p of points) expect(msg).toContain(`- ${p}`);
  expect(msg.indexOf(points[0])).toBeLessThan(msg.indexOf("chapter note text"));
  expect(msg).toContain("do not replace it with your own");
  expect(msg).toContain("not a second source of points");
});

// A rehearsed chapter may have no note at all; the points still carry the slide,
// so it must not be told it has nothing to write from.
test("a slide with points and no notes is not told it has no material", () => {
  const slide: SlideRun = { index: 2, title: "Openings", kind: "content", contentStatus: "pending" };
  const msg = contentUserMessage(slide, "", undefined, ["it ends where it started"]);
  expect(msg).toContain("it ends where it started");
  expect(msg).not.toContain("No source notes");
});

// Against languageInstruction rather than a retyped copy of its wording — see
// the note in slides/plan.test.ts.
test("contentSystemPrompt appends the output-language instruction only when set", () => {
  const base = contentSystemPrompt("auto");
  expect(contentSystemPrompt("es")).toBe(`${base}\n\n${languageInstruction("es")}`);
  expect(contentSystemPrompt()).toBe(base);
});
