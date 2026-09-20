// What a hold on Lumen would talk about (src/ui/components/lumen/voice-context.ts):
// one screen's context at a time, announced to the corner, and an unmount that
// arrives late does not take the next screen's context down with it.
//
// Run: bun test.

import { afterEach, expect, test } from "bun:test";

import {
  getVoiceContext,
  registerVoiceContext,
  resetVoiceContext,
  subscribeVoiceContext,
} from "../../../../src/ui/components/lumen/voice-context";

afterEach(resetVoiceContext);

test("nothing is registered until a screen offers one", () => {
  expect(getVoiceContext()).toBeNull();
});

test("the registered context is what the corner reads, and the undo clears it", () => {
  const undo = registerVoiceContext({ dateKey: "2026-09-20", briefing: null });
  expect(getVoiceContext()?.dateKey).toBe("2026-09-20");
  undo();
  expect(getVoiceContext()).toBeNull();
});

test("a late unmount does not clear the screen that replaced it", () => {
  const undoFirst = registerVoiceContext({ dateKey: "2026-09-19", briefing: null });
  registerVoiceContext({ dateKey: "2026-09-20", briefing: null });
  // React mounts the next screen before unmounting the last one.
  undoFirst();
  expect(getVoiceContext()?.dateKey).toBe("2026-09-20");
});

test("every registration and clearing is announced", () => {
  let heard = 0;
  const off = subscribeVoiceContext(() => heard++);
  const undo = registerVoiceContext({ dateKey: "2026-09-20", briefing: null });
  expect(heard).toBe(1);
  undo();
  expect(heard).toBe(2);
  off();
  registerVoiceContext({ dateKey: "2026-09-21", briefing: null });
  expect(heard).toBe(2);
});
