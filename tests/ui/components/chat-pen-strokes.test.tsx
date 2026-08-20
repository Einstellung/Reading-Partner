// Drawing on a reply with the pen the top bar has selected
// (src/ui/components/chat/chat.tsx). Which rows may be drawn on is pure and
// tested in tests/reading/chat-marks.test.ts; what needs a document is the
// wiring — that the marker only lands on the rows the rule allows, that a
// stroke is taken when the finger comes off and names exactly the words it
// caught, and that the surfaces which are not the book's take no stroke at all.
//
// Run: bun test.
import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { MessageList, type ChatMarkHost } from "../../../src/ui/components/chat/chat";
import type { ChatMarkDraw } from "../../../src/reading/chat-marks";
import type { ThreadMessage } from "../../../src/ui/components/chat/types";
import { useDom } from "../../support/dom";

const { act, cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const REPLY = "attention heads are three matrices";

const messages: ThreadMessage[] = [
  { role: "user", text: "what does a head do?", ts: 1 },
  { role: "ai", text: REPLY, ts: 2 },
];

// A host in the shape App builds for the classroom, with the strokes it takes
// collected.
function host(pen: ChatMarkHost["pen"], drawn: ChatMarkDraw[]): ChatMarkHost {
  return {
    threadId: "lesson",
    pen,
    color: "#ffd400",
    marks: [],
    onDraw: (draw) => void drawn.push(draw),
    onOpen: () => {},
  };
}

function textNodeHolding(root: HTMLElement, text: string): Node {
  const node = [...root.querySelectorAll("*")]
    .flatMap((el) => [...el.childNodes])
    .find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").includes(text));
  if (!node) throw new Error(`no text node holding ${JSON.stringify(text)}`);
  return node;
}

async function applyRange(range: Range): Promise<void> {
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Select `text` wherever it appears inside `root`, the way a drag would.
async function select(root: HTMLElement, text: string, from = 0): Promise<void> {
  const node = textNodeHolding(root, text);
  const at = (node.textContent ?? "").indexOf(text, from);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + text.length);
  await applyRange(range);
}

// A drag that starts inside the reply and carries on past its end, which is what
// a finger does.
async function selectFromTo(root: HTMLElement, from: string, to: string): Promise<void> {
  const start = textNodeHolding(root, from);
  const end = textNodeHolding(root, to);
  const range = document.createRange();
  range.setStart(start, (start.textContent ?? "").indexOf(from));
  range.setEnd(end, (end.textContent ?? "").indexOf(to) + to.length);
  await applyRange(range);
}

// The finger comes off. Not selectionchange: a drag changes the selection
// continuously and a mark is one thing.
async function lift(root: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.pointerUp(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("only settled replies carry the marker", () => {
  const streaming: ThreadMessage[] = [
    ...messages,
    { role: "ai", text: "half a s", ts: 3, streaming: true },
    { role: "ai", text: "that failed", ts: 4, failed: true },
  ];
  const view = render(createElement(MessageList, { messages: streaming }));
  const marked = view.container.querySelectorAll("[data-reply-ts]");
  expect([...marked].map((el) => el.getAttribute("data-reply-ts"))).toEqual(["2"]);
});

test("a stroke over a reply is taken when the finger comes off, and the selection goes", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = render(
    createElement(MessageList, { messages, marks: host("highlight", drawn) }),
  );

  await select(view.container, "three matrices");
  // Still nothing: the drag is not the stroke.
  expect(drawn).toEqual([]);

  await lift(view.container);
  expect(drawn).toEqual([{ messageTs: 2, text: "three matrices", occurrence: 0, pen: "highlight" }]);
  // The words are marked now; leaving them blue leaves WebKit's callout bar
  // over them too.
  expect(document.getSelection()?.isCollapsed).toBe(true);
});

test("the pen the top bar has selected is the pen that is recorded", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = render(createElement(MessageList, { messages, marks: host("ai", drawn) }));
  await select(view.container, "attention heads");
  await lift(view.container);
  expect(drawn.map((d) => d.pen)).toEqual(["ai"]);
});

test("the pointer draws nothing at all", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = render(createElement(MessageList, { messages, marks: host(null, drawn) }));
  await select(view.container, "three matrices");
  await lift(view.container);
  expect(drawn).toEqual([]);
});

// No host is how a surface says a reply there is not the book continued: the
// info chat, the talk, the corner bubble over a page the pen is aimed at.
test("a chat with no marks host takes no stroke", async () => {
  const view = render(createElement(MessageList, { messages }));
  await select(view.container, "three matrices");
  await lift(view.container);
  // Nothing to assert but that it did not throw and marked nothing: there is no
  // host to have heard about it.
  expect(view.container.querySelectorAll("[data-chat-mark]")).toHaveLength(0);
});

// Everything captured has to be words the model wrote. The row also holds the
// budget notice and the tool trace kept for a failed call, which are the app's
// words about the turn.
test("a stroke that runs past the end of the reply catches nothing", async () => {
  const drawn: ChatMarkDraw[] = [];
  const withNotice: ThreadMessage[] = [
    { role: "ai", text: REPLY, ts: 2, notice: "Chapter 4 was left out to fit" },
  ];
  const view = render(
    createElement(MessageList, { messages: withNotice, marks: host("underline", drawn) }),
  );

  await selectFromTo(view.container, "three matrices", "left out to fit");
  await lift(view.container);
  expect(drawn).toEqual([]);
});

// Which copy of a repeated phrase was drawn over is the whole of what lets the
// mark be put back in the right place.
test("a repeated phrase records which copy was drawn over", async () => {
  const repeated: ThreadMessage[] = [{ role: "ai", text: "a head is a head", ts: 7 }];
  const drawn: ChatMarkDraw[] = [];
  const view = render(
    createElement(MessageList, { messages: repeated, marks: host("underline", drawn) }),
  );

  await select(view.container, "a head", 1);
  await lift(view.container);
  expect(drawn).toEqual([{ messageTs: 7, text: "a head", occurrence: 1, pen: "underline" }]);
});
