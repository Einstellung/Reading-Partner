// Lumen's switch in the reader (docs/68). It used to be the app icon at the far
// left of the bar, where it read as "back to the home screen" and was the one
// control in the bar that is not about the open book. It is a row in the "More"
// menu now, beside Paged flip, with On/Off on its right.
//
// Run: bun test.
import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../../support/dom";

const { cleanup, fireEvent, render } = await useDom();
// After the window: the bar's overflow menu is a Radix portal, so importing it
// pulls react-dom in, and react-dom decides once whether it is in a browser
// (tests/support/dom.ts).
const { default: ReaderTopBar } = await import("../../../../src/ui/components/reader/ReaderTopBar");
afterEach(cleanup);

function bar(lumenShown: boolean) {
  const toggled: true[] = [];
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
      tool={{ type: "none", color: "#ffd400" }}
      onToolChange={() => {}}
      onOpenBookThread={() => {}}
      gate={{ aiPen: null, bookThread: null }}
      onOpenSettings={() => {}}
      settingsAlert={false}
      lumenShown={lumenShown}
      onToggleLumen={() => void toggled.push(true)}
    />,
  );
  const openMenu = () => {
    const more = view.container.querySelector<HTMLButtonElement>('button[aria-label^="More"]');
    fireEvent.click(more as HTMLButtonElement);
  };
  // The menu is a portal, so its rows are on document.body, not in the bar.
  const row = (label: string) =>
    [...document.body.querySelectorAll<HTMLElement>("[role^='menuitem']")].find((el) =>
      el.textContent?.includes(label),
    );
  return { toggled, view, openMenu, row };
}

test("the bar carries no switch of its own for Lumen", () => {
  const { view } = bar(true);

  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.innerHTML).not.toContain("Lumen");
});

test("the menu holds Lumen beside Paged flip, and says which way it stands", () => {
  const { openMenu, row } = bar(false);
  openMenu();

  const lumen = row("Lumen");
  expect(lumen).not.toBeUndefined();
  // The label is the thing, not the action: "Hide Lumen" is the button title
  // elsewhere, and here the state is the On/Off on the right.
  expect(lumen?.textContent).toBe("LumenOff");
  expect(row("Paged flip")).not.toBeUndefined();
});

test("it reads On when Lumen is out, and pressing it reports up", () => {
  const { toggled, openMenu, row } = bar(true);
  openMenu();

  const lumen = row("Lumen");
  expect(lumen?.textContent).toBe("LumenOn");
  fireEvent.click(lumen as HTMLElement);
  expect(toggled).toEqual([true]);
});
