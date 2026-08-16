// The composer's voice mode (src/ui/components/chat/chat.tsx, HoldToTalk.tsx):
// that the keyboard/voice switch appears only on a host that dictates on
// device, that switching swaps the field for the hold bar, and that the desktop
// composer is untouched. The gesture itself is ai/voice/hold-machine.ts and is
// tested there; what is checked here is what is on screen.
//
// The platform is mocked because it is the whole gate: hasOnDeviceDictation()
// asks the OS plugin, and under bun there is none. Run: bun test.

import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { useDom } from "../../support/dom";

// Mutable so one file can be both hosts, and the whole module surface is stood
// up rather than the one function under test: mock.module rewrites the worker's
// registry and does not roll back, so a later file that imports `hostname` off
// this module gets whatever is registered here (docs/pitfall/119). Left on a
// desktop platform at the end for the same reason — the files after this one
// assume the desktop mic (tests/ai/voice/composer.test.tsx).
let host = "ios";
mock.module("@tauri-apps/plugin-os", () => ({
  platform: () => host,
  arch: () => "x86_64",
  family: () => "unix",
  type: () => "linux",
  version: () => "0.0.0",
  eol: () => "\n",
  exeExtension: () => "",
  hostname: async () => "test-host",
  locale: async () => "en-US",
}));
afterAll(() => {
  host = "linux";
});

const { cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

// After the window is up, not statically: the composer reaches react-dom, which
// decides once at evaluation whether it is in a browser (tests/support/dom.ts).
const { Composer, resolveComposerDictation } = await import("../../../src/ui/components/chat/chat");

const TO_VOICE = "Switch to voice";
const TO_KEYBOARD = "Switch to keyboard";
const BAR = "Hold to Talk";

test("resolveComposerDictation: on by default where the host dictates", () => {
  expect(resolveComposerDictation(undefined, true)).toEqual({ glossary: "" });
  expect(resolveComposerDictation({ glossary: "CD-LAM" }, true)).toEqual({ glossary: "CD-LAM" });
});

test("resolveComposerDictation: voice={false} opts a surface out of both voice paths", () => {
  expect(resolveComposerDictation(false, true)).toBeNull();
});

test("resolveComposerDictation: a host that cannot dictate never sees the switch", () => {
  expect(resolveComposerDictation(undefined, false)).toBeNull();
});

test("a dictating host gets the switch, and starts on the keyboard", () => {
  host = "ios";
  const { container, getByLabelText } = render(<Composer onSend={() => {}} placeholder="Ask…" pill />);
  expect(getByLabelText(TO_VOICE)).toBeTruthy();
  expect(container.querySelector("textarea")).toBeTruthy();
  expect(container.textContent).not.toContain(BAR);
});

test("switching to voice swaps the field for the hold bar, and back again", () => {
  host = "ios";
  const { container, getByLabelText } = render(<Composer onSend={() => {}} placeholder="Ask…" pill />);

  fireEvent.click(getByLabelText(TO_VOICE));
  expect(container.textContent).toContain(BAR);
  expect(container.querySelector("textarea")).toBeNull();
  // The send button goes with the field: in voice mode a release is the send.
  expect(container.querySelector('[aria-label="Send"]')).toBeNull();

  fireEvent.click(getByLabelText(TO_KEYBOARD));
  expect(container.querySelector("textarea")).toBeTruthy();
  expect(container.textContent).not.toContain(BAR);
});

test("a desktop composer has no switch and no bar", () => {
  host = "linux";
  const { container } = render(<Composer onSend={() => {}} placeholder="Ask…" pill />);
  expect(container.querySelector(`[aria-label="${TO_VOICE}"]`)).toBeNull();
  expect(container.textContent).not.toContain(BAR);
  expect(container.querySelector("textarea")).toBeTruthy();
});
