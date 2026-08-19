// Selecting words out of a reply to open a side conversation on them
// (src/ui/components/chat/chat.tsx). The rule about which rows may offer it is
// pure and tested in tests/reading/aside.test.ts; what needs a document is the
// wiring — that the marker only lands on the rows the rule allows, that a
// selection inside one raises the control with the words it caught, and that the
// control acts before the selection can collapse under it.
//
// Run: bun test.
import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { MessageList } from "../../../src/ui/components/chat/chat";
import type { AsideAnchor } from "../../../src/platform/app/threads";
import type { ThreadMessage } from "../../../src/ui/components/chat/types";
import { useDom } from "../../support/dom";

const { act, cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const REPLY = "attention heads are three matrices";

const messages: ThreadMessage[] = [
  { role: "user", text: "what does a head do?", ts: 1 },
  { role: "ai", text: REPLY, ts: 2 },
];

function textNodeHolding(root: HTMLElement, text: string): Node {
  const node = [...root.querySelectorAll("*")]
    .flatMap((el) => [...el.childNodes])
    .find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").includes(text));
  if (!node) throw new Error(`no text node holding ${JSON.stringify(text)}`);
  return node;
}

// Put the selection over a range, the way a drag or a long press would, and let
// the listener see it.
async function applyRange(range: Range): Promise<void> {
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Select `text` wherever it appears inside `root`.
async function select(root: HTMLElement, text: string): Promise<void> {
  const node = textNodeHolding(root, text);
  const at = (node.textContent ?? "").indexOf(text);
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

function control(): HTMLElement | null {
  return document.body.querySelector("button.anchor-safe");
}

test("only settled replies carry the marker, and only in the lesson", () => {
  const streaming: ThreadMessage[] = [...messages, { role: "ai", text: "half a s", ts: 3, streaming: true }];
  const lesson = render(createElement(MessageList, { messages: streaming, onOpenAside: () => {} }));
  const marked = lesson.container.querySelectorAll("[data-aside-ts]");
  expect([...marked].map((el) => el.getAttribute("data-aside-ts"))).toEqual(["2"]);
  cleanup();

  // No handler is how a surface says it offers none: the corner bubble, the info
  // chat, the talk, and any conversation that is already a side one.
  const elsewhere = render(createElement(MessageList, { messages }));
  expect(elsewhere.container.querySelectorAll("[data-aside-ts]")).toHaveLength(0);
});

test("a selection inside a reply raises the control, and it opens on those words", async () => {
  const opened: AsideAnchor[] = [];
  const view = render(
    createElement(MessageList, { messages, onOpenAside: (a: AsideAnchor) => void opened.push(a) }),
  );
  expect(control()).toBeNull();

  await select(view.container, "three matrices");
  const button = control();
  expect(button).not.toBeNull();

  // pointerdown, not click: on a tap the click arrives after the selection has
  // collapsed, and this exists only while there is one.
  await act(async () => {
    fireEvent.pointerDown(button!);
  });
  expect(opened).toEqual([{ messageTs: 2, text: "three matrices" }]);
});

// Everything captured has to be words the model wrote. The row also holds the
// budget notice and the tool trace kept for a failed call, which are the app's
// words about the turn; a drag that started in the reply and carried on into one
// of them used to be accepted, and Selection.toString() handed back both
// concatenated — half of a span the prompt then presents as what the reader
// picked out of the answer.
test("a selection that runs past the end of the reply captures nothing", async () => {
  const opened: AsideAnchor[] = [];
  const withNotice: ThreadMessage[] = [
    { role: "ai", text: REPLY, ts: 2, notice: "Chapter 4 was left out to fit" },
  ];
  const view = render(
    createElement(MessageList, {
      messages: withNotice,
      onOpenAside: (a: AsideAnchor) => void opened.push(a),
    }),
  );

  await selectFromTo(view.container, "three matrices", "left out to fit");
  expect(document.getSelection()!.toString()).toContain("left out to fit");
  expect(control()).toBeNull();
  expect(opened).toEqual([]);

  // The same drag stopped at the end of the reply is offered, and what it caught
  // is the reply's own words.
  await select(view.container, "three matrices");
  expect(control()).not.toBeNull();
});

test("a selection in the reader's own message raises nothing", async () => {
  const view = render(createElement(MessageList, { messages, onOpenAside: () => {} }));
  await select(view.container, "what does a head");
  expect(control()).toBeNull();
});

test("clearing the selection takes the control with it", async () => {
  const view = render(createElement(MessageList, { messages, onOpenAside: () => {} }));
  await select(view.container, "three matrices");
  expect(control()).not.toBeNull();
  await act(async () => {
    document.getSelection()!.removeAllRanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(control()).toBeNull();
});
