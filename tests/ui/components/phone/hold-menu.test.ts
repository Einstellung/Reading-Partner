// The phone's hold-to-delete (hold-menu.ts): which items a hold offers on each
// kind of thing, what the confirmations and the lines after say, the click a
// hold ends in, and the bookkeeping that lets a deleted item leave in place.
// Run: scripts/t.sh tests/ui/components/phone/hold-menu.test.ts

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../../src/platform/app/topics";
import {
  choiceRemovesItem,
  hideKey,
  holdConfirm,
  holdDoneLine,
  holdMenuHead,
  holdMenuItems,
  DISMISS_CLICK_MS,
  NO_CLICK_GUARD,
  otherTopicNames,
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
  format: "epub",
  article: false,
  bookId: "h1",
  ...over,
});

const labels = (s: HoldSubject, f = {}) => holdMenuItems(s, f).map((i) => i.label);

test("a topic, a kept article and an aside each offer the one delete", () => {
  expect(labels({ kind: "topic", topic: topic("t1", "Cities") })).toEqual(["Delete topic"]);
  expect(labels({ kind: "saved", id: "s1", title: "Commutes" })).toEqual(["Remove from Saved"]);
  expect(
    labels({ kind: "aside", bookId: "b", topicId: "t", asideId: "a1", question: "Why?" }),
  ).toEqual(["Delete aside"]);
});

test("a book in its last topic is deleted; one filed elsewhere is only removed", () => {
  expect(labels(book(), { last: true })).toEqual(["Delete book"]);
  expect(labels(book(), { last: false })).toEqual(["Remove from topic"]);
});

test("an article row says article", () => {
  expect(labels(book({ article: true }), { last: true })).toEqual(["Delete article"]);
});

test("a reference count that could not be read offers the stronger delete", () => {
  expect(labels(book(), {})).toEqual(["Delete book"]);
});

test("a PDF with a lesson offers the lesson first", () => {
  expect(labels(book({ format: "pdf" }), { last: true, hasConversation: true })).toEqual([
    "Delete lesson",
    "Delete book",
  ]);
  expect(labels(book({ format: "pdf" }), { last: true, hasConversation: false })).toEqual(["Delete book"]);
});

test("an EPUB with a book-level thread offers the conversation", () => {
  expect(labels(book(), { last: false, hasConversation: true })).toEqual([
    "Delete conversation",
    "Remove from topic",
  ]);
});

test("no conversation item without a book id, on an article, or on an unknown format", () => {
  expect(labels(book({ bookId: null }), { last: true, hasConversation: true })).toEqual(["Delete book"]);
  expect(labels(book({ article: true }), { last: true, hasConversation: true })).toEqual(["Delete article"]);
  expect(labels(book({ format: "other" }), { last: true, hasConversation: true })).toEqual(["Delete book"]);
});

test("the menu is headed by what was held", () => {
  expect(holdMenuHead(book())).toBe("Thinking, Fast and Slow");
  expect(holdMenuHead({ kind: "topic", topic: topic("t", "Cities") })).toBe("Cities");
  expect(holdMenuHead({ kind: "aside", bookId: "b", topicId: "t", asideId: "a", question: "Why?" })).toBe("Why?");
});

test("removing names the topics the file stays in", () => {
  const w = holdConfirm("remove-from-topic", book(), { otherTopics: ["Economics of attention"] });
  expect(w.title).toBe("Remove “Thinking, Fast and Slow”?");
  expect(w.description).toBe(
    "This topic loses the book. It stays in “Economics of attention”, with its reading position and marks.",
  );
  expect(w.action).toBe("Remove");
});

test("removing a file kept only by something else still says it stays", () => {
  expect(holdConfirm("remove-from-topic", book(), {}).description).toContain("it stays, with its reading position");
});

test("deleting says what goes and what stays", () => {
  const w = holdConfirm("delete-file", book({ article: true, title: "Depth" }));
  expect(w.title).toBe("Delete “Depth”?");
  expect(w.description).toContain("Delete this article and everything about it");
  expect(holdConfirm("delete-lesson", book()).description).toContain("next lesson starts from the beginning");
  expect(holdConfirm("delete-conversation", book()).description).toContain("its reading position stay");
  expect(holdConfirm("remove-saved", { kind: "saved", id: "s", title: "Commutes" }).title).toBe("Remove “Commutes”?");
  expect(
    holdConfirm("delete-aside", { kind: "aside", bookId: "b", topicId: "t", asideId: "a", question: "q" }).description,
  ).toBe("The aside goes, and its row in the lesson with it. The lesson itself stays.");
});

test("the line after each choice", () => {
  expect(holdDoneLine("delete-file", book())).toBe("Deleted “Thinking, Fast and Slow”");
  expect(holdDoneLine("remove-from-topic", book())).toBe("Removed from How minds decide");
  expect(holdDoneLine("delete-lesson", book())).toBe("Lesson deleted");
  expect(holdDoneLine("delete-conversation", book())).toBe("Conversation deleted");
  expect(holdDoneLine("remove-saved", { kind: "saved", id: "s", title: "x" })).toBe("Removed from Saved");
});

test("a conversation delete changes the card; the rest take it away", () => {
  expect(choiceRemovesItem("delete-lesson")).toBe(false);
  expect(choiceRemovesItem("delete-conversation")).toBe(false);
  expect(choiceRemovesItem("delete-file")).toBe(true);
  expect(choiceRemovesItem("remove-saved")).toBe(true);
  expect(choiceRemovesItem("delete-aside")).toBe(true);
  expect(choiceRemovesItem("delete-topic")).toBe(true);
});

test("the other topics are matched by hash, and by path when there is none", () => {
  const topics = [
    topic("t1", "Here", [file("a.epub", "h1")]),
    topic("t2", "There", [file("elsewhere/a.epub", "h1")]),
    topic("t3", "Nowhere", [file("b.epub", "h2")]),
  ];
  expect(otherTopicNames(topics, "t1", file("a.epub", "h1"))).toEqual(["There"]);
  const byPath = [topic("t1", "Here", [file("x.pdf")]), topic("t2", "There", [file("x.pdf")])];
  expect(otherTopicNames(byPath, "t1", file("x.pdf"))).toEqual(["There"]);
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
