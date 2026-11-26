// The phone home as covers (docs/ui/22) on a real DOM: the Meals tile on top
// where Intel's grid was, the library's covers and "All" row, the loading and
// empty states. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import type { Topic } from "../../../../src/platform/app/topics";
import { useDom } from "../../../support/dom";

const { act, cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const { default: PhoneHome } = await import("../../../../src/ui/components/phone/PhoneHome");

const MEALS_TILE = { mid: "Plan a batch cook", foot: "One shop, one cook, 1 to 3 days", action: { kind: "plan" as const } };

const TOPICS: Topic[] = [
  { id: "t1", name: "Distributed systems", createdAt: 2, files: [{ path: "a.epub", name: "a.epub", addedAt: 0, hash: "h1" }] },
  { id: "t2", name: "Poetry", createdAt: 1, files: [] },
];

type Props = ComponentProps<typeof PhoneHome>;

async function draw(over: Partial<Props> = {}) {
  const opened: string[] = [];
  const props: Props = {
    mealsTile: MEALS_TILE,
    topics: TOPICS,
    continueBook: null,
    onContinue: () => opened.push("continue"),
    onOpenTopic: (id) => opened.push(`topic:${id}`),
    onOpenLibrary: () => opened.push("library"),
    onOpenSettings: () => opened.push("settings"),
    settingsAlert: false,
    meals: true,
    onOpenMeals: () => opened.push("meals"),
    companionShown: true,
    onToggleCompanion: () => {},
    ...over,
  };
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<PhoneHome {...props} />);
  });
  return { container: result.container, opened };
}

function button(container: HTMLElement, text: string): HTMLElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`no button with ${text}`);
  return found;
}

test("the Meals tile comes first, then the library's covers and the row that opens the whole shelf", async () => {
  const { container, opened } = await draw();
  const text = container.textContent ?? "";
  expect(text.indexOf("Meals")).toBeLessThan(text.indexOf("Library"));
  expect(text).not.toContain("Intel");
  fireEvent.click(button(container, "Distributed systems"));
  fireEvent.click(button(container, "All topics"));
  expect(opened).toEqual(["topic:t1", "library"]);
});

test("while the shelf is read it is four card shapes; with nothing yet, one line", async () => {
  const loading = await draw({ topics: null, continueBook: undefined });
  expect(loading.container.querySelectorAll('[data-placeholder="covers"]')).toHaveLength(1);
  cleanup();

  const empty = await draw({ topics: [] });
  expect(button(empty.container, "All topics").textContent).toContain("No topics yet");
});

test("the Meals tile takes its row whole, and is not drawn while meals is off", async () => {
  const on = await draw();
  expect(button(on.container, "Plan a batch cook").parentElement!.className).toContain("grid-cols-1");
  cleanup();

  const off = await draw({ meals: false });
  expect(off.container.textContent).not.toContain("Meals");
  expect(off.container.querySelectorAll("section")).toHaveLength(1);
});

test("the book to continue is the first library cover, with its topic and how far in", async () => {
  const book = {
    topicId: "t1",
    topicName: "Distributed systems",
    bookId: "h1",
    path: "a.epub",
    title: "Designing Data-Intensive Applications",
    file: TOPICS[0].files[0],
  };
  const { container, opened } = await draw({ continueBook: book });
  const card = button(container, "Designing Data-Intensive Applications");
  expect(card.textContent).toContain("Distributed systems");
  expect(card.textContent).toContain("Continue");
  // The book and three topics at most: here the two there are.
  const library = container.querySelectorAll("section")[1];
  expect(library.querySelectorAll("li")).toHaveLength(3);
  fireEvent.click(card);
  expect(opened).toEqual(["continue"]);
});

test("the meals tile says what the batch cook needs and a tap goes where the state says", async () => {
  const tapped: string[] = [];
  const prep = await draw({
    mealsTile: { mid: "Prep: Today, afternoon", foot: "72 min hands-on · about 95 min", action: { kind: "prep", session: "s1" } },
    onMealsTile: () => tapped.push("tile"),
  });
  const tile = button(prep.container, "Prep: Today, afternoon");
  expect(tile.textContent).toContain("72 min hands-on · about 95 min");
  await act(async () => {
    fireEvent.click(tile);
  });
  expect(tapped).toEqual(["tile"]);
  expect(prep.opened).not.toContain("meals");
  cleanup();

  // While info-meals.json is being read the tile holds a placeholder and a tap is the plain way in.
  const loading = await draw({ mealsTile: null });
  const held = button(loading.container, "Meals");
  expect(held.querySelector(".animate-pulse")).not.toBeNull();
  await act(async () => {
    fireEvent.click(held);
  });
  expect(loading.opened).toContain("meals");
});
