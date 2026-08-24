// The composer's voice mode (src/ui/components/chat/chat.tsx, HoldToTalk.tsx):
// that the keyboard/voice switch appears only on a host that dictates on
// device, that switching swaps the field for the hold bar, and that the desktop
// composer is untouched. The gesture itself is ai/voice/hold-machine.ts and is
// tested there; what is checked here is what is on screen.
//
// The platform is mocked because it is the whole gate: hasOnDeviceDictation()
// asks the OS plugin, and under bun there is none. Run: bun test.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as os from "@tauri-apps/plugin-os";
import { useDom } from "../../support/dom";

// Every invoke the composer makes, recorded. The one this file is here for is
// the release the hold bar sends as it goes away: the native side keeps the
// microphone standing between holds and the orange indicator with it, and
// leaving voice mode is the only thing that puts either out.
const invoked: string[] = [];

// The host, mutable so one file can be both of them. Read through the spy at
// call time, so a test sets it before it renders.
let host: os.Platform = "ios";

// Spies rather than mock.module: mock.module rewrites the registry for every
// file that runs after this one and does not roll back (docs/pitfall/119),
// which is how this file used to leave every later file on a host of its
// choosing. The preload restores a spy between cases, so both go up in
// beforeEach (docs/pitfall/171).
beforeEach(() => {
  invoked.length = 0;
  host = "ios";
  spyOn(core, "invoke").mockImplementation((async (command: string) => {
    invoked.push(command);
    return null;
  }) as typeof core.invoke);
  spyOn(os, "platform").mockImplementation(() => host);
});

const { cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

// After the window is up, not statically: the composer reaches react-dom, which
// decides once at evaluation whether it is in a browser (tests/support/dom.ts).
const { Composer, resolveComposerVoice } = await import("../../../src/ui/components/chat/chat");

const TO_VOICE = "Switch to voice";
const TO_KEYBOARD = "Switch to keyboard";
const BAR = "Hold to Talk";
const RELEASE = "plugin:voice|release_microphone";

test("resolveComposerVoice: on by default where the host dictates", () => {
  expect(resolveComposerVoice(undefined, true)).toEqual({ glossary: "" });
  expect(resolveComposerVoice({ glossary: "CD-LAM" }, true)).toEqual({ glossary: "CD-LAM" });
});

test("resolveComposerVoice: voice={false} opts a surface out of both voice paths", () => {
  expect(resolveComposerVoice(false, true)).toBeNull();
});

test("resolveComposerVoice: a host that cannot dictate never sees the switch", () => {
  expect(resolveComposerVoice(undefined, false)).toBeNull();
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

// The bar's lifetime is the voice mode's, and the microphone's is the bar's. A
// hold that ended left the session, the engine and the tap standing for the next
// one — which is what makes every press after the first 300 ms instead of a
// second — and the orange indicator is lit the whole time. Switching back to the
// keyboard has to put it out immediately: the user can see it, and an indicator
// that outlives the reason for it is the kind of thing that costs trust rather
// than milliseconds.
test("switching back to the keyboard lets the microphone go", () => {
  host = "ios";
  const { getByLabelText } = render(<Composer onSend={() => {}} placeholder="Ask…" pill />);

  fireEvent.click(getByLabelText(TO_VOICE));
  expect(invoked).not.toContain(RELEASE);

  fireEvent.click(getByLabelText(TO_KEYBOARD));
  expect(invoked).toContain(RELEASE);
});

// Leaving the chat is the same event as switching back, and the bar has no other
// way of hearing about it: nothing tells it the screen went away, only that it
// is being unmounted.
test("the composer going away lets the microphone go", () => {
  host = "ios";
  const { getByLabelText, unmount } = render(<Composer onSend={() => {}} placeholder="Ask…" pill />);

  fireEvent.click(getByLabelText(TO_VOICE));
  expect(invoked).not.toContain(RELEASE);

  unmount();
  expect(invoked).toContain(RELEASE);
});

// Entering voice mode does not touch the microphone. It is built by the first
// hold and not before it, because the indicator lights when the engine starts
// (docs/pitfall/167) and a warm-up would light it over a user who has not said
// anything yet.
test("entering voice mode asks the plugin for nothing", () => {
  host = "ios";
  const { getByLabelText } = render(<Composer onSend={() => {}} placeholder="Ask…" pill />);

  fireEvent.click(getByLabelText(TO_VOICE));
  expect(invoked.filter((c) => c.startsWith("plugin:voice|"))).toEqual([]);
});
