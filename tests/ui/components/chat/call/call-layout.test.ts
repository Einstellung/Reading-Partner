// A call's layouts, and what a card that opens a screen does to the call it was
// tapped in. Both hang off whether the shell keeps the corner cards.

import { expect, test } from "bun:test";
import { callLayout, INFO_CHAT_PIP_CORNER, navigateAway, swappedFor } from "../../../../../src/ui/components/chat/call/call-layout";

test("with corner cards the call swaps between the two layouts", () => {
  expect(callLayout(true, false)).toBe("chat-main");
  expect(callLayout(true, true)).toBe("chat-pip");
});

test("without corner cards the swapped layout does not exist", () => {
  expect(callLayout(false, false)).toBe("chat-main");
  // Nothing can set it, and if something did the call would still be the screen.
  expect(callLayout(false, true)).toBe("chat-main");
});

test("opening a screen shrinks a call that has a pip and ends one that does not", () => {
  expect(navigateAway(true)).toBe("swap");
  expect(navigateAway(false)).toBe("hang-up");
});

test("a swap belongs to the ask it was made in", () => {
  const first = { threadId: "meals" };
  const again = { threadId: "meals" };
  const swap = { key: first, swapped: true };
  expect(swappedFor(swap, first)).toBe(true);
  // Asking again on the same thread hands over a new anchor: the chat is back.
  expect(swappedFor(swap, again)).toBe(false);
  expect(swappedFor({ key: first, swapped: false }, first)).toBe(false);
});

test("the info chat pip sits below the screen's top bar", () => {
  // The top bar's right end is the screen's Ask button; top-3 lay over it.
  expect(INFO_CHAT_PIP_CORNER).toContain("top-20");
  expect(INFO_CHAT_PIP_CORNER).not.toContain("top-3");
});
