// Unit tests for slide-fragment sanitization (src/slides/content.ts). Run: bun test.

import { expect, test } from "bun:test";
import { contentUserMessage, sanitizeFragment } from "../../src/slides/content";
import type { SlideRun } from "../../src/slides/types";

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
