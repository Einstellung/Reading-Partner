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

// Select `text` wherever it appears inside `root`, the way a drag or a long
// press would, and let the listener see it.
async function select(root: HTMLElement, text: string): Promise<void> {
  const node = [...root.querySelectorAll("*")]
    .flatMap((el) => [...el.childNodes])
    .find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").includes(text));
  if (!node) throw new Error(`no text node holding ${JSON.stringify(text)}`);
  const at = (node.textContent ?? "").indexOf(text);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + text.length);
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
