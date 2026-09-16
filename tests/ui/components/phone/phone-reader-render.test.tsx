// The phone's reading screen on a real DOM (docs/69), against a stub pane: the
// page text the desk prints, the outline sheet, and the two AI controls drawn
// and unpressable. The pane itself is another file's; what is pinned here is
// the shell it is handed to. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { useEffect } from "react";
import type { Annotation, ViewStats } from "../../../../src/platform/app/reader-contract";
import type { FlowReaderPaneProps } from "../../../../src/reading/epub/flow-contract";
import { AI_NOT_ON_PHONE } from "../../../../src/ui/components/phone/reader-gate";
import type { PhoneBookIo } from "../../../../src/ui/components/phone/open-epub";
import { useDom } from "../../../support/dom";

// The window first: the screen pulls in Radix, which pulls in react-dom, and
// react-dom decides once at evaluation whether it is in a browser (support/dom).
const { render, cleanup, fireEvent, act } = await useDom();
const { default: PhoneReader } = await import(
  "../../../../src/ui/components/phone/PhoneReader"
);

afterEach(cleanup);

const STATS: ViewStats = {
  pageIndex: 36,
  pageLabel: "37",
  printedLabel: "52",
  pagesCount: 385,
  canZoomIn: false,
  canZoomOut: false,
  canZoomReset: false,
  layout: "vertical",
};

const pages: number[] = [];

// What the reflow pane does as far as this screen is concerned: it comes up,
// reports where the reader is, and hands back a handle. Nothing of the real
// one is needed to know whether the shell around it is wired.
function StubPane(props: FlowReaderPaneProps) {
  useEffect(() => {
    props.onView({
      goToCfi() {},
      goToHref() {},
      goToPage(pageIndex) {
        pages.push(pageIndex);
      },
      removeAnnotations() {},
      setTool() {},
      destroy() {},
    });
    props.onInitialized();
    props.onChangeViewStats(STATS);
  }, []);
  return <div data-testid="pane">the book</div>;
}

const io: PhoneBookIo = {
  async readBook() {
    return new Uint8Array([1, 2, 3]);
  },
  async getViewState() {
    return null;
  },
  async prepare() {
    return {
      outline: [
        { title: "One: the machine", page: 2, level: 0 },
        { title: "Two: the tape", page: 40, level: 1 },
      ],
    };
  },
  async loadAnnotations(): Promise<Annotation[]> {
    return [];
  },
  seedReadingPosition() {},
  keepReadingPosition() {},
  release() {},
  async markOpened() {},
};

async function openReader() {
  const view = render(
    <PhoneReader
      Pane={StubPane}
      bookId="b1"
      name="A book"
      topicId="t1"
      path="/books/a.epub"
      io={io}
      onBack={() => {}}
    />,
  );
  // The open sequence is asynchronous end to end; let it land before reading
  // anything off the screen.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

test("the book comes up and the bar counts in the pages the desk counts in", async () => {
  const { getByTestId, container } = await openReader();
  expect(getByTestId("pane").textContent).toBe("the book");
  expect(container.textContent).toContain("37 / 385");
  expect(container.textContent).toContain("printed 52");
});

test("the AI controls are on screen and cannot be pressed", async () => {
  const { container } = await openReader();
  const dim = [...container.querySelectorAll("button[disabled]")];
  const reasons = dim.map((b) => b.getAttribute("title"));
  expect(reasons.filter((r) => r === AI_NOT_ON_PHONE).length).toBe(2);
});

test("the outline sheet lists the chapters and navigates by block", async () => {
  const { container, getByLabelText } = await openReader();
  await act(async () => {
    fireEvent.click(getByLabelText("Outline"));
  });
  // Portalled, so it is the document rather than the container that has it.
  const sheet = document.body.textContent ?? "";
  expect(sheet).toContain("One: the machine");
  expect(sheet).toContain("Two: the tape");
  const entry = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Two: the tape"),
  );
  await act(async () => {
    fireEvent.click(entry as Element);
  });
  // The outline counts pages 1-based; the view takes an index.
  expect(pages).toEqual([39]);
  // And the sheet puts itself away behind the reader it navigated.
  expect(container.textContent).toContain("37 / 385");
});
