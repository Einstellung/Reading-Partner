// A tool the rack will not act with (src/ui/components/reader/PenToolbar.tsx).
// Which tool that is, and why, is pure and tested in
// tests/reading/call-state.test.ts; what needs a document is that the button is
// still there, still says what it is, says why it will not open, and does
// nothing when pressed.
//
// Run: bun test.
import { afterEach, expect, test } from "bun:test";
import PenToolbar from "../../../src/ui/components/reader/PenToolbar";
import type { LevelGate } from "../../../src/reading/call-state";
import type { Tool, ToolType } from "../../../src/ui/components/reader/types";
import { useDom } from "../../support/dom";

const { cleanup, fireEvent, render } = await useDom();
// After the window: the bar's overflow menu is a Radix portal, so importing it
// pulls react-dom in, and react-dom decides once whether it is in a browser
// (tests/support/dom.ts).
const { default: ReaderTopBar } = await import("../../../src/ui/components/reader/ReaderTopBar");
afterEach(cleanup);

const COLORS = [
  { name: "Yellow", color: "#ffd400" },
  { name: "Green", color: "#4caf50" },
];

const WHY = "Only the book's conversation can open a side one.";

function rack(disabled?: Partial<Record<ToolType, string>>) {
  const picked: Tool[] = [];
  const view = render(
    <PenToolbar
      orientation="horizontal"
      tool={{ type: "none", color: COLORS[0].color }}
      colors={COLORS}
      onToolChange={(t) => void picked.push(t)}
      disabled={disabled}
    />,
  );
  const button = (label: string) =>
    view.container.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`);
  return { picked, button };
}

test("a dim tool is still on the rack, and still says which tool it is", () => {
  const { button } = rack({ ai: WHY });
  const ai = button("AI pen");

  expect(ai).not.toBeNull();
  expect(ai?.disabled).toBe(true);
  expect(ai?.getAttribute("aria-label")).toBe(`AI pen: ${WHY}`);
  expect(ai?.getAttribute("title")).toBe(WHY);
});

test("pressing it picks nothing", () => {
  const { picked, button } = rack({ ai: WHY });
  const ai = button("AI pen");

  fireEvent.click(ai as HTMLButtonElement);
  expect(picked).toEqual([]);
});

test("the pens beside it are untouched", () => {
  const { picked, button } = rack({ ai: WHY });
  const underline = button("Underline");

  expect(underline?.disabled).toBe(false);
  expect(underline?.getAttribute("title")).toBe("Underline");
  fireEvent.click(underline as HTMLButtonElement);
  expect(picked).toEqual([{ type: "underline", color: COLORS[0].color }]);
});

test("with nothing dim the rack is the rack it was", () => {
  const { picked, button } = rack();
  const ai = button("AI pen");

  expect(ai?.disabled).toBe(false);
  expect(ai?.getAttribute("aria-label")).toBe("AI pen");
  fireEvent.click(ai as HTMLButtonElement);
  expect(picked).toEqual([{ type: "ai", color: COLORS[0].color }]);
});

// --- the blackboard -------------------------------------------------------

function topBar(gate: LevelGate) {
  const opened: true[] = [];
  const view = render(
    <ReaderTopBar
      view={{ current: null }}
      stats={null}
      viewReady={false}
      sidebarOpen={false}
      sidebarBusy={false}
      onToggleSidebar={() => {}}
      onCloseReader={() => {}}
      status=""
      tool={{ type: "none", color: COLORS[0].color }}
      onToolChange={() => {}}
      onOpenBookThread={() => void opened.push(true)}
      gate={gate}
      onOpenSettings={() => {}}
      settingsAlert={false}
    />,
  );
  const button = (label: string) =>
    view.container.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`);
  return { opened, button };
}

test("the blackboard goes dim where the book's conversation is already there", () => {
  const why = "This book's conversation is already open.";
  const { opened, button } = topBar({ aiPen: null, bookThread: why });
  const blackboard = button("Learn this book with AI");

  expect(blackboard).not.toBeNull();
  expect(blackboard?.disabled).toBe(true);
  expect(blackboard?.getAttribute("title")).toBe(why);
  expect(blackboard?.getAttribute("aria-label")).toBe(`Learn this book with AI: ${why}`);
  fireEvent.click(blackboard as HTMLButtonElement);
  expect(opened).toEqual([]);
});

test("and opens it where it is live", () => {
  const { opened, button } = topBar({ aiPen: null, bookThread: null });
  const blackboard = button("Learn this book with AI");

  expect(blackboard?.disabled).toBe(false);
  expect(blackboard?.getAttribute("title")).toBe("Learn this book with AI");
  fireEvent.click(blackboard as HTMLButtonElement);
  expect(opened).toEqual([true]);
});

// The gate reaches the rack through the bar, which is the wiring that has been
// forgotten before.
test("the bar hands the AI pen's line down to the rack", () => {
  const { button } = topBar({ aiPen: WHY, bookThread: null });
  const ai = button("AI pen");

  expect(button("Learn this book with AI")?.disabled).toBe(false);
  expect(ai?.disabled).toBe(true);
  expect(ai?.getAttribute("title")).toBe(WHY);
});
