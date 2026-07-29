// The phone shell's navigation stack: the floor that never pops, the unwind
// that turns a named destination back into a back, and what stays on screen
// under Settings.

import { expect, test } from "bun:test";
import {
  back,
  baseScreen,
  canGoBack,
  goTo,
  HOME,
  INITIAL_STACK,
  push,
  screen,
  top,
  type NavStack,
  type PhoneScreen,
} from "../../../src/ui/components/phone/nav-stack";
import type { SavedArticle } from "../../../src/reading/saved-articles";

const article = { id: "a1", title: "One" } as unknown as SavedArticle;
const other = { id: "a2", title: "Two" } as unknown as SavedArticle;

function kinds(stack: NavStack): string[] {
  return stack.map((s) => s.kind);
}

test("the stack starts at home and home is the floor", () => {
  expect(kinds(INITIAL_STACK)).toEqual(["home"]);
  expect(canGoBack(INITIAL_STACK)).toBe(false);
  expect(back(INITIAL_STACK)).toBe(INITIAL_STACK);
  expect(top(INITIAL_STACK)).toEqual(HOME);
});

test("push then back returns the stack it came from", () => {
  const s1 = push(INITIAL_STACK, screen("briefing"));
  const s2 = push(s1, screen("article"));
  expect(canGoBack(s2)).toBe(true);
  expect(kinds(back(s2))).toEqual(["home", "briefing"]);
  expect(kinds(back(back(s2)))).toEqual(["home"]);
  expect(back(back(back(s2)))).toEqual(INITIAL_STACK);
});

test("goTo pushes a destination that is not on the stack", () => {
  const s = goTo(INITIAL_STACK, screen("briefing"));
  expect(kinds(s)).toEqual(["home", "briefing"]);
  expect(kinds(goTo(s, screen("sources")))).toEqual(["home", "briefing", "sources"]);
});

test("goTo unwinds to a destination already on the stack instead of stacking it", () => {
  // How the article's top bar back arrives: it asks for "briefing", which is
  // where it was opened from.
  const s = goTo(goTo(INITIAL_STACK, screen("briefing")), screen("article"));
  expect(kinds(goTo(s, screen("briefing")))).toEqual(["home", "briefing"]);
  // And the deepest screen unwinding to home is the same as backing out of all
  // of it.
  expect(kinds(goTo(s, screen("home")))).toEqual(["home"]);
});

test("goTo unwinds to the nearest copy when a kind appears twice", () => {
  const s: NavStack = [
    HOME,
    screen("briefing"),
    screen("saved"),
    screen("briefing"),
    screen("article"),
  ];
  expect(kinds(goTo(s, screen("briefing")))).toEqual(["home", "briefing", "saved", "briefing"]);
});

test("a saved article is pushed with its record and back drops it", () => {
  const s = push(push(INITIAL_STACK, screen("saved")), { kind: "savedArticle", article });
  expect(top(s)).toEqual({ kind: "savedArticle", article });
  expect(kinds(back(s))).toEqual(["home", "saved"]);
  // Opening a second one from the list stacks it: unwinding by kind would keep
  // the first article's record, which is the wrong article.
  const s2 = push(back(s), { kind: "savedArticle", article: other });
  expect((top(s2) as Extract<PhoneScreen, { kind: "savedArticle" }>).article).toBe(other);
});

test("Settings is an entry, and the screen under it keeps drawing", () => {
  const s = push(push(INITIAL_STACK, screen("briefing")), screen("settings"));
  expect(top(s).kind).toBe("settings");
  expect(baseScreen(s).kind).toBe("briefing");
  expect(kinds(back(s))).toEqual(["home", "briefing"]);
});

test("baseScreen falls back to home when nothing but Settings is open", () => {
  expect(baseScreen([HOME, screen("settings")]).kind).toBe("home");
  expect(baseScreen([screen("settings")]).kind).toBe("home");
});
