// A call's layouts, and what a card that opens a screen does to the call it was
// tapped in. Both hang off whether the shell keeps the corner cards.

import { expect, test } from "bun:test";
import { callLayout, navigateAway } from "../../../src/ui/components/chat/call-layout";

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
