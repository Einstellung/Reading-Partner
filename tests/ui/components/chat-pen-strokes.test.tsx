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
import type { Annotation } from "../../../src/platform/app/reader-contract";
import type { ChatMarkDraw } from "../../../src/reading/chat-marks";
import type { ThreadMessage } from "../../../src/ui/components/chat/types";
import { useDom } from "../../support/dom";

const { act, cleanup, fireEvent, render } = await useDom();

// The selection belongs to the document, not to the tree, so unmounting does not
// drop it and one case's leftover is the next case's starting state. A case that
// selects and gets no stroke for it — the pen path never clears a selection it
// did not commit — leaves one behind, and "the pen made no selection" then reads
// the previous case's.
afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
});

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

// A reply's Markdown is rendered lazily, and until it lands the row shows a
// plain-text fallback. A selection taken against that fallback is thrown away
// the moment the real elements replace it, so every render here waits for the
// swap first — and a stroke is then measured against what a reader would have
// been dragging over.
async function renderChat(messages: ThreadMessage[], marks?: ChatMarkHost) {
  const view = render(
    marks
      ? createElement(MessageList, { messages, marks })
      : createElement(MessageList, { messages }),
  );
  for (let i = 0; i < 20 && view.container.querySelector("[data-reply-body] > span"); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return view;
}

test("only settled replies carry the marker", async () => {
  const streaming: ThreadMessage[] = [
    ...messages,
    { role: "ai", text: "half a s", ts: 3, streaming: true },
    { role: "ai", text: "that failed", ts: 4, failed: true },
  ];
  const view = await renderChat(streaming);
  const marked = view.container.querySelectorAll("[data-reply-ts]");
  expect([...marked].map((el) => el.getAttribute("data-reply-ts"))).toEqual(["2"]);
});

test("a stroke over a reply is taken when the finger comes off, and the selection goes", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host("highlight", drawn));

  await select(view.container, "three matrices");
  // Still nothing: the drag is not the stroke.
  expect(drawn).toEqual([]);

  await lift(view.container);
  expect(drawn).toEqual([{ messageTs: 2, text: "three matrices", occurrence: 0, pen: "highlight" }]);
  // The words are marked now; leaving them blue leaves WebKit's callout bar
  // over them too.
  expect(document.getSelection()?.isCollapsed).toBe(true);
});

// react-markdown leaves a newline text node between most blocks, but nothing at
// all between two table cells: the rendering runs "one" straight into "two", and
// the anchor has to hold exactly that while the trace list, read_annotations and
// the note replayed to the model do not.
test("a stroke across two cells reports the glued words and the readable ones", async () => {
  const drawn: ChatMarkDraw[] = [];
  const table: ThreadMessage[] = [
    { role: "ai", text: "| head | tail |\n| - | - |\n| one | two |", ts: 2 },
  ];
  const view = await renderChat(table, host("underline", drawn));

  await selectFromTo(view.container, "one", "two");
  await lift(view.container);
  expect(drawn).toEqual([
    {
      messageTs: 2,
      text: "onetwo",
      display: "one two",
      occurrence: 0,
      pen: "underline",
    },
  ]);
});

test("the pen the top bar has selected is the pen that is recorded", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host("ai", drawn));
  await select(view.container, "attention heads");
  await lift(view.container);
  expect(drawn.map((d) => d.pen)).toEqual(["ai"]);
});

test("the pointer draws nothing at all", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host(null, drawn));
  await select(view.container, "three matrices");
  await lift(view.container);
  expect(drawn).toEqual([]);
});

// No host is how a surface says a reply there is not the book continued: the
// info chat, the retell, the corner bubble over a page the pen is aimed at.
test("a chat with no marks host takes no stroke", async () => {
  const view = await renderChat(messages);
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
  const view = await renderChat(withNotice, host("underline", drawn));

  await selectFromTo(view.container, "three matrices", "left out to fit");
  await lift(view.container);
  expect(drawn).toEqual([]);
});

// Which copy of a repeated phrase was drawn over is the whole of what lets the
// mark be put back in the right place.
test("a repeated phrase records which copy was drawn over", async () => {
  const repeated: ThreadMessage[] = [{ role: "ai", text: "a head is a head", ts: 7 }];
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(repeated, host("underline", drawn));

  await select(view.container, "a head", 1);
  await lift(view.container);
  expect(drawn).toEqual([{ messageTs: 7, text: "a head", occurrence: 1, pen: "underline" }]);
});

// --- the click that closes the stroke's own drag --------------------------
//
// A drag ends pointerup → mouseup → click, and React has flushed the mark in
// between: by the time the click arrives, the words it lands on carry a mark.
// The selection is no help in telling that click from a press on a mark — the
// pen drops it, which is what leaves WebKit's callout bar off the words — so
// the reader used to get the annotation editor over the sentence they had just
// marked. Marking a reply opens nothing (docs/09).

// happy-dom lays nothing out: a Range reports no client rects, so a mark would
// paint nowhere and no click could hit it. The reply's body gets an origin and
// its ranges one box, which is all measureMarks reads.
const BOX = { left: 10, top: 10, width: 100, height: 16, right: 110, bottom: 26 };
const INSIDE = { clientX: 20, clientY: 15 };

function layOut(): () => void {
  const rects = Range.prototype.getClientRects;
  const box = Element.prototype.getBoundingClientRect;
  Range.prototype.getClientRects = () => [BOX] as unknown as DOMRectList;
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 }) as DOMRect;
  return () => {
    Range.prototype.getClientRects = rects;
    Element.prototype.getBoundingClientRect = box;
  };
}

// The mark the shell writes for a stroke and hands back on the next render,
// which is what makes those words pressable.
function markOf(draw: ChatMarkDraw): Annotation {
  return {
    id: "c1",
    type: draw.pen === "highlight" ? "highlight" : "underline",
    color: "#ffd400",
    text: draw.text,
    chatAnchor: {
      threadId: "lesson",
      messageTs: draw.messageTs,
      text: draw.text,
      occurrence: draw.occurrence,
      pen: draw.pen,
    },
  };
}

function withMarks(marks: Annotation[], opened: Annotation[]): ChatMarkHost {
  return {
    threadId: "lesson",
    pen: "highlight",
    color: "#ffd400",
    marks,
    onDraw: () => {},
    onOpen: (annotation) => void opened.push(annotation),
  };
}

test("the click that closes the drag the pen took as a stroke opens nothing", async () => {
  const restore = layOut();
  try {
    const drawn: ChatMarkDraw[] = [];
    const opened: Annotation[] = [];
    const view = await renderChat(messages, host("highlight", drawn));

    await select(view.container, "three matrices");
    await lift(view.container);
    expect(drawn).toHaveLength(1);

    const body = view.container.querySelector("[data-reply-body]") as HTMLElement;
    await act(async () => {
      view.rerender(
        createElement(MessageList, {
          messages,
          marks: withMarks([markOf(drawn[0])], opened),
        }),
      );
    });
    fireEvent.click(body, INSIDE);

    expect(opened).toEqual([]);
  } finally {
    restore();
  }
});

test("a press on that mark once the finger has gone down again opens it", async () => {
  const restore = layOut();
  try {
    const opened: Annotation[] = [];
    const mark = markOf({ messageTs: 2, text: "three matrices", occurrence: 0, pen: "highlight" });
    const view = await renderChat(messages, withMarks([mark], opened));

    const body = view.container.querySelector("[data-reply-body]") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(body);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(body, INSIDE);

    expect(opened.map((a) => a.id)).toEqual(["c1"]);
  } finally {
    restore();
  }
});

// A stroke arms the gate so the click that closes its own drag is spent on
// saying so. On a touch screen that click often never comes, and one that ends
// over the composer lands nowhere near a reply. Putting the pen back is where
// the reader notices: the next press on an existing mark was swallowed by a
// stroke drawn minutes ago.
test("a stroke whose click never arrives does not swallow the next press on a mark", async () => {
  const restore = layOut();
  try {
    const drawn: ChatMarkDraw[] = [];
    const opened: Annotation[] = [];
    const view = await renderChat(messages, host("highlight", drawn));

    await select(view.container, "three matrices");
    await lift(view.container);
    expect(drawn).toHaveLength(1);

    // The pen goes back in the rack, and the mark it drew comes back on the next
    // render. No click ever followed the stroke.
    await act(async () => {
      view.rerender(
        createElement(MessageList, {
          messages,
          marks: { ...withMarks([markOf(drawn[0])], opened), pen: null },
        }),
      );
    });
    const body = view.container.querySelector("[data-reply-body]") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(body);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(body, INSIDE);

    expect(opened.map((a) => a.id)).toEqual(["c1"]);
  } finally {
    restore();
  }
});

// The same tail outliving the surface that made it. A press begins with a
// pointer going down and would clear the gate on its way, so the click fired
// here has none in front of it: what is under test is that closing the
// conversation left nothing owed, not that the next press cleans up after it.
test("a stroke does not outlive the conversation it was drawn in", async () => {
  const restore = layOut();
  try {
    const drawn: ChatMarkDraw[] = [];
    const opened: Annotation[] = [];
    const first = await renderChat(messages, host("highlight", drawn));
    await select(first.container, "three matrices");
    await lift(first.container);
    expect(drawn).toHaveLength(1);
    first.unmount();

    const view = await renderChat(messages, withMarks([markOf(drawn[0])], opened));
    const body = view.container.querySelector("[data-reply-body]") as HTMLElement;
    fireEvent.click(body, INSIDE);

    expect(opened.map((a) => a.id)).toEqual(["c1"]);
  } finally {
    restore();
  }
});

// --- the stroke taken straight off the drag (docs/09) ----------------------
//
// The long-press path above is what a finger falls back to. A stylus, a mouse
// and — when the reader has asked for it — a finger draw directly instead:
// pointerdown starts the stroke, the drag extends it, pointerup lands it, and no
// native selection is ever made. Routed by the reader's own table, so the
// classroom and the page answer a pointer the same way (chat-pen-drag.ts).
//
// happy-dom has neither caret API, so the point-to-offset step is stubbed: a
// clientX is read as an offset into the reply. That is the only thing standing
// in for a browser here; everything else is the real wiring.
function caretsByX(node: Node): () => void {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const had = doc.caretRangeFromPoint;
  doc.caretRangeFromPoint = (x: number) => {
    const range = document.createRange();
    const at = Math.max(0, Math.min(Math.round(x), (node.textContent ?? "").length));
    range.setStart(node, at);
    range.setEnd(node, at);
    return range;
  };
  return () => {
    doc.caretRangeFromPoint = had;
  };
}

async function dragAcross(
  body: HTMLElement,
  from: number,
  to: number,
  pointerType: string,
): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(body, { pointerId: 1, pointerType, button: 0, clientX: from, clientY: 5 });
    fireEvent.pointerMove(body, { pointerId: 1, pointerType, clientX: to, clientY: 5 });
    fireEvent.pointerUp(body, { pointerId: 1, pointerType, clientX: to, clientY: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function replyBody(view: { container: HTMLElement }): HTMLElement {
  return view.container.querySelector("[data-reply-body]") as HTMLElement;
}

test("a stylus dragged across a reply marks it without making a selection first", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host("highlight", drawn));
  const restore = caretsByX(textNodeHolding(view.container, REPLY));
  try {
    await dragAcross(replyBody(view), 20, 34, "pen");
    expect(drawn).toEqual([
      { messageTs: 2, text: "three matrices", occurrence: 0, pen: "highlight" },
    ]);
    expect(document.getSelection()?.isCollapsed).toBe(true);
  } finally {
    restore();
  }
});

test("a mouse dragged across a reply does the same", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host("underline", drawn));
  const restore = caretsByX(textNodeHolding(view.container, REPLY));
  try {
    await dragAcross(replyBody(view), 0, 15, "mouse");
    expect(drawn.map((d) => d.text)).toEqual(["attention heads"]);
  } finally {
    restore();
  }
});

// The finger moves the lesson by default, exactly as it moves the page: it takes
// no stroke, and the reply keeps its scrolling.
test("a finger takes no stroke and the reply stays scrollable", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host("highlight", drawn));
  const restore = caretsByX(textNodeHolding(view.container, REPLY));
  try {
    await dragAcross(replyBody(view), 20, 34, "touch");
    expect(drawn).toEqual([]);
    expect(replyBody(view).style.touchAction).toBe("");
  } finally {
    restore();
  }
});

test("with the setting on, a finger draws and the reply gives up its scrolling", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, { ...host("highlight", drawn), fingerDraw: true });
  const restore = caretsByX(textNodeHolding(view.container, REPLY));
  try {
    expect(replyBody(view).style.touchAction).toBe("none");
    await dragAcross(replyBody(view), 20, 34, "touch");
    expect(drawn.map((d) => d.text)).toEqual(["three matrices"]);
  } finally {
    restore();
  }
});

// One gesture is one stroke. The drag prevents the selection it would otherwise
// have made, but a browser left holding one anyway must not have it committed a
// second time on the same pointerup.
test("a gesture the pen took directly is not committed again from a selection", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host("highlight", drawn));
  const restore = caretsByX(textNodeHolding(view.container, REPLY));
  try {
    const body = replyBody(view);
    const node = textNodeHolding(view.container, REPLY);
    await act(async () => {
      fireEvent.pointerDown(body, { pointerId: 1, pointerType: "pen", button: 0, clientX: 20, clientY: 5 });
      fireEvent.pointerMove(body, { pointerId: 1, pointerType: "pen", clientX: 34, clientY: 5 });
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 15);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.pointerUp(body, { pointerId: 1, pointerType: "pen", clientX: 34, clientY: 5 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(drawn.map((d) => d.text)).toEqual(["three matrices"]);
  } finally {
    restore();
  }
});

// The reader can still put a finger on a mark and open it: a press that never
// moved is not a stroke, and the gesture it was part of is not taken.
test("a stylus press that never moved takes no stroke", async () => {
  const drawn: ChatMarkDraw[] = [];
  const view = await renderChat(messages, host("highlight", drawn));
  const restore = caretsByX(textNodeHolding(view.container, REPLY));
  try {
    await dragAcross(replyBody(view), 20, 20, "pen");
    expect(drawn).toEqual([]);
  } finally {
    restore();
  }
});
