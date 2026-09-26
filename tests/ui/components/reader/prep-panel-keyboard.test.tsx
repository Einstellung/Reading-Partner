// The prep panel and the keyboard (src/ui/components/reader/PrepPanel.tsx). The
// sidebar runs to the bottom of the iPad's screen with the add-paper field docked
// there; once the shell moves itself back into view for the keyboard
// (common/KeyboardShell.tsx) nothing scrolls that field up any more, so the
// panel pads itself as the chat does. The viewport is the iPad after an app
// switch (docs/pitfall/392), where the padding is the covered height.
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { useDom } from "../../../support/dom";

const { cleanup, render } = await useDom();
const { default: PrepPanel } = await import("../../../../src/ui/components/reader/PrepPanel");
const { ShellKeyboardContext } = await import("../../../../src/ui/components/common/useKeyboardInset");

const saved = { vv: Object.getOwnPropertyDescriptor(window, "visualViewport"), inner: window.innerHeight };

beforeEach(() => {
  const vv = Object.assign(new EventTarget(), { height: 963, width: 1024, offsetTop: 0, offsetLeft: 0, scale: 1 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
});

afterEach(() => {
  cleanup();
  if (saved.vv) Object.defineProperty(window, "visualViewport", saved.vv);
  else delete (window as { visualViewport?: unknown }).visualViewport;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: saved.inner });
});

const panel = createElement(PrepPanel, {
  kind: "papers",
  papers: { snapshot: null, onStartPrep: () => {} } as never,
  chapters: { snapshot: null, onGenerate: () => {} } as never,
});

test("on its own the panel pads itself by the covered height", () => {
  const { container } = render(panel);
  expect((container.firstElementChild as HTMLElement).style.paddingBottom).toBe("403px");
});

test("in a shell with the keyboard down the panel does not measure for itself", () => {
  const { container } = render(
    createElement(ShellKeyboardContext.Provider, { value: { covered: 0, cramped: false } }, panel),
  );
  expect((container.firstElementChild as HTMLElement).style.paddingBottom).toBe("");
});
