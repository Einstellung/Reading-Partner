// The end-of-reply budget notice (src/ui/components/chat/chat.tsx): the line
// that says what a turn had to leave out of the model's view to fit the context
// window. It is not a failure and must not read as one — no error color, no
// toast, and it never joins the reply's own text. Rendered statically, so the
// assertions are about what actually reaches the DOM. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../../../src/ui/components/chat/chat";
import type { ThreadMessage } from "../../../src/ui/components/common/types";

const NOTICE = "Note: earlier turns of this conversation were left out to make room.";

function reply(over: Partial<ThreadMessage> = {}): ThreadMessage[] {
  return [{ role: "ai", text: "The passage argues that…", ts: 1, ...over }];
}

test("a reply with no notice renders none", () => {
  const html = renderToStaticMarkup(<MessageList messages={reply()} />);
  expect(html).toContain("The passage argues that");
  expect(html).not.toContain("Note:");
});

test("the notice follows the answer as one muted line", () => {
  const html = renderToStaticMarkup(<MessageList messages={reply({ notice: NOTICE })} />);
  expect(html).toContain(NOTICE);
  // After the answer, not before it.
  expect(html.indexOf(NOTICE)).toBeGreaterThan(html.indexOf("The passage argues that"));
  // The vocabulary of a failure is reserved for failures.
  expect(html).not.toContain("text-red");
  expect(html).toContain("text-neutral-400");
});

test("nothing is said while the reply is still streaming", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={reply({ notice: NOTICE, streaming: true })} />,
  );
  expect(html).not.toContain(NOTICE);
});

test("a turn that could not reach the model keeps the failure style", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={[{ role: "ai", text: "⚠️ Couldn't reach the model. fetch failed", ts: 1, failed: true }]}
    />,
  );
  expect(html).toContain("Couldn&#x27;t reach the model");
  expect(html).toContain("text-destructive");
});

// A refusal stops the turn before anything is written, so the notice is the
// whole row (turn-rows.ts). It still is not a failure: same muted line, no error
// color, and no Copy — there are no model words to take.
test("a row that is only a notice renders the notice, not an error", () => {
  const stopped = "Ask about a shorter passage.";
  const html = renderToStaticMarkup(
    <MessageList messages={[{ role: "ai", text: "", ts: 1, notice: stopped }]} />,
  );
  expect(html).toContain(stopped);
  expect(html).toContain("text-neutral-400");
  expect(html).not.toContain("text-destructive");
  expect(html).not.toContain("Copy");
});

// The trace explaining the stop stays above it: the tool calls that errored, and
// none of the ones that ran fine.
test("a notice-only row keeps the failed tool calls above it", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={[
        {
          role: "ai",
          text: "",
          ts: 1,
          notice: "Ask about a shorter passage.",
          tools: [{ name: "probe", label: "probing example.com", state: "error" }],
        },
      ]}
    />,
  );
  expect(html).toContain("probing example.com");
  expect(html.indexOf("probing example.com")).toBeLessThan(html.indexOf("Ask about a shorter"));
});
