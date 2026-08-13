// The end-of-reply budget notice (src/ui/components/chat/chat.tsx): the line
// that says what a turn had to leave out of the model's view to fit the context
// window. It is not a failure and must not read as one — no error color, no
// toast, and it never joins the reply's own text. Rendered statically, so the
// assertions are about what actually reaches the DOM. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../../../src/ui/components/chat/chat";
import { refusalRow } from "../../../src/ui/components/chat/turn-rows";
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
// whole row (turn-rows.ts): the muted line, and no Copy — there are no model
// words to take.
test("a row that is only a notice renders the notice, not an error", () => {
  const stopped = "Ask about a shorter passage.";
  const html = renderToStaticMarkup(
    <MessageList messages={[{ role: "ai", text: "", ts: 1, notice: stopped }]} />,
  );
  expect(html).toContain(stopped);
  expect(html).toContain("text-neutral-400");
  expect(html).not.toContain("Copy");
});

// `failed` and a notice can sit on the same row: refusalRow patches over the row
// as it stands and never clears the mark. When both are there the notice decides
// how the row reads — the app talking about the turn, not a failure — so the
// failure style must not win. This is the assertion the notice-only case above
// cannot make: without a mark set, the error branch is out of reach anyway.
test("a notice keeps its muted line even on a row marked failed", () => {
  const stopped = "Ask about a shorter passage.";
  const failedRow: ThreadMessage = { role: "ai", text: "", ts: 1, failed: true };
  const row: ThreadMessage = { ...failedRow, ...refusalRow(failedRow, stopped) };
  expect(row.failed).toBe(true);
  const html = renderToStaticMarkup(<MessageList messages={[row]} />);
  expect(html).toContain(stopped);
  expect(html).toContain("text-neutral-400");
  expect(html).not.toContain("text-destructive");
});

// The same row with the model's words already on it: they stay, drawn as a reply
// rather than as an error, with the notice under them.
test("words written before the stop are not repainted as a failure", () => {
  const row: ThreadMessage = {
    role: "ai",
    text: "The passage argues that…",
    ts: 1,
    failed: true,
    notice: NOTICE,
  };
  const html = renderToStaticMarkup(<MessageList messages={[row]} />);
  expect(html).toContain("The passage argues that");
  expect(html).toContain(NOTICE);
  expect(html).not.toContain("text-destructive");
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
