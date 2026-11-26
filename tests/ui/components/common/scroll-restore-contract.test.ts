// The wiring the transcript's scroll memory is. The store and the pin each have
// their own unit file; what no unit can see is whether the key reaches the list
// at all, whether the surfaces that must stay out of the memory are still out of
// it, and whether anything still empties the store.
//
// It is read off the source: happy-dom
// reports 0 for every scroll metric, does not clamp scrollTop and fires no
// scroll events, so a mount/unmount test of the pin itself would be faking both
// mechanisms it claims to check, and App is not a component a test can stand up.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../../src");

// Comments out, the way chat-scale-contract reads its files: these say what they
// are doing and why, and prose about a prop would answer a search for the prop.
function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const chat = read("ui/components/chat/MessageList.tsx");
const callView = read("ui/components/chat/call/CallView.tsx");
const app = read("App.tsx");

test("the list binds the pin to the memory for the key it was given", () => {
  expect(chat).toMatch(/stickToBottom\(list, \{\s*\.\.\.scrollMemory\(stickKey\),/);
  // The dep is what re-binds on a thread switch inside a mounted list, which is
  // the aside round trip.
  expect(chat).toContain("}, [stickKey, roomy]);");
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
test("the surfaces that are not remembered pass no key", () => {
  // The corner bubble is a different surface and is not unmounted by the swap;
  // a key on it would let it read the call window's position. The retell and the
  // spike harness have no swap at all.
  for (const path of [
    "ui/components/chat/call/CallBubble.tsx",
    "ui/components/retell/RetellView.tsx",
    "smoke/aside-spike-harness.tsx",
  ]) {
    expect(read(path)).not.toContain("stickKey");
  }
});
