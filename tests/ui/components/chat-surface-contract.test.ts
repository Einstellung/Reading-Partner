// The chat reading surface is three tinted layers plus a white composer, and
// the whole effect is the difference between them: any one of the four drifting
// back to a neutral grey or to plain white flattens it.
//
// The tint is also scoped. The user bubble and the code block are rendered by
// components the corner bubble, RetellView and the reader panels also use, and
// those stay white, so the two colours travel as variables the CallView root
// sets and everything else defaults away from. Applying either as a plain class
// is what this file exists to catch.
//
// Source text rather than a render: these are Tailwind classes and CSS custom
// properties, neither of which jsdom resolves. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

const styles = read("styles.css");
const callView = read("ui/components/chat/CallView.tsx");
const chat = read("ui/components/chat/chat.tsx");
const markdown = read("ui/components/markdown/MarkdownRenderer.tsx");

test("the three surface tokens are declared and mapped to utilities", () => {
  expect(styles).toContain("--chat-surface: #fcfcfb;");
  expect(styles).toContain("--chat-bubble: #f2f0ec;");
  expect(styles).toContain("--chat-code: #f7f5f1;");
  // Without the @theme inline entry the variable exists and `bg-chat-surface`
  // is simply never generated, which fails as an unstyled element rather than
  // as an error (docs/30).
  expect(styles).toContain("--color-chat-surface: var(--chat-surface);");
  expect(styles).toContain("--color-chat-bubble: var(--chat-bubble);");
  expect(styles).toContain("--color-chat-code: var(--chat-code);");
});

test("the window takes the tint and hands the other two down", () => {
  expect(callView).toContain("flex-col bg-chat-surface");
  expect(callView).not.toContain("bg-white");
  expect(callView).toContain("[--chat-bubble-bg:var(--chat-bubble)]");
  expect(callView).toContain("[--chat-code-bg:var(--chat-code)]");
});

test("the bubble and the code block read the variable, with a palette fill as default", () => {
  // The default is a token rather than a Tailwind neutral: the fallback is what
  // paints the corner bubble and the reader panels, and a fixed grey there is a
  // cold patch on the paper tint.
  expect(chat).toContain("bg-[var(--chat-bubble-bg,var(--color-muted-soft))]");
  expect(markdown).toContain("[&_pre]:bg-[var(--chat-code-bg,var(--color-muted-faint))]");
  // A bare token class here would repaint the corner bubble, RetellView and the
  // reader panels along with the call window.
  expect(chat).not.toContain("bg-chat-bubble ");
  expect(markdown).not.toContain("bg-chat-code");
});

test("the composer stays on the page colour so it lifts off the window", () => {
  // --background, not white: on the paper tint the page colour is cream and a
  // white composer would be the one white rectangle left on the screen. The
  // step it needs is off --chat-surface, which moves with it.
  expect(chat).toContain("rounded-3xl border border-black/10 bg-background");
});
