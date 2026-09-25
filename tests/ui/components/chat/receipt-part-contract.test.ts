// What a receipt and a dispatch ticket look like in the transcript (docs/72).
//
// The whole effect is the three weights: prose, then the receipt, then the grey
// trace. Either of the two records drifting to the trace's colour makes it one
// more line of the app talking; drifting to the prose's makes it look like
// something the model said. The rule down the left is what separates them from
// both.
//
// Source text rather than a render: these are Tailwind classes and a CSS custom
// property, neither of which jsdom resolves. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../../src");

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

const receipt = read("ui/components/chat/ReceiptPart.tsx");
const dispatch = read("ui/components/chat/DispatchPart.tsx");
const chat = read("ui/components/chat/MessageList.tsx");

test("a receipt sits between the trace and the prose in weight", () => {
  // The trace is neutral-400 and the prose neutral-800 (MessageList.tsx).
  expect(receipt).toContain("text-neutral-600");
  expect(receipt).toContain("text-neutral-500");
  expect(receipt).not.toContain("text-neutral-400");
  // And between them in size, at both list scales.
  expect(receipt).toContain("text-[calc(0.9375rem*var(--chat-scale,1))]");
  expect(receipt).toContain("text-[12.5px]");
});

test("both records are drawn in the same frame, with the rule down the left", () => {
  expect(receipt).toContain("border-l-2 border-border");
  expect(dispatch).toContain("ReceiptFrame");
  expect(dispatch).toContain("receiptText");
  // One border token, not a hand-picked grey.
  expect(receipt).not.toMatch(/border-neutral-\d/);
});

test("a receipt only offers a link where the host can go there", () => {
  // The clickable half is the shadcn Button, not a hand-rolled anchor: the touch
  // target is in the size table (ui/button.tsx) and not at this call site.
  expect(receipt).toContain('from \'../ui/button\'');
  expect(receipt).toContain('variant="link"');
  expect(receipt).not.toContain("<a ");
  // Which link kinds are walkable is MessageList.tsx's call, and today it is the book.
  expect(chat).toContain("p.receipt.link?.kind === 'book'");
});

test("a ticket reads the run live and needs the answer to be in this thread", () => {
  expect(dispatch).toContain("useSyncExternalStore");
  expect(dispatch).toContain("watch.subscribe");
  expect(dispatch).toContain("useDeliveredRuns");
  expect(dispatch).toContain("Back — see below");
  expect(dispatch).toContain("needs your decision");
  // A failure is the app's one red, the same as a failed call in the trace.
  expect(dispatch).toContain("text-destructive");
});

test("the records are drawn under the words and above the trace", () => {
  const body = chat.slice(chat.indexOf("const MessageBubble"));
  const tickets = body.indexOf("{tickets}\n\t\t\t{/* Under the words");
  expect(tickets).toBeGreaterThan(0);
  expect(body.indexOf("<Markdown text={textPart.text} />")).toBeLessThan(tickets);
  // And the list publishes the way back down to a delivered answer.
  expect(chat).toContain("DeliveredRunsContext.Provider");
  expect(chat).toContain("data-origin-run={message.origin?.runId}");
});
