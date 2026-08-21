// The wiring the transcript's scroll memory is. The store and the pin each have
// their own unit file; what no unit can see is whether the key reaches the list
// at all, whether the surfaces that must stay out of the memory are still out of
// it, and whether anything still empties the store.
//
// The info call's key and the entry it drops on unmount are its hook's, so they
// are rendered and asserted on. The rest is read off the source: happy-dom
// reports 0 for every scroll metric, does not clamp scrollTop and fires no
// scroll events, so a mount/unmount test of the pin itself would be faking both
// mechanisms it claims to check, and App is not a component a test can stand up.

import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recallScroll, rememberScroll } from "../../../src/ui/components/common/scroll-memory";
import { infoStickKey, useInfoCall } from "../../../src/ui/components/info/use-info-call";
import type { BriefingView } from "../../../src/info/briefing/reader";
import type { InfoCallAnchor } from "../../../src/info/companion/anchors";
import { useDom } from "../../support/dom";

const { cleanup, renderHook } = await useDom();
afterEach(cleanup);

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");

// Comments out, the way chat-scale-contract reads its files: these say what they
// are doing and why, and prose about a prop would answer a search for the prop.
function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const chat = read("ui/components/chat/chat.tsx");
const callView = read("ui/components/chat/CallView.tsx");
const app = read("App.tsx");
const infoCall = read("ui/components/info/InfoCall.tsx");

test("the list binds the pin to the memory for the key it was given", () => {
  expect(chat).toContain("stickToBottom(list, scrollMemory(stickKey))");
  // The dep is what re-binds on a thread switch inside a mounted list, which is
  // the aside round trip.
  expect(chat).toContain("}, [stickKey]);");
});

test("the call window forwards the key to its list", () => {
  expect(callView).toContain("stickKey?: string;");
  expect(callView).toContain("stickKey={stickKey}");
});

test("the reading call names the conversation and clears the store when it ends", () => {
  expect(app).toContain("stickKey={call.threadId}");
  expect(app).toContain("clearScrollMemory()");
});

// The least an info call needs to mount: nothing here is read by the key or the
// unmount, and the thread it tries to load is not on disk in this runner.
const ANCHOR: InfoCallAnchor = {
  threadId: "briefing",
  emptyTitle: "",
  placeholder: "",
  systemPrompt: "",
  position: { title: "", line: null },
};

const VIEW = {
  snapshot: () => ({}),
  subscribe: () => () => {},
  init: async () => {},
  stop: () => {},
  article: async () => ({}),
  request: () => ({}),
  notices: () => [],
  collectorSites: () => null,
} as unknown as BriefingView;

function mountInfoCall(dateKey: string) {
  return renderHook(() =>
    useInfoCall({ anchor: ANCHOR, dateKey, view: VIEW, collecting: false, pipCards: true, onHangUp: () => {} }),
  );
}

test("an info call keys by the date too", () => {
  // The briefing thread's id is a constant, so two days would share one slot.
  expect(infoStickKey("2026-08-21", "briefing")).toBe("info:2026-08-21:briefing");
  expect(infoStickKey("2026-08-22", "briefing")).not.toBe(infoStickKey("2026-08-21", "briefing"));
  // And the prefix keeps it out of the reading thread-id space, where a raw
  // thread id is the whole key.
  expect(infoStickKey("2026-08-21", "briefing")).not.toBe("briefing");
});

test("the hook hands the list that key, and drops the entry on unmount", () => {
  const view = mountInfoCall("2026-08-21");
  const key = view.result.current.stickKey;
  expect(key).toBe(infoStickKey("2026-08-21", ANCHOR.threadId));
  rememberScroll(key, { top: 240, stuck: false });
  // An info call ends by unmounting, where a reading call ends at call === null
  // and App empties the store.
  view.unmount();
  expect(recallScroll(key)).toBe(null);
});

test("the info call's list is given the key its hook made", () => {
  expect(infoCall).toContain("stickKey={call.stickKey}");
});

test("the surfaces that are not remembered pass no key", () => {
  // The corner bubble is a different surface and is not unmounted by the swap;
  // a key on it would let it read the call window's position. The talk and the
  // spike harness have no swap at all.
  for (const path of [
    "ui/components/chat/CallBubble.tsx",
    "ui/components/talk/TalkView.tsx",
    "ui/components/chat/aside-spike-harness.tsx",
  ]) {
    expect(read(path)).not.toContain("stickKey");
  }
});
