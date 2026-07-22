// The Readability-vs-defuddle selection logic (src/info/readable-select.ts).
// The DOM extraction itself runs only in the webview; this is the pure decision
// of which result to keep, which is where the fallback policy lives. Run: bun test.

import { expect, test } from "bun:test";
import { pickExtraction, type Extraction } from "../../src/info/readable-select";

function ex(text: string, tag = "r"): Extraction {
  return { title: tag, contentHtml: `<p>${text}</p>`, textContent: text };
}

test("primary wins when it clears the length bar", () => {
  const primary = ex("x".repeat(800), "readability");
  const fallback = ex("y".repeat(2000), "defuddle");
  expect(pickExtraction(primary, fallback)?.title).toBe("readability");
});

test("fallback wins when primary is short and fallback got more", () => {
  const primary = ex("short body", "readability");
  const fallback = ex("z".repeat(2000), "defuddle");
  expect(pickExtraction(primary, fallback)?.title).toBe("defuddle");
});

test("short primary still beats an even shorter fallback", () => {
  const primary = ex("x".repeat(200), "readability");
  const fallback = ex("tiny", "defuddle");
  expect(pickExtraction(primary, fallback)?.title).toBe("readability");
});

test("null primary falls back; null fallback keeps primary", () => {
  expect(pickExtraction(null, ex("body", "defuddle"))?.title).toBe("defuddle");
  expect(pickExtraction(ex("body", "readability"), null)?.title).toBe("readability");
  expect(pickExtraction(null, null)).toBeNull();
});
