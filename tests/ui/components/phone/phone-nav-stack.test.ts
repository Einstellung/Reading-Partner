// The phone shell's navigation stack: the floor that never pops, the unwind
// that turns a named destination back into a back, and what stays on screen
// under Settings.

import { expect, test } from "bun:test";
import {
  back,
  backIsAvailable,
  baseScreen,
  canGoBack,
  goTo,
  HOME,
  INITIAL_STACK,
  openPrep,
  push,
  resolveBack,
  screen,
  top,
  type NavStack,
  type PhoneScreen,
} from "../../../../src/ui/components/phone/nav-stack";


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
  const s1 = push(INITIAL_STACK, screen("meals"));
  const s2 = push(s1, screen("meals-shopping"));
  expect(canGoBack(s2)).toBe(true);
  expect(kinds(back(s2))).toEqual(["home", "meals"]);
  expect(kinds(back(back(s2)))).toEqual(["home"]);
  expect(back(back(back(s2)))).toEqual(INITIAL_STACK);
});

test("a lesson is an entry like any other and back leaves it", () => {
  const lesson: PhoneScreen = {
    kind: "lesson",
    bookId: "h1",
    name: "BERT",
    topicId: "t1",
    path: "/books/bert.pdf",
  };
  const s = push(push(INITIAL_STACK, { kind: "topic", topicId: "t1" }), lesson);
  expect(top(s)).toBe(lesson);
  expect(backIsAvailable(s, false)).toBe(true);
  expect(kinds(back(s))).toEqual(["home", "topic"]);
  // Settings over a lesson keeps the lesson underneath it, the way it does the
  // reader: the conversation is not unmounted to show a panel.
  expect(baseScreen(push(s, screen("settings")))).toBe(lesson);
});

test("goTo pushes a destination that is not on the stack", () => {
  const s = goTo(INITIAL_STACK, screen("meals"));
  expect(kinds(s)).toEqual(["home", "meals"]);
  expect(kinds(goTo(s, screen("meals-shopping")))).toEqual(["home", "meals", "meals-shopping"]);
});

test("goTo unwinds to a destination already on the stack instead of stacking it", () => {
  // How a back by destination arrives: the shopping list asks for "meals",
  // which is where it was opened from.
  const s = goTo(goTo(INITIAL_STACK, screen("meals")), screen("meals-shopping"));
  expect(kinds(goTo(s, screen("meals")))).toEqual(["home", "meals"]);
  // And the deepest screen unwinding to home is the same as backing out of all
  // of it.
  expect(kinds(goTo(s, screen("home")))).toEqual(["home"]);
});

test("goTo unwinds to the nearest copy when a kind appears twice", () => {
  const s: NavStack = [
    HOME,
    screen("meals"),
    screen("library"),
    screen("meals"),
    screen("meals-shopping"),
  ];
  expect(kinds(goTo(s, screen("meals")))).toEqual(["home", "meals", "library", "meals"]);
});

test("a topic is pushed with its id and back drops it", () => {
  const s = push(push(INITIAL_STACK, screen("library")), { kind: "topic", topicId: "t1" });
  expect(top(s)).toEqual({ kind: "topic", topicId: "t1" });
  expect(kinds(back(s))).toEqual(["home", "library"]);
  // Opening a second one from the list stacks it: unwinding by kind would keep
  // the first topic's id, which is the wrong topic.
  const s2 = push(back(s), { kind: "topic", topicId: "t2" });
  expect((top(s2) as Extract<PhoneScreen, { kind: "topic" }>).topicId).toBe("t2");
});

test("Settings is an entry, and the screen under it keeps drawing", () => {
  const s = push(push(INITIAL_STACK, screen("meals")), screen("settings"));
  expect(top(s).kind).toBe("settings");
  expect(baseScreen(s).kind).toBe("meals");
  expect(kinds(back(s))).toEqual(["home", "meals"]);
});

test("baseScreen falls back to home when nothing but Settings is open", () => {
  expect(baseScreen([HOME, screen("settings")]).kind).toBe("home");
  expect(baseScreen([screen("settings")]).kind).toBe("home");
});

test("back closes an open overlay before it touches the stack", () => {
  const deep: NavStack = [HOME, screen("meals"), screen("meals-shopping")];
  expect(resolveBack(deep, false)).toBe("pop");
  // The meals call is not an entry, and popping under it would leave it on
  // screen over a screen the reader never chose.
  expect(resolveBack(deep, true)).toBe("dismissOverlay");
});

test("the library, a topic and a book are entries like any other (docs/70)", () => {
  const stack: NavStack = push(
    push(push(INITIAL_STACK, screen("library")), { kind: "topic", topicId: "t1" }),
    { kind: "reader", bookId: "b1", name: "A book" },
  );
  expect(kinds(stack)).toEqual(["home", "library", "topic", "reader"]);
  // Leaving the book is a pop, not a mode being left.
  expect(resolveBack(stack, false)).toBe("pop");
  expect(kinds(back(stack))).toEqual(["home", "library", "topic"]);
  expect(kinds(back(back(back(stack))))).toEqual(["home"]);
});

test("a second topic stacks rather than unwinding onto the first", () => {
  // goTo unwinds to a screen already on the stack, which is right for the info
  // screens and wrong for one that carries which topic it is: the shelf pushes.
  const one: NavStack = push(push(INITIAL_STACK, screen("library")), {
    kind: "topic",
    topicId: "t1",
  });
  const two = push(one, { kind: "topic", topicId: "t2" });
  expect(kinds(two)).toEqual(["home", "library", "topic", "topic"]);
  expect((top(two) as { topicId: string }).topicId).toBe("t2");
  expect((top(back(two)) as { topicId: string }).topicId).toBe("t1");
});

test("settings over the reader keeps the book on screen", () => {
  const reading: NavStack = push(INITIAL_STACK, {
    kind: "reader",
    bookId: "b1",
    name: "A book",
  });
  expect(baseScreen(push(reading, screen("settings"))).kind).toBe("reader");
});

test("an overlay on the floor is still something to go back from", () => {
  // The onboarding call opens from the home screen, where the stack has
  // nothing to pop: back has to close it rather than fall through to Android.
  expect(resolveBack(INITIAL_STACK, false)).toBe("none");
  expect(resolveBack(INITIAL_STACK, true)).toBe("dismissOverlay");
  expect(backIsAvailable(INITIAL_STACK, false)).toBe(false);
  expect(backIsAvailable(INITIAL_STACK, true)).toBe(true);
  expect(backIsAvailable([HOME, screen("meals")], false)).toBe(true);
});

test("the prep page opens over the Meals page, so back from it is the Meals page wherever it was opened", () => {
  const prep = { kind: "meals-prep", session: "s1" } as const;
  // From the home tile: Meals is pushed under it.
  const fromHome = openPrep(INITIAL_STACK, "s1");
  expect(kinds(fromHome)).toEqual(["home", "meals", "meals-prep"]);
  expect(top(fromHome)).toEqual(prep);
  expect(kinds(back(fromHome))).toEqual(["home", "meals"]);
  // From a day over the Meals page (or a planning chat over it): unwound to Meals.
  const onDay = push(push(INITIAL_STACK, screen("meals")), { kind: "meals-day", date: "2026-11-02" });
  expect(kinds(openPrep(onDay, "s1"))).toEqual(["home", "meals", "meals-prep"]);
  // Opened again from the prep itself it is still one prep over Meals.
  expect(kinds(openPrep(fromHome, "s1"))).toEqual(["home", "meals", "meals-prep"]);
});
