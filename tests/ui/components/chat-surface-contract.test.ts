// The chat reading surface is three tinted layers plus a white composer, and
// the whole effect is the difference between them: any one of the four drifting
// back to a neutral grey or to plain white flattens it.
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

test("the window, the user bubble and code blocks sit on the tokens", () => {
  expect(callView).toContain("flex-col bg-chat-surface");
  expect(callView).not.toContain("bg-white");
  expect(chat).toContain("rounded-2xl bg-chat-bubble");
  expect(markdown).toContain("[&_pre]:bg-chat-code");
});

test("the composer stays white so it lifts off the window", () => {
  expect(chat).toContain("rounded-3xl border border-black/10 bg-white");
});
