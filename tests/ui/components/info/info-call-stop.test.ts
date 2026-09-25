// What the info chat's Stop leaves behind.
//
// runAgentTurn answers a reader's abort with silence: no onDone, no onError
// (tests/legion/execute/turn.test.ts pins that). Whatever the surface does
// about a stopped turn it therefore does in its own stop(), the way the reading
// call does (reading/session/use-call.ts): the row settles, the partial answer
// is kept, and the composer is free again. The turn here is a stand-in that
// keeps that contract, so the hook is driven through the real path.

import { afterEach, expect, spyOn, test } from "bun:test";
import { useDom } from "../../../support/dom";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

import { useInfoCall, type InfoCallOptions } from "../../../../src/ui/components/info/use-info-call";
import * as agent from "../../../../src/legion/execute/turn";
import * as readableLazy from "../../../../src/info/extract/readable-lazy";
import * as settings from "../../../../src/platform/app/settings";
import * as threads from "../../../../src/platform/app/threads";
import { DEFAULT_SETTINGS } from "../../../../src/platform/app/settings";
import { INFO_BRIEFING_KIND, registerInfoDesk } from "../../../../src/info/briefer/desk";
import { registerSecretaryRole } from "../../../../src/info/briefer/role";
import type { InfoCallAnchor } from "../../../../src/info/briefer/anchors";
import type { BriefingView } from "../../../../src/info/briefer/reader";
import type { Thread } from "../../../../src/platform/app/threads";

const IDLE_SNAPSHOT = {
  briefing: null,
  running: false,
  stopping: false,
  phase: "idle",
  collect: null,
  activity: null,
  error: null,
} as const;

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

registerInfoDesk();
registerSecretaryRole();

const THREAD = "briefing-2026-08-13";

function anchor(): InfoCallAnchor {
  return {
    threadId: THREAD,
    emptyTitle: "Today's briefing",
    placeholder: "Ask…",
    desk: [
      {
        kind: INFO_BRIEFING_KIND,
        ref: {
          dateKey: "2026-08-13",
          briefing: null,
          ctx: { reader: "", sources: [], collecting: true },
        },
      },
    ],
    position: { title: "Today's briefing", line: null },
  };
}

function options(): InfoCallOptions {
  return {
    anchor: anchor(),
    dateKey: "2026-08-13",
    view: stubView(),
    collecting: true,
    pipCards: false,
    onHangUp: () => {},
  };
}

// A turn that writes `partial` and then waits for the abort, after which it
// resolves and says nothing — runAgentTurn's contract for a reader's Stop.
function stubHost(partial: string) {
  spyOn(settings, "loadSettings").mockResolvedValue({
    ...DEFAULT_SETTINGS,
    defaultProviderId: "anthropic",
    defaultModelId: "some-model",
  });
  spyOn(threads, "loadThreads").mockResolvedValue({});
  const thread = { id: THREAD, annotationId: "info", messages: [] } as unknown as Thread;
  spyOn(threads, "getThread").mockReturnValue(thread);
  spyOn(threads, "createThread").mockReturnValue(thread);
  const append = spyOn(threads, "appendMessage").mockReturnValue(undefined);
  spyOn(readableLazy, "loadExtractReadable").mockResolvedValue((() => null) as never);
  let aborted!: () => void;
  const settled = new Promise<void>((resolve) => (aborted = resolve));
  const turn = spyOn(agent, "runAgentTurn").mockImplementation(async (o) => {
    if (partial) o.onDelta?.(partial);
    await new Promise<void>((resolve) => o.signal?.addEventListener("abort", () => resolve(), { once: true }));
    // The abort is a request: the stream can still land a word before the run
    // settles.
    if (partial) o.onDelta?.(" and a late word");
    aborted();
  });
  return { turn, append, settled };
}

async function startTurn(result: { current: ReturnType<typeof useInfoCall> }) {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await result.current.send("what happened today?");
  });
}

test("Stop settles the row, keeps the partial answer and frees the composer", async () => {
  const { turn, append, settled } = stubHost("Half an answer");
  const { result } = renderHook(() => useInfoCall(options()));
  await startTurn(result);
  expect(turn).toHaveBeenCalledTimes(1);
  expect(result.current.streaming).toBe(true);

  await act(async () => {
    result.current.stop();
    await settled;
  });

  const last = result.current.messages[result.current.messages.length - 1];
  expect(last.role).toBe("ai");
  expect(last.text).toBe("Half an answer");
  expect(last.streaming).toBe(false);
  expect(last.failed).toBeFalsy();
  expect(result.current.streaming).toBe(false);
  const kept = append.mock.calls.filter((c) => c[2].role === "ai");
  expect(kept.map((c) => c[2].text)).toEqual(["Half an answer"]);

  // The next question goes out.
  await act(async () => {
    await result.current.send("and yesterday?");
  });
  expect(turn).toHaveBeenCalledTimes(2);
});

test("a turn stopped before it wrote anything leaves no row and keeps nothing", async () => {
  const { append, settled } = stubHost("");
  const { result } = renderHook(() => useInfoCall(options()));
  await startTurn(result);

  await act(async () => {
    result.current.stop();
    await settled;
  });

  expect(result.current.messages.map((m) => m.role)).toEqual(["user"]);
  expect(result.current.streaming).toBe(false);
  expect(append.mock.calls.filter((c) => c[2].role === "ai")).toEqual([]);
});
