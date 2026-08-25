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
const keys = read("ui/components/base/chat-scale-keys.ts");
const chat = read("ui/components/chat/chat.tsx");
const callView = read("ui/components/chat/CallView.tsx");
const talkView = read("ui/components/retell/TalkView.tsx");
const infoCall = read("ui/components/info/InfoCall.tsx");
const markdown = read("ui/components/markdown/MarkdownRenderer.tsx");

test("the scope publishes the variable and takes the gestures", () => {
  expect(scope).toContain("'--chat-scale'");
  // Passive listeners cannot preventDefault, and React's onWheel is passive:
  // the browser would zoom the whole app instead of this column.
  expect(scope).toContain("{ passive: false }");
  expect(scope).toContain("addEventListener('wheel'");
  // The event's own unit, not an assumption that it is pixels.
  expect(scope).toContain("e.deltaMode");
  expect(scope).toContain("bindZoomKeys(window");
  expect(keys).toContain("addEventListener('keydown'");
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

test("a surface can stay out, and the phone's does", () => {
  // The phone reaches CallView through InfoCall and has neither gesture, so
  // what it would get is a non-passive wheel listener and nothing else.
  expect(callView).toContain("scalable = true");
  expect(infoCall).toContain("scalable={false}");
});

test("the composer's height cap is CSS, so it grows with the type", () => {
  // Held as a JS constant the cap does not move, and a bigger font inside a
  // fixed box is fewer lines the more the reader zooms in.
  expect(chat).toContain("max-h-[calc(10rem*var(--chat-scale,1))]");
  expect(chat).toContain("getComputedStyle");
  expect(chat).not.toMatch(/maxHeight = pill/);
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
  // An arbitrary font size brings no line height with it, where the named size
  // it replaced did, so each one states its own. The prose row is not here: its
  // leading comes from the markdown root inside it.
  for (const pair of [
    "text-[calc(0.875rem*var(--chat-scale,1))] leading-[1.43]",
    "text-[calc(13px*var(--chat-scale,1))] leading-[1.85]",
    "text-[calc(15px*var(--chat-scale,1))] leading-[1.87]",
    "text-[calc(1rem*var(--chat-scale,1))] leading-[1.75]",
    "text-[max(16px,calc(1rem*var(--chat-scale,1)))] leading-[1.5]",
  ]) {
    expect(chat).toContain(pair);
  }
});

test("the space between rows follows the type", () => {
  // A rem gap is measured against the root font size: at 1.8x the type would
  // have grown and the rows would sit as close together as they do at 1x.
  expect(chat).toContain("gap-[calc(1.5rem*var(--chat-scale,1))]");
  expect(chat).not.toContain("gap-6");
});

test("the corner bubble's own size is left where it was", () => {
  // The small size is the bubble's, which does not zoom: 13px body, 11px
  // notice, 12px trace.
  expect(chat).toContain("'px-3 py-1.5 text-[13px] leading-relaxed'");
  expect(chat).toContain("text-[11px] leading-relaxed");
  expect(chat).toContain("'text-xs'");
  expect(chat).toContain("'gap-3 '");
});

test("markdown is measured against the row, sizes and spacing both", () => {
  // Nothing in the renderer is wrapped and nothing needs to be: every size and
  // every margin in it is em or inherit, so a reply's rhythm holds at 1.8x and
  // in a 12px reader panel alike.
  const absolute = markdown.match(/text-\[\d+(?:\.\d+)?(?:px|rem)\]/g) ?? [];
  expect(absolute).toEqual([]);
  expect(markdown).toContain("text-[inherit]");
  const remSpacing = markdown.match(/\]:!?[mp][trblxy]?-[1-9]/g) ?? [];
  expect(remSpacing).toEqual([]);
});
