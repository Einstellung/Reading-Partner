// What the main-screen call puts in its top-left corner
// (src/ui/components/chat/CallView.tsx). An aside offers one control, the way
// back to the lesson it came out of — not the hang-up, not the delete, and not
// the sentence it was opened on, which a long mark turns into a layout problem.
// The conversation it came off keeps all three of its own. Rendered against a
// real document, because what is asserted is which controls survive.
//
// Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { useDom } from "../../support/dom";

// react-dom has to be evaluated with a window in scope (tests/support/dom.ts),
// and CallView reaches it through the delete control's AlertDialog, so the
// component is imported after the window is up rather than at the top.
const { cleanup, fireEvent, render } = await useDom();
const { default: CallView } = await import("../../../src/ui/components/chat/CallView");
afterEach(cleanup);

type CallViewProps = Parameters<typeof CallView>[0];

function draw(props: Partial<CallViewProps>): HTMLElement {
  const { container } = render(
    createElement(CallView, { messages: [], onSend: () => {}, onHangUp: () => {}, ...props }),
  );
  return container;
}

function backButton(root: HTMLElement): HTMLButtonElement | null {
  return [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Back to the lesson")) ?? null;
}

// Booleans rather than the elements: a failed `toBeNull` on a node prints the
// whole rendered tree, which is a conversation window.
const hangUp = (root: HTMLElement) => root.querySelector('[aria-label="Hang up"]') !== null;
const trash = (root: HTMLElement) => root.querySelector('[aria-label="Delete conversation"]') !== null;
const back = (root: HTMLElement) => backButton(root) !== null;

test("an aside offers the way back and nothing else", () => {
  const returned: true[] = [];
  const root = draw({
    aside: { onBack: () => returned.push(true) },
    // Both offered, and neither drawn: an aside is left with the one control it
    // needs even where the host would hand it more.
    onDelete: () => {},
    chapterFocus: { chapter: "Chapter 3", firstPage: 64, lastPage: 107 },
  });

  const button = backButton(root);
  expect(back(root)).toBe(true);
  fireEvent.click(button!);
  expect(returned).toEqual([true]);

  expect(hangUp(root)).toBe(false);
  expect(trash(root)).toBe(false);
  // An aside reads the chapter its parent is parked on and states none of its own.
  expect(root.textContent).not.toContain("Chapter 3");
});

// The receipt in the lesson is how an aside is reopened, so a lesson that has
// been deleted leaves the aside with nowhere to go back to. The hang-up is the
// second door out of the view — the top-bar blackboard is the other.
test("an aside whose parent is gone keeps the hang-up instead", () => {
  const root = draw({ aside: {}, onDelete: () => {} });

  expect(hangUp(root)).toBe(true);
  expect(back(root)).toBe(false);
  expect(trash(root)).toBe(false);
});

test("a call that is not an aside keeps the hang-up, the delete and the focus line", () => {
  const root = draw({
    onDelete: () => {},
    chapterFocus: { chapter: "Chapter 3", firstPage: 64, lastPage: 107 },
  });

  expect(hangUp(root)).toBe(true);
  expect(trash(root)).toBe(true);
  expect(root.textContent).toContain("Chapter 3 · p.64-107");
  expect(back(root)).toBe(false);

  // The delete is the host's to offer: a conversation with nothing to delete
  // (the book-level thread) passes no handler and gets no trash.
  cleanup();
  expect(trash(draw({}))).toBe(false);
});
