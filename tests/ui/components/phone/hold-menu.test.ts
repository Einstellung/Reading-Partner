// The phone's hold menu (hold-menu.ts): which items a hold offers on each kind
// of thing, what the confirmations and the lines after say, the click a hold
// ends in, and the bookkeeping that lets a deleted item leave in place.
// Run: scripts/t.sh tests/ui/components/phone/hold-menu.test.ts

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../../src/platform/app/topics";
import {
  hideKey,
  holdConfirm,
  holdDoneLine,
  holdMenuHead,
  holdMenuItems,
  DISMISS_CLICK_MS,
  NO_CLICK_GUARD,
  restoreKey,
  settleHidden,
  stepClickGuard,
  visibleItems,
  type HoldSubject,
} from "../../../../src/ui/components/phone/hold-menu";

const file = (path: string, hash?: string): FileRef => ({ path, name: path, ...(hash ? { hash } : {}) }) as FileRef;
const topic = (id: string, name: string, files: FileRef[] = []): Topic => ({ id, name, createdAt: 0, files });

const book = (over: Partial<Extract<HoldSubject, { kind: "file" }>> = {}): HoldSubject => ({
  kind: "file",
  topicId: "t1",
  topicName: "How minds decide",
  file: file("a.epub", "h1"),
  title: "Thinking, Fast and Slow",
  article: false,
  ...over,
});

const TWO = [topic("t1", "How minds decide", [file("a.epub", "h1")]), topic("t2", "Why cities work")];

const labels = (s: HoldSubject, topics: Topic[] = TWO) => holdMenuItems(s, topics).map((i) => i.label);

test("a topic, a kept article and an aside each offer the one delete", () => {
  expect(labels({ kind: "topic", topic: topic("t1", "Cities") })).toEqual(["Delete topic"]);
  expect(labels({ kind: "saved", id: "s1", title: "Commutes" })).toEqual(["Remove from Saved"]);
  expect(
    labels({ kind: "aside", bookId: "b", topicId: "t", asideId: "a1", question: "Why?" }),
  ).toEqual(["Delete aside"]);
});

test("a file moves first, plain, then deletes, red", () => {
  const items = holdMenuItems(book(), TWO);
  expect(items.map((i) => [i.choice, i.label, i.kind])).toEqual([
    ["move-file", "Move to…", "move"],
    ["delete-file", "Delete book", "delete"],
  ]);
  expect(labels(book({ article: true }))).toEqual(["Move to…", "Delete article"]);
});

test("no Move to… with one topic, or on a file with no book id to move by", () => {
  expect(labels(book(), [TWO[0]!])).toEqual(["Delete book"]);
  expect(labels(book({ file: file("old.pdf") }))).toEqual(["Delete book"]);
});

test("the menu is headed by what was held", () => {
  expect(holdMenuHead(book())).toBe("Thinking, Fast and Slow");
  expect(holdMenuHead({ kind: "topic", topic: topic("t", "Cities") })).toBe("Cities");
  expect(holdMenuHead({ kind: "aside", bookId: "b", topicId: "t", asideId: "a", question: "Why?" })).toBe("Why?");
});

test("deleting says what goes and what stays", () => {
  const w = holdConfirm("delete-file", book({ article: true, title: "Depth" }));
  expect(w.title).toBe("Delete “Depth”?");
  expect(w.description).toContain("Delete this article and everything about it");
  expect(holdConfirm("delete-file", book()).description).toContain("Delete this book and everything about it");
  expect(holdConfirm("remove-saved", { kind: "saved", id: "s", title: "Commutes" }).title).toBe("Remove “Commutes”?");
  expect(
    holdConfirm("delete-aside", { kind: "aside", bookId: "b", topicId: "t", asideId: "a", question: "q" }).description,
  ).toBe("The aside goes, and its row in the lesson with it. The lesson itself stays.");
});

test("the line after each choice", () => {
  expect(holdDoneLine("delete-file", book())).toBe("Deleted “Thinking, Fast and Slow”");
  expect(holdDoneLine("remove-saved", { kind: "saved", id: "s", title: "x" })).toBe("Removed from Saved");
  expect(holdDoneLine("delete-aside", { kind: "aside", bookId: "b", topicId: "t", asideId: "a", question: "q" })).toBe(
    "Aside deleted",
  );
});

// ---- the click a hold ends in --------------------------------------------------

const HOLD = 500;

test("the click that ends a hold that fired is swallowed, once", () => {
  let g = stepClickGuard(NO_CLICK_GUARD, { type: "down", at: 0 }, HOLD).guard;
  g = stepClickGuard(g, { type: "fire" }, HOLD).guard;
  const first = stepClickGuard(g, { type: "click", at: 520, onHoldable: true }, HOLD);
  expect(first.swallow).toBe(true);
  // The next tap is a tap.
  const next = stepClickGuard(first.guard, { type: "down", at: 2000 }, HOLD).guard;
  expect(stepClickGuard(next, { type: "click", at: 2080, onHoldable: true }, HOLD).swallow).toBe(false);
});

test("a hold that started beside a card and ended on it does not open it", () => {
  const g = stepClickGuard(NO_CLICK_GUARD, { type: "down", at: 0 }, HOLD).guard;
  expect(stepClickGuard(g, { type: "click", at: 700, onHoldable: true }, HOLD).swallow).toBe(true);
});

test("a long press on anything else keeps its click", () => {
  const g = stepClickGuard(NO_CLICK_GUARD, { type: "down", at: 0 }, HOLD).guard;
  expect(stepClickGuard(g, { type: "click", at: 700, onHoldable: false }, HOLD).swallow).toBe(false);
});

test("a tap is a tap", () => {
  const g = stepClickGuard(NO_CLICK_GUARD, { type: "down", at: 0 }, HOLD).guard;
  expect(stepClickGuard(g, { type: "click", at: 120, onHoldable: true }, HOLD).swallow).toBe(false);
  expect(stepClickGuard(NO_CLICK_GUARD, { type: "click", at: 120, onHoldable: true }, HOLD).swallow).toBe(false);
});

test("a new down clears a hold that never got its click", () => {
  let g = stepClickGuard(NO_CLICK_GUARD, { type: "down", at: 0 }, HOLD).guard;
  g = stepClickGuard(g, { type: "fire" }, HOLD).guard;
  g = stepClickGuard(g, { type: "down", at: 3000 }, HOLD).guard;
  expect(stepClickGuard(g, { type: "click", at: 3050, onHoldable: true }, HOLD).swallow).toBe(false);
});

const dismissAt = (at: number) => {
  const g = stepClickGuard(NO_CLICK_GUARD, { type: "down", at }, HOLD).guard;
  return stepClickGuard(g, { type: "dismiss", at }, HOLD).guard;
};

test("the tap that puts a menu away does not open what was under it", () => {
  expect(stepClickGuard(dismissAt(0), { type: "click", at: 90, onHoldable: true }, HOLD).swallow).toBe(true);
  // Nor anything else under the scrim.
  expect(stepClickGuard(dismissAt(0), { type: "click", at: 90, onHoldable: false }, HOLD).swallow).toBe(true);
});

test("the tap after the one that put the menu away is a tap", () => {
  const first = stepClickGuard(dismissAt(0), { type: "click", at: 90, onHoldable: true }, HOLD);
  const g = stepClickGuard(first.guard, { type: "down", at: 400 }, HOLD).guard;
  expect(stepClickGuard(g, { type: "click", at: 480, onHoldable: true }, HOLD).swallow).toBe(false);
});

test("a dismissing tap whose click never came does not eat the next tap", () => {
  const g = stepClickGuard(dismissAt(0), { type: "down", at: 200 }, HOLD).guard;
  expect(stepClickGuard(g, { type: "click", at: 260, onHoldable: true }, HOLD).swallow).toBe(false);
});

test("a click long after the dismissing down, with no down between, is not that tap's", () => {
  const late = DISMISS_CLICK_MS + 1;
  expect(stepClickGuard(dismissAt(0), { type: "click", at: late, onHoldable: false }, HOLD).swallow).toBe(false);
});

test("a dismissing hold beside a card still keeps the card shut", () => {
  // Past the dismiss window, the hold rule has it.
  const late = DISMISS_CLICK_MS + 1;
  expect(stepClickGuard(dismissAt(0), { type: "click", at: late, onHoldable: true }, HOLD).swallow).toBe(true);
});

// ---- in-place removal ------------------------------------------------------------

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
const key = (x: { id: string }) => x.id;

test("a hidden item is left out and the others keep their order", () => {
  const hidden = hideKey(new Set(), "b");
  expect(visibleItems(items, hidden, key).map(key)).toEqual(["a", "c"]);
});

test("a failed delete brings the item back where it was", () => {
  const hidden = restoreKey(hideKey(new Set(), "b"), "b");
  expect(visibleItems(items, hidden, key).map(key)).toEqual(["a", "b", "c"]);
});

test("hiding twice and restoring nothing keep the same set", () => {
  const h = hideKey(new Set(), "b");
  expect(hideKey(h, "b")).toBe(h);
  expect(restoreKey(h, "z")).toBe(h);
});

test("the reread forgets the keys it took out, so a key filed again is shown", () => {
  const h = hideKey(hideKey(new Set(), "b"), "c");
  const settled = settleHidden(h, ["a", "c"]);
  expect([...settled]).toEqual(["c"]);
  expect(settleHidden(settled, ["a", "c"])).toBe(settled);
  expect(visibleItems([{ id: "a" }, { id: "b" }], settled, key).map(key)).toEqual(["a", "b"]);
});
