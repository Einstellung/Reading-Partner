// The phone Library's hold menu and New topic sheet on a real DOM: a hold
// (contextmenu, the same path Android's long-press takes) opens the menu next to
// the card, picking its item closes the menu before the confirmation opens
// (docs/pitfall/211), a delete that fails puts the card back and says so, and
// the New topic sheet opens with its field focused in the tap. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { Topic } from "../../../../src/platform/app/topics";
import { useDom } from "../../../support/dom";

const { render, cleanup, fireEvent, act } = await useDom();
const { default: PhoneShelf } = await import("../../../../src/ui/components/phone/PhoneShelf");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const TOPICS: Topic[] = [
  { id: "t1", name: "How minds decide", createdAt: 2, files: [] },
  { id: "t2", name: "Why cities work", createdAt: 1, files: [] },
];

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function draw(topics: Topic[] | null = TOPICS) {
  const notices: [string, string][] = [];
  let rereads = 0;
  const { container } = render(
    createElement(PhoneShelf, {
      topics,
      topic: null,
      entries: {},
      onOpenTopic: () => {},
      onOpenBook: () => {},
      onOpenLesson: () => {},
      onBack: () => {},
      onSay: () => {},
      onImported: async () => {},
      onChanged: async () => {
        rereads++;
      },
      onNotice: (kind, line) => notices.push([kind, line]),
    }),
  );
  return { root: container, notices, rereads: () => rereads };
}

const byText = (label: string): HTMLElement | null =>
  [...document.body.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(
    (b) => (b.textContent ?? "").trim() === label,
  ) ?? null;

test("a hold on a topic card opens its menu, and the menu closes before the confirmation", async () => {
  const { root } = draw();
  const card = root.querySelector<HTMLElement>('[data-hold="t2"]');
  expect(card).not.toBeNull();
  fireEvent.contextMenu(card as HTMLElement);
  await settle();
  expect(card?.hasAttribute("data-held")).toBe(true);
  const item = byText("Delete topic");
  expect(item).not.toBeNull();
  expect(document.body.textContent).toContain("Why cities work");

  fireEvent.click(item as HTMLElement);
  await settle();
  expect(byText("Delete topic")).toBeNull();
  // TopicDeleteDialog, shown once its count is in.
  expect(document.body.querySelector("[role=alertdialog]")?.textContent).toContain("Delete “Why cities work”?");
});

test("cancelling the confirmation keeps the card and lets it go", async () => {
  const { root } = draw();
  const card = root.querySelector<HTMLElement>('[data-hold="t1"]') as HTMLElement;
  fireEvent.contextMenu(card);
  await settle();
  fireEvent.click(byText("Delete topic") as HTMLElement);
  await settle();
  fireEvent.click(byText("Cancel") as HTMLElement);
  await settle();
  expect(card.hasAttribute("data-held")).toBe(false);
  expect(root.querySelector('[data-hold="t1"]')).not.toBeNull();
});

test("a delete that fails puts the card back, says so, and rereads", async () => {
  const error = console.error;
  const warn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const { root, notices, rereads } = draw();
    const card = root.querySelector<HTMLElement>('[data-hold="t1"]') as HTMLElement;
    fireEvent.contextMenu(card);
    await settle();
    fireEvent.click(byText("Delete topic") as HTMLElement);
    await settle();
    // No host under the test: the delete throws.
    fireEvent.click(byText("Delete") as HTMLElement);
    await settle(300);
    expect(notices).toEqual([["error", "The topic could not be deleted."]]);
    expect(rereads()).toBe(1);
    const back = root.querySelector('[data-hold="t1"]');
    expect(back).not.toBeNull();
    expect(back?.hasAttribute("data-leaving")).toBe(false);
  } finally {
    console.error = error;
    console.warn = warn;
  }
});

test("a click on a held card does not open it", async () => {
  let opened = 0;
  const { container } = render(
    createElement(PhoneShelf, {
      topics: TOPICS,
      topic: null,
      entries: {},
      onOpenTopic: () => opened++,
      onOpenBook: () => {},
      onOpenLesson: () => {},
      onBack: () => {},
      onSay: () => {},
      onImported: async () => {},
      onChanged: async () => {},
      onNotice: () => {},
    }),
  );
  const card = container.querySelector<HTMLElement>('[data-hold="t1"]') as HTMLElement;
  fireEvent.pointerDown(card, { pointerId: 1, clientX: 5, clientY: 5 });
  await settle(560);
  expect(card.hasAttribute("data-held")).toBe(true);
  fireEvent.pointerUp(card, { pointerId: 1 });
  fireEvent.click(card);
  expect(opened).toBe(0);
});

test("New topic sits in the header with topics, and in the empty state without", () => {
  const { root } = draw();
  expect(byText("New topic")).not.toBeNull();
  cleanup();
  const empty = draw([]);
  expect(empty.root.textContent).toContain("No topics yet. A topic is one question");
  expect([...document.body.querySelectorAll("button")].filter((b) => b.textContent === "New topic")).toHaveLength(1);
  void root;
});

test("the New topic sheet opens with its field focused, and Create waits for a name", async () => {
  draw();
  fireEvent.click(byText("New topic") as HTMLElement);
  const field = document.body.querySelector<HTMLInputElement>('input[aria-label="Topic name"]');
  expect(field).not.toBeNull();
  // Focused inside the tap, before any effect had a chance to.
  expect(document.activeElement).toBe(field);
  expect(field?.placeholder).toBe("e.g. what makes JITs fast");
  expect((byText("Create") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(field as HTMLInputElement, { target: { value: "   " } });
  expect((byText("Create") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(field as HTMLInputElement, { target: { value: "Cities" } });
  expect((byText("Create") as HTMLButtonElement).disabled).toBe(false);
});

test("the tap on the scrim closes the menu and opens nothing; the next tap opens", async () => {
  let opened: string[] = [];
  const { container } = render(
    createElement(PhoneShelf, {
      topics: TOPICS,
      topic: null,
      entries: {},
      onOpenTopic: (id: string) => opened.push(id),
      onOpenBook: () => {},
      onOpenLesson: () => {},
      onBack: () => {},
      onSay: () => {},
      onImported: async () => {},
      onChanged: async () => {},
      onNotice: () => {},
    }),
  );
  const held = container.querySelector<HTMLElement>('[data-hold="t1"]') as HTMLElement;
  const other = container.querySelector<HTMLElement>('[data-hold="t2"]') as HTMLElement;
  fireEvent.contextMenu(held);
  await settle();
  const scrim = container.querySelector<HTMLElement>("div[aria-hidden].fixed.inset-0") as HTMLElement;
  expect(scrim).not.toBeNull();
  fireEvent.pointerDown(scrim, { pointerId: 1 });
  await settle();
  expect(byText("Delete topic")).toBeNull();
  // iOS sends the click to what was under the scrim.
  fireEvent.pointerUp(other, { pointerId: 1 });
  fireEvent.click(other);
  expect(opened).toEqual([]);

  fireEvent.pointerDown(other, { pointerId: 2 });
  fireEvent.pointerUp(other, { pointerId: 2 });
  fireEvent.click(other);
  expect(opened).toEqual(["t2"]);
});
