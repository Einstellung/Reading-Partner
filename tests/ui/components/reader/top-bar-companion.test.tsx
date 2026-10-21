// Lumen's switch in the reader (docs/68). It used to be the app icon at the far
// left of the bar, where it read as "back to the home screen" and was the one
// control in the bar that is not about the open book. It is a row in the "More"
// menu now, beside Paged flip, with On/Off on its right.
//
// Run: bun test.
import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../../support/dom";
import {
  applyCompanionNameSetting,
  resetCompanionNameForTest,
} from "../../../../src/ui/components/base/use-companion-name";

const { cleanup, fireEvent, render } = await useDom();
// After the window: the bar's overflow menu is a Radix portal, so importing it
// pulls react-dom in, and react-dom decides once whether it is in a browser
// (tests/support/dom.ts).
const { default: ReaderTopBar } = await import("../../../../src/ui/components/reader/ReaderTopBar");
afterEach(() => {
  cleanup();
  resetCompanionNameForTest();
});

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

test("the bar carries no switch of its own for the companion", () => {
  const { view } = bar(true);

  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.innerHTML).not.toContain("Kris");
});

test("the menu holds the companion beside Paged flip, and says which way it stands", () => {
  const { openMenu, row } = bar(false);
  openMenu();

  const lumen = row("Kris");
  expect(lumen).not.toBeUndefined();
  // The label is the thing, not the action: "Hide Kris" is the button title
  // elsewhere, and here the state is the On/Off on the right.
  expect(lumen?.textContent).toBe("KrisOff");
  expect(row("Paged flip")).not.toBeUndefined();
});

test("it reads On when the companion is out, and pressing it reports up", () => {
  const { toggled, openMenu, row } = bar(true);
  openMenu();

  const lumen = row("Kris");
  expect(lumen?.textContent).toBe("KrisOn");
  fireEvent.click(lumen as HTMLElement);
  expect(toggled).toEqual([true]);
});

test("the row carries the name the reader set", () => {
  applyCompanionNameSetting({ companionName: "Mira" });
  const { openMenu, row } = bar(true);
  openMenu();

  expect(row("Mira")?.textContent).toBe("MiraOn");
  expect(row("Kris")).toBeUndefined();
});
