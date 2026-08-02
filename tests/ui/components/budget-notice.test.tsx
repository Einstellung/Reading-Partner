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

test("a refusal is a failed turn, in the failure style", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={[{ role: "ai", text: "This material is too large", ts: 1, failed: true }]} />,
  );
  expect(html).toContain("This material is too large");
  expect(html).toContain("text-destructive");
});
