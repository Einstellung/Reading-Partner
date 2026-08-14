// The one value every chat window reads (src/ui/components/base/useChatScale.ts).
// The React binding is three lines around useSyncExternalStore; what has to hold
// is underneath it — the lazy read of the stored value, who wins when the user
// moves the scale while that read is in flight, and that a pinch's worth of
// events costs one write.
//
// device.ts is reached with spyOn and put back afterwards (pitfall 122), so no
// file is touched and no window is needed. Run: bun test.

import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as device from "../../../src/platform/app/device";
import {
  CHAT_SCALE_DEFAULT,
  CHAT_SCALE_MAX,
} from "../../../src/ui/components/base/chat-scale";
import {
  currentChatScale,
  resetChatScale,
  setChatScale,
  subscribeChatScale,
} from "../../../src/ui/components/base/useChatScale";

const load = spyOn(device, "loadDeviceSettings");
const patch = spyOn(device, "patchDeviceSettings");

// Longer than the store's debounce, so the write has landed by the time it is
// asserted on. Real time rather than a fake clock: the store holds the timer.
const AFTER_DEBOUNCE_MS = 450;

function stored(chatScale: unknown): Promise<device.DeviceSettings> {
  return Promise.resolve({
    ...device.DEFAULT_DEVICE_SETTINGS,
    chatScale,
  } as device.DeviceSettings);
}

beforeEach(() => {
  resetChatScale();
  load.mockReset();
  patch.mockReset();
  load.mockImplementation(() => stored(CHAT_SCALE_DEFAULT));
  patch.mockImplementation(() => Promise.resolve());
});

afterEach(resetChatScale);
afterAll(() => {
  load.mockRestore();
  patch.mockRestore();
});

test("the stored value is read on the first subscriber, and only once", async () => {
  load.mockImplementation(() => stored(1.4));
  let notified = 0;
  subscribeChatScale(() => notified++);
  subscribeChatScale(() => {});
  await load.mock.results[0].value;
  expect(currentChatScale()).toBe(1.4);
  expect(notified).toBe(1);
  expect(load).toHaveBeenCalledTimes(1);
});

test("nothing is written back on the way in", async () => {
  load.mockImplementation(() => stored(1.4));
  subscribeChatScale(() => {});
  await load.mock.results[0].value;
  await Bun.sleep(AFTER_DEBOUNCE_MS);
  expect(patch).not.toHaveBeenCalled();
});

test("a hand-edited file lands inside the range", async () => {
  load.mockImplementation(() => stored(99));
  subscribeChatScale(() => {});
  await load.mock.results[0].value;
  expect(currentChatScale()).toBe(CHAT_SCALE_MAX);
});

test("every subscriber is told, and reads the same value", () => {
  const seen: number[] = [];
  subscribeChatScale(() => seen.push(currentChatScale()));
  subscribeChatScale(() => seen.push(currentChatScale()));
  setChatScale(1.3);
  expect(seen).toEqual([1.3, 1.3]);
});

test("a subscriber that left is not told", () => {
  let notified = 0;
  const off = subscribeChatScale(() => notified++);
  off();
  setChatScale(1.3);
  expect(notified).toBe(0);
});

test("a pinch's worth of changes costs one write, of the last value", async () => {
  subscribeChatScale(() => {});
  setChatScale(1.1);
  setChatScale(1.2);
  setChatScale(1.3);
  await Bun.sleep(AFTER_DEBOUNCE_MS);
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith({ chatScale: 1.3 });
});

// The reset case, and the reason the write is not conditional on the value
// changing: memory starts at the default, so a reset before the stored value
// arrives asks for what memory already holds. Skipping that write leaves the old
// size on disk, and the next launch reads it back.
test("a choice the memory copy already held is still written", async () => {
  let arrive!: (settings: device.DeviceSettings) => void;
  const reading = new Promise<device.DeviceSettings>((resolve) => {
    arrive = resolve;
  });
  load.mockImplementation(() => reading);
  subscribeChatScale(() => {});
  expect(currentChatScale()).toBe(CHAT_SCALE_DEFAULT);

  setChatScale(CHAT_SCALE_DEFAULT);
  arrive({ ...device.DEFAULT_DEVICE_SETTINGS, chatScale: 1.4 });
  await Bun.sleep(AFTER_DEBOUNCE_MS);

  // The read lost: it was answering a question the user has since answered.
  expect(currentChatScale()).toBe(CHAT_SCALE_DEFAULT);
  expect(patch).toHaveBeenCalledWith({ chatScale: CHAT_SCALE_DEFAULT });
});

test("a stored value that arrives before any choice is taken", async () => {
  load.mockImplementation(() => stored(1.4));
  subscribeChatScale(() => {});
  await load.mock.results[0].value;
  expect(currentChatScale()).toBe(1.4);
  setChatScale(1.5);
  expect(currentChatScale()).toBe(1.5);
});
