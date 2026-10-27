// The phone home as covers (docs/ui/22) on a real DOM: the Intel grid with its
// labels and New badge, the "All" rows, the loading and empty states, and the
// meals and kept-articles tiles sharing a row or taking it whole. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import type { Topic } from "../../../../src/platform/app/topics";
import type { IssueCard } from "../../../../src/ui/components/info/info-shelf";
import type { HomeIntel } from "../../../../src/ui/components/phone/use-home-data";
import { useDom } from "../../../support/dom";

const { act, cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const { default: PhoneHome } = await import("../../../../src/ui/components/phone/PhoneHome");

const LAUNCH = {
  snap: null,
  ready: true,
  configured: true,
  hasSources: true,
  noLabs: false,
  collecting: false,
  notices: [],
  onAsk: () => {},
  onStop: () => {},
  onOpenBriefing: () => {},
  onOpenSettings: () => {},
  onStartSubscribing: () => {},
  mealsTile: { mid: "Plan a batch cook", foot: "One shop, one cook, 1 to 3 days", action: { kind: "plan" as const } },
};

function issue(bookId: string, over: Partial<IssueCard> = {}): IssueCard {
  return {
    key: bookId,
    bookId,
    title: "Brief No. 14",
    dateLabel: "Oct 27",
    topicsLine: "AI agents, Chip export rules",
    itemsLine: "6 items",
    isNew: true,
    study: null,
    failure: null,
    at: 1,
    items: 6,
    ...over,
  };
}

const INTEL: HomeIntel = {
  items: [
    { kind: "issue", card: issue("i14") },
    { kind: "issue", card: issue("s1", { isNew: false, study: { name: "Small language models on phones", version: 2 }, items: 9 }) },
    { kind: "volume", card: { id: "v1", bookId: "v1", title: "Export controls on advanced chips", createdAt: 1, items: 18 } },
  ],
  totals: { issues: 14, volumes: 3 },
  library: {},
};

const TOPICS: Topic[] = [
  { id: "t1", name: "Distributed systems", createdAt: 2, files: [{ path: "a.epub", name: "a.epub", addedAt: 0, hash: "h1" }] },
  { id: "t2", name: "Poetry", createdAt: 1, files: [] },
];

type Props = ComponentProps<typeof PhoneHome>;

async function draw(over: Partial<Props> = {}) {
  const opened: string[] = [];
  const props: Props = {
    launch: LAUNCH,
    intel: INTEL,
    onOpenIntel: (item) => opened.push(`intel:${item.card.bookId}`),
    savedCount: 7,
    onOpenSaved: () => opened.push("saved"),
    onOpenBriefs: () => opened.push("briefs"),
    topics: TOPICS,
    continueBook: null,
    onContinue: () => opened.push("continue"),
    onOpenTopic: (id) => opened.push(`topic:${id}`),
    onOpenLibrary: () => opened.push("library"),
    settingsAlert: false,
    meals: true,
    onOpenMeals: () => opened.push("meals"),
    companionShown: true,
    onToggleCompanion: () => {},
    oldBriefing: false,
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

test("Intel is a grid of covers with the shelf's labels, then the row that opens the whole shelf", async () => {
  const { container, opened } = await draw();
  const text = container.textContent ?? "";
  expect(text.indexOf("Intel")).toBeLessThan(text.indexOf("Library"));
  // An issue: its topics and count, and New beside the count.
  const brief = button(container, "Brief No. 14");
  expect(brief.textContent).toContain("AI agents, Chip export rules");
  expect(brief.textContent).toContain("New");
  // A study: its name for a title, the version in the accent colour.
  const study = button(container, "Small language models on phones");
  const line = [...study.querySelectorAll("span")].find((s) => s.textContent === "Study · version 2");
  expect(line?.className).toContain("text-accent-line");
  expect(study.textContent).not.toContain("New");
  expect(button(container, "Export controls").textContent).toContain("Topic volume18 items");
  expect(button(container, "All intel").textContent).toContain("14 issues · 3 volumes");

  fireEvent.click(study);
  fireEvent.click(button(container, "All intel"));
  fireEvent.click(button(container, "Distributed systems"));
  fireEvent.click(button(container, "All topics"));
  expect(opened).toEqual(["intel:s1", "briefs", "topic:t1", "library"]);
});

test("while the shelves are read each section is four card shapes; with nothing yet, the empty cover and one line", async () => {
  const loading = await draw({ intel: null, topics: null, continueBook: undefined });
  expect(loading.container.querySelectorAll('[data-placeholder="covers"]')).toHaveLength(2);
  cleanup();

  const empty = await draw({ intel: { items: [], totals: { issues: 0, volumes: 0 }, library: {} }, topics: [] });
  const text = empty.container.textContent ?? "";
  expect(text).toContain("No intel yet.");
  expect(text).not.toContain("All intel");
  expect(button(empty.container, "All topics").textContent).toContain("No topics yet");
});

test("meals and the kept articles share a row; either alone takes it whole", async () => {
  const both = await draw();
  const row = button(both.container, "Plan a batch cook").parentElement!;
  expect(row.className).toContain("grid-cols-2");
  expect(button(both.container, "articles kept to read").textContent).toContain("7");
  cleanup();

  const mealsOnly = await draw({ savedCount: 0 });
  expect(mealsOnly.container.textContent).not.toContain("Saved");
  expect(button(mealsOnly.container, "Plan a batch cook").parentElement!.className).toContain("grid-cols-1");
  cleanup();

  const savedOnly = await draw({ meals: false });
  expect(savedOnly.container.textContent).not.toContain("Meals");
  expect(button(savedOnly.container, "articles kept to read").parentElement!.className).toContain("grid-cols-1");
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
    launch: {
      ...LAUNCH,
      mealsTile: { mid: "Prep: Today, afternoon", foot: "72 min hands-on · about 95 min", action: { kind: "prep", session: "s1" } },
      onMealsTile: () => tapped.push("tile"),
    },
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
  const loading = await draw({ launch: { ...LAUNCH, mealsTile: null } });
  const held = button(loading.container, "Meals");
  expect(held.querySelector(".animate-pulse")).not.toBeNull();
  await act(async () => {
    fireEvent.click(held);
  });
  expect(loading.opened).toContain("meals");
});
