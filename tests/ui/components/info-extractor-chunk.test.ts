// What the info chat does when the article extractor's chunk never arrives.
//
// Deferring readable.ts behind a dynamic import (src/info/extract/
// readable-lazy.ts) put a network fetch on a path that had none: an `import()`
// rejects when the chunk 404s after a redeploy, when the connection drops
// mid-fetch, or when a CSP refuses it. buildLiveCompanionTools awaits that
// import, and the info chat awaits buildLiveCompanionTools, so the rejection
// travels all the way out of runAgent — through `await send(...)`, whose caller
// is a `void`-returning composer prop, and through the onboarding kickoff's
// `void runAgent(...)`. Neither has a catch, so the turn ends as an unhandled
// rejection with the reply row left spinning.
//
// Both entrances are driven here, through the real hook: nothing below
// loadExtractReadable is stubbed, so the rejection propagates the way it would
// in the browser. Run: bun test.

import { afterEach, expect, spyOn, test } from "bun:test";
import { useDom } from "../../support/dom";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

import { useInfoCall, type InfoCallOptions } from "../../../src/ui/components/info/use-info-call";
import * as agent from "../../../src/ai/agent";
import * as readableLazy from "../../../src/info/extract/readable-lazy";
import * as settings from "../../../src/platform/app/settings";
import * as threads from "../../../src/platform/app/threads";
import { DEFAULT_SETTINGS } from "../../../src/platform/app/settings";
import type { InfoCallAnchor } from "../../../src/info/companion/anchors";
import type { BriefingView } from "../../../src/info/briefing/reader";
import type { Thread } from "../../../src/platform/app/threads";

// The browser's own words when a chunk cannot be fetched.
const CHUNK_GONE = new TypeError("Failed to fetch dynamically imported module: /assets/readable-9f2c.js");

const IDLE_SNAPSHOT = {
  briefing: null,
  running: false,
  stopping: false,
  phase: "idle",
  collect: null,
  activity: null,
  error: null,
} as const;

// A briefing view that reports an idle collector and never notifies. The turn
// under test never reaches the pipeline.
function stubView(): BriefingView {
  return {
    snapshot: () => IDLE_SNAPSHOT,
    subscribe: () => () => {},
    init: async () => {},
    stop: () => {},
    article: async () => ({ kind: "none" }) as never,
    request: () => ({ outcome: "started", done: Promise.resolve() }) as never,
    notices: () => [],
    collectorSites: () => null,
  };
}

function anchor(opts: { onboarding?: boolean } = {}): InfoCallAnchor {
  return {
    threadId: "briefing",
    emptyTitle: "Today's briefing",
    placeholder: "Ask…",
    systemPrompt: "you are the companion",
    position: { title: "Today's briefing", line: null },
    ...opts,
  };
}

function options(a: InfoCallAnchor): InfoCallOptions {
  return {
    anchor: a,
    dateKey: "2026-08-13",
    view: stubView(),
    collecting: true,
    pipCards: false,
    onHangUp: () => {},
  };
}

// Everything the hook touches on the way to the extractor, so the only failure
// in play is the chunk's. The thread store is in-memory; settings name a
// provider, or runAgent stops before it builds any tools.
function stubHost(threadMessages: Thread["messages"] = []) {
  spyOn(settings, "loadSettings").mockResolvedValue({
    ...DEFAULT_SETTINGS,
    defaultProviderId: "anthropic",
    defaultModelId: "some-model",
  });
  spyOn(threads, "loadThreads").mockResolvedValue({});
  spyOn(threads, "getThread").mockReturnValue({
    id: "briefing",
    annotationId: "info",
    messages: threadMessages,
  } as Thread);
  spyOn(threads, "createThread").mockReturnValue({
    id: "briefing",
    annotationId: "info",
    messages: threadMessages,
  } as Thread);
  spyOn(threads, "appendMessage").mockReturnValue(undefined);
  const turn = spyOn(agent, "runAgentTurn").mockResolvedValue(undefined as never);
  const load = spyOn(readableLazy, "loadExtractReadable").mockRejectedValue(CHUNK_GONE);
  return { turn, load };
}

test("a chunk that never arrives ends the turn in the chat, not in an unhandled rejection", async () => {
  const { turn, load } = stubHost();

  const { result } = renderHook(() => useInfoCall(options(anchor())));
  // The mount effect loads the thread and then writes what it found over
  // `messages`; letting it settle first keeps it from wiping the turn's rows.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await result.current.send("add this feed");
  });

  expect(load).toHaveBeenCalled();
  // Nothing was sent: the tools the turn needs do not exist.
  expect(turn).not.toHaveBeenCalled();

  // The reply row says so instead of spinning forever.
  const last = result.current.messages[result.current.messages.length - 1];
  expect(last.role).toBe("ai");
  expect(last.streaming).toBe(false);
  expect(last.failed).toBe(true);
  expect(last.text).toContain("article extractor");
  // The composer is free again, so sending once more retries the chunk.
  expect(result.current.streaming).toBe(false);
});

test("the onboarding opener says the same thing rather than sitting on an empty row", async () => {
  const { turn } = stubHost();

  const { result } = renderHook(() => useInfoCall(options(anchor({ onboarding: true }))));
  // The opener is kicked from an effect, with no promise anyone holds.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(turn).not.toHaveBeenCalled();
  const last = result.current.messages[result.current.messages.length - 1];
  expect(last.streaming).toBe(false);
  expect(last.failed).toBe(true);
  expect(last.text).toContain("article extractor");
});
