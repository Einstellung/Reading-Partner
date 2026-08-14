// The wiring the chat zoom is, read off the source. The arithmetic has its own
// unit file; what no unit can see is whether the two maximized windows publish
// the variable at all, whether the rows and the column widths read it, and
// whether the corner bubble was dragged along with them.
//
// Source text rather than a render: what is being checked is Tailwind classes
// and a CSS variable, and jsdom resolves neither calc() nor var(). Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");

// Comments out, the way primitive-contract reads its files: these say what they
// are doing and why, so a class name being argued about in prose would answer a
// search for the class name itself.
function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const scope = read("ui/components/base/ChatScaleScope.tsx");
const chat = read("ui/components/chat/chat.tsx");
const callView = read("ui/components/chat/CallView.tsx");
const talkView = read("ui/components/talk/TalkView.tsx");
const markdown = read("ui/components/markdown/MarkdownRenderer.tsx");

test("the scope publishes the variable and takes the gestures", () => {
  expect(scope).toContain("'--chat-scale'");
  // Passive listeners cannot preventDefault, and React's onWheel is passive:
  // the browser would zoom the whole app instead of this column.
  expect(scope).toContain("{ passive: false }");
  expect(scope).toContain("addEventListener('keydown'");
});

test("both maximized windows are wrapped, and on the same value", () => {
  for (const source of [callView, talkView]) {
    expect(source).toContain("ChatScaleScope");
    // The column has to widen with the type: at 1.8x a fixed 48rem column is a
    // dozen words a line, which is the layout this exists to avoid.
    expect(source).not.toMatch(/max-w-3xl/);
    expect(source).toContain("max-w-[calc(48rem*var(--chat-scale,1))]");
  }
});

test("the message rows read the variable instead of importing the scale", () => {
  // A row that imported the store would be a row that cannot be rendered
  // outside one, and the corner bubble renders the same component.
  expect(chat).not.toContain("useChatScale");
  expect(chat).not.toContain("ChatScaleScope");
  expect(chat).toContain("text-[calc(1rem*var(--chat-scale,1))]");
  // Every scaled size, so a later edit cannot quietly pin one of them back.
  const scaled = chat.match(/text-\[[^\]]*var\(--chat-scale,1\)[^\]]*\]/g) ?? [];
  expect(scaled.length).toBeGreaterThanOrEqual(5);
});

test("the composer keeps its 16px floor inside the scaled size", () => {
  // Below 16px a focused field makes WKWebView zoom the whole page, and the
  // minimum scale would put it at 14.4px. A coarse:text-[16px] override would
  // outrank the scaled size and pin the field there on a tablet instead.
  expect(chat).toContain("text-[max(16px,calc(1rem*var(--chat-scale,1)))]");
  expect(chat).not.toContain("outline-none coarse:text-[16px]");
});

test("the scaled sizes carry unitless line heights", () => {
  // leading-7 is 1.75rem, measured against the root font size: it would stay
  // put while the type around it grew, and the lines would close up.
  for (const size of ["text-base leading-7", "text-[13px] leading-6", "text-[15px] leading-7"]) {
    expect(chat).not.toContain(size);
  }
});

test("the corner bubble's own size is left where it was", () => {
  // The small size is the bubble's, which does not zoom: 13px body, 11px
  // notice, 12px trace.
  expect(chat).toContain("'px-3 py-1.5 text-[13px] leading-relaxed'");
  expect(chat).toContain("text-[11px] leading-relaxed");
  expect(chat).toContain("'text-xs'");
});

test("markdown sizes are relative, so a reply's headings and code follow", () => {
  // Nothing in the renderer is wrapped, and nothing needs to be: every size in
  // it is em or inherit, so the whole reply is measured against the row.
  const absolute = markdown.match(/text-\[\d+(?:\.\d+)?(?:px|rem)\]/g) ?? [];
  expect(absolute).toEqual([]);
  expect(markdown).toContain("text-[inherit]");
});
