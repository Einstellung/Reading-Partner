// A DOMParser for bun, so the tests run the sanitizer the app runs instead of a
// second implementation of it. bun has no DOM; the webview has WebKit's. jsdom
// parses with parse5, the same HTML5 tree construction spec WebKit implements,
// so a tree walked here is the tree walked on the device.
//
// Not tests/support/dom.ts, and not a substitute for it: that one stands a whole
// window up for one file and takes it down again, because a global window moves
// this codebase onto its browser branch. This one adds a single global, and
// DOMParser is not a branch anything takes — src/ has exactly one reader of it,
// the sanitizer, which is dead without it in every environment.
//
// Test-only: jsdom is a devDependency and nothing under src/ imports it. Import
// this module for its side effect from any test that reaches
// sanitizeArticleHtml — directly or through parseSavedArticles, the briefing
// reader, or anything else that renders a stored body.
//
// The output of the sanitizer is never judged by this DOM. Assertions go
// through HTMLRewriter (lol-html), which reads a string the way a browser's
// tokenizer does; see tests/info/sanitize.test.ts.

import { JSDOM } from "jsdom";

if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === "undefined") {
  (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM("").window.DOMParser;
}

export {};
