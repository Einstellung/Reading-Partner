// Who keeps the call's composer above the keyboard (src/ui/components/chat/
// CallView.tsx). On its own the call pads itself by what the keyboard covers;
// inside a shell that moves itself above the keyboard (the phone's) it must not,
// or the keyboard is counted twice. The viewport is the iPad after an app
// switch, the one reading where the padding is not 0 (docs/pitfall/392).
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { useDom } from "../../../support/dom";

const { cleanup, render } = await useDom();
const { default: CallView } = await import("../../../../src/ui/components/chat/CallView");
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

const message = { id: "m1", role: "assistant" as const, content: "Hello." };

function draw(shellKeyboard: number | null): HTMLElement {
  const call = createElement(CallView, {
    messages: [message] as never,
    onSend: () => {},
    onHangUp: () => {},
    header: createElement("div", null, "bar"),
  });
  const { container } = render(createElement(ShellKeyboardContext.Provider, { value: shellKeyboard }, call));
  return container.firstElementChild as HTMLElement;
}

const composerRow = (root: HTMLElement) => root.querySelector("textarea")!.closest(".px-4") as HTMLElement;

test("on its own the call pads itself by the covered height", () => {
  const root = draw(null);
  expect(root.style.paddingBottom).toBe("403px");
  expect(composerRow(root).className).toContain("pb-6");
});

test("in a shell that moves itself, the call pads by what the shell says is covered", () => {
  const root = draw(413);
  // The padding is coveredPadding(413), a calc over env() this DOM does not
  // parse; what can be read here is that the call did not measure for itself.
  expect(root.style.paddingBottom).not.toBe("403px");
  expect(composerRow(root).className).toContain("pb-2");
});

test("in that shell with the keyboard down the call does not measure for itself", () => {
  // The viewport still reads as the iPad's shrunk one: the shell's word wins.
  const root = draw(0);
  expect(root.style.paddingBottom).toBe("");
  expect(composerRow(root).className).toContain("pb-6");
});
