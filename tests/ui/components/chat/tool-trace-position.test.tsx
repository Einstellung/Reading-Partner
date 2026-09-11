// Where the tool-call trace is drawn in a reply (src/ui/components/chat/chat.tsx).
// A tool round interrupts the reply: what the model wrote before calling the tool
// stays where the reader read it, the status line is drawn under those words, and
// the next round continues below (docs/pitfall/291). Rendered statically, so the
// assertions are about what reaches the DOM. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../../../../src/ui/components/chat/chat";
import type { ThreadMessage } from "../../../../src/ui/components/chat/types";

const FIRST = "Let me check page four.";
const RUNNING = { name: "read_page", label: "Reading p. 4", state: "running" } as const;

function row(over: Partial<ThreadMessage> = {}): ThreadMessage[] {
  return [{ role: "ai", text: FIRST, ts: 1, ...over }];
}

test("the status line sits under the words the round already wrote", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={row({ streaming: true, tools: [RUNNING] })} />,
  );
  expect(html).toContain(FIRST);
  expect(html.indexOf("Reading p. 4")).toBeGreaterThan(html.indexOf(FIRST));
});

test("both paragraphs stand once the second round has written", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={row({ text: `${FIRST}\n\nThe page argues otherwise.`, streaming: true })} />,
  );
  expect(html).toContain(FIRST);
  expect(html).toContain("The page argues otherwise.");
  expect(html).not.toContain("Reading p. 4");
});

test("a tool that ran before any words stands in for the dots", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={row({ text: "", streaming: true, tools: [RUNNING] })} />,
  );
  expect(html).toContain("Reading p. 4");
  expect(html).not.toContain('aria-label="Thinking"');
});

test("the line a failed call leaves stays under the answer", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={row({ tools: [{ name: "search", label: "Searching", state: "error" }] })}
    />,
  );
  expect(html.indexOf("Searching")).toBeGreaterThan(html.indexOf(FIRST));
  expect(html).toContain("text-destructive");
});
