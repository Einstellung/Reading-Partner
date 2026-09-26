// The phone's lesson screen on a real DOM (docs/70): the bar over the
// conversation, the focus row under it, the two standing chips, and the chapter
// sheet. The conversation itself is CallView's and is tested there; what is
// pinned here is the shell it is handed, and that the turn arrives entirely
// from outside. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { TableChapter } from "../../../../../src/reading/chapters/table";
import type { LessonViewProps } from "../../../../../src/ui/components/phone/lesson/lesson-view";
import { bottomSheetOpen } from "../../../../../src/ui/components/base/bottom-sheet";
import { useDom } from "../../../../support/dom";

// The window first: the screen pulls in Radix, and react-dom decides once at
// evaluation whether it is in a browser (support/dom.ts).
const { render, cleanup, fireEvent } = await useDom();
const { default: PhoneLesson } = await import(
  "../../../../../src/ui/components/phone/lesson/PhoneLesson"
);
const { ShellKeyboardContext } = await import("../../../../../src/ui/components/common/useKeyboardInset");

afterEach(cleanup);

const CHAPTERS: TableChapter[] = [
  { index: 1, number: 1, title: "Introduction", startPage: 1, endPage: 2 },
  { index: 2, number: 2, title: "Related Work", startPage: 2, endPage: 3 },
  { index: 3, number: 3, title: "BERT", startPage: 3, endPage: 6 },
];

function draw(over: Partial<LessonViewProps> = {}, keyboard: { covered: number; cramped: boolean } | null = null): {
  root: HTMLElement;
  sent: string[];
  picked: TableChapter[];
} {
  const sent: string[] = [];
  const picked: TableChapter[] = [];
  const props: LessonViewProps = {
    bookId: "h1",
    title: "BERT",
    onBack: () => {},
    messages: [{ role: "ai", text: "Six stops.", ts: 1 }],
    streaming: false,
    onSend: (text) => sent.push(text),
    status: null,
    chapters: CHAPTERS,
    focus: { chapter: 3, page: 4, resumed: false },
    taught: new Set([1, 3]),
    onPickChapter: (c) => picked.push(c),
    ...over,
  };
  const screen = createElement(PhoneLesson, props);
  const { container } = render(keyboard ? createElement(ShellKeyboardContext.Provider, { value: keyboard }, screen) : screen);
  return { root: container, sent, picked };
}

function button(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === label || b.getAttribute("aria-label") === label,
    ) ?? null
  );
}

test("a hold on an aside's row offers to delete that aside", async () => {
  const { root } = draw({
    asideDelete: { topicId: "t1", onChanged: () => {}, onNotice: () => {} },
  });
  const surface = root.querySelector("[data-lesson-press]") as HTMLElement;
  // The row as reader/AsideCard.tsx draws it; the card itself is tested there.
  const row = document.createElement("button");
  row.setAttribute("data-aside-id", "aside-1");
  row.title = "Why divide by root d?";
  surface.appendChild(row);
  fireEvent.contextMenu(row);
  await new Promise((r) => setTimeout(r, 20));
  const item = button(document.body, "Delete aside");
  expect(item).not.toBeNull();
  expect(document.body.textContent).toContain("Why divide by root d?");
  fireEvent.click(item!);
  await new Promise((r) => setTimeout(r, 20));
  expect(document.body.querySelector("[role=alertdialog]")?.textContent).toContain(
    "The aside goes, and its row in the lesson with it.",
  );
  fireEvent.click(button(document.body, "Cancel")!);
  surface.removeChild(row);
});

test("an aside's own screen has no hold on rows", async () => {
  const { root } = draw({
    aside: { span: "a head" },
    asideDelete: { topicId: "t1", onChanged: () => {}, onNotice: () => {} },
  });
  const row = document.createElement("button");
  row.setAttribute("data-aside-id", "aside-2");
  root.firstElementChild?.appendChild(row);
  fireEvent.contextMenu(row);
  await new Promise((r) => setTimeout(r, 20));
  expect(button(document.body, "Delete aside")).toBeNull();
  row.remove();
});

test("the bar carries the paper, and the door to another app only when there is one", () => {
  const { root } = draw();
  expect(root.textContent).toContain("BERT");
  expect(button(root, "Back to the shelf")).not.toBeNull();
  expect(button(root, "Chapters")).not.toBeNull();
  // No plugin on this build: no icon for a door that does not open.
  expect(button(root, "Open in…")).toBeNull();

  cleanup();
  const opened: true[] = [];
  const { root: withDoor } = draw({ onOpenIn: () => opened.push(true) });
  fireEvent.click(button(withDoor, "Open in…")!);
  expect(opened).toEqual([true]);
});

test("the row under the bar says where the lesson is, and gives it up to a status", () => {
  expect(draw().root.textContent).toContain("Now: BERT · p.4");
  cleanup();
  // While the paper is being fetched and read there is no focus to state.
  const loading = draw({ focus: null, status: "Reading the paper…" });
  expect(loading.root.textContent).toContain("Reading the paper…");
  expect(loading.root.textContent).not.toContain("Now:");
});

test("a chip sends the reader's own line", () => {
  const { root, sent } = draw();
  fireEvent.click(button(root, "I don't follow")!);
  fireEvent.click(button(root, "Skip")!);
  expect(sent).toEqual(["I don't follow.", "Skip this one."]);
});

test("a phone on its side with the keyboard up drops the chips with the bar; portrait keeps both", () => {
  const portrait = draw({}, { covered: 413, cramped: false }).root;
  expect(button(portrait, "I don't follow")).not.toBeNull();
  expect(button(portrait, "Back to the shelf")).not.toBeNull();
  cleanup();

  for (const messages of [[{ role: "ai" as const, text: "Six stops.", ts: 1 }], []]) {
    const { root } = draw({ messages }, { covered: 272, cramped: true });
    expect(button(root, "I don't follow")).toBeNull();
    expect(button(root, "Skip")).toBeNull();
    expect(button(root, "Back to the shelf")).toBeNull();
    expect(root.querySelector("textarea")).not.toBeNull();
    cleanup();
  }
});

test("the chapter sheet opens on the bar, and a tap on a chapter is not navigation", () => {
  const { root, picked } = draw();
  expect(bottomSheetOpen()).toBe(false);
  fireEvent.click(button(root, "Chapters")!);
  // And it says it is standing on the bottom edge, which is what takes the
  // shell's corner companion off it (base/bottom-sheet.ts).
  expect(bottomSheetOpen()).toBe(true);
  // Portalled to <body>, so the sheet is not under the screen's own root.
  const sheet = document.body;
  expect(sheet.textContent).toContain("Related Work");
  const row = [...sheet.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Introduction"),
  );
  fireEvent.click(row!);
  expect(picked.map((c) => c.number)).toEqual([1]);
  expect(root.textContent).toContain("Now: BERT · p.4");
});

test("an empty aside opens on the passage it was pulled out of", () => {
  const span = "Self-attention relates every position of one sequence to every other.";
  const { root } = draw({ messages: [], aside: { span, onBack: () => {} } });
  // Twice over: the strip naming the aside, which truncates it to one line, and
  // the empty state, which sets the whole of it as a quotation.
  expect(root.textContent).toContain(span);
  // CallView's own wording, not "Ask again…": nothing has been asked here yet.
  const composer = root.querySelector("textarea, input");
  expect(composer?.getAttribute("placeholder")).toBe("Ask about this passage…");
});

test("the lesson's own empty state is the paper and its ask", () => {
  const { root } = draw({ messages: [] });
  expect(root.textContent).toContain("BERT");
  const composer = root.querySelector("textarea, input");
  expect(composer?.getAttribute("placeholder")).toBe("Ask about the paper…");
});
