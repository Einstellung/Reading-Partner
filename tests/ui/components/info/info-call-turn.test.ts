// The info chat's turn on the device's durable runtime (docs/soul/87), driven
// through the hook with a faux provider: what Stop leaves behind, where a meals
// turn lands, and what a line said into a running turn does (docs/72).

import { afterEach, expect, spyOn, test } from "bun:test";
import { useDom } from "../../../support/dom";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useInfoCall, type InfoCallOptions } from "../../../../src/ui/components/info/use-info-call";
import * as durableRuntime from "../../../../src/reading/turn/durable-runtime";
import * as readableLazy from "../../../../src/workshop/extract/readable-lazy";
import * as settings from "../../../../src/platform/app/settings";
import * as threads from "../../../../src/platform/app/threads";
import { DEFAULT_SETTINGS } from "../../../../src/platform/app/settings";
import { INFO_BRIEFING_KIND, registerInfoDesk } from "../../../../src/info/briefer/desk";
import { registerSecretaryRole } from "../../../../src/info/briefer/role";
import { mealsAnchor, type InfoCallAnchor } from "../../../../src/info/briefer/anchors";
import { infoPlace, mealsPlace } from "../../../../src/info/briefer/info-durable";
import { registerMealsDesk } from "../../../../src/info/meals/desk";
import { EMPTY_MEALS } from "../../../../src/info/meals/plan/types";
import type { ThreadFiles } from "../../../../src/legion/durable/thread-files";
import type { BriefingView } from "../../../../src/info/briefer/reader";
import type { Thread, ThreadMessage } from "../../../../src/platform/app/threads";
import { testHost } from "../../../legion/durable/support/runtime";

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
const LONG = "The rate decision matters most, then the chip export rules. ".repeat(30);

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

function options(a: InfoCallAnchor = anchor()): InfoCallOptions {
  return {
    anchor: a,
    dateKey: "2026-08-13",
    view: stubView(),
    collecting: true,
    pipCards: false,
    onHangUp: () => {},
  };
}

/** The app's files stubbed, and a durable runtime on a faux provider where the hook finds it. */
async function stubHost(replies: string[], tokensPerSecond = 400) {
  spyOn(settings, "loadSettings").mockResolvedValue({
    ...DEFAULT_SETTINGS,
    defaultProviderId: "faux",
    defaultModelId: "faux-1",
  });
  spyOn(threads, "loadThreads").mockResolvedValue({});
  const thread = { id: THREAD, annotationId: "info", messages: [] } as unknown as Thread;
  spyOn(threads, "getThread").mockReturnValue(thread);
  spyOn(threads, "createThread").mockReturnValue(thread);
  const append = spyOn(threads, "appendMessage").mockReturnValue(undefined);
  spyOn(readableLazy, "loadExtractReadable").mockResolvedValue((() => null) as never);

  const faux = fauxProvider({
    tokensPerSecond,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  // What the runtime lands, by file and thread.
  const landed: { key: string; threadId: string; message: ThreadMessage }[] = [];
  const files: ThreadFiles = {
    load: async () => {},
    messages: (key, threadId) => landed.filter((l) => l.key === key && l.threadId === threadId).map((l) => l.message),
    append: (key, threadId, message) => {
      landed.push({ key, threadId, message });
    },
    flush: async () => {},
  };
  const durable = await durableRuntime.openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "info-call-"))),
    models,
    threads: files,
    openDesk: async () => [],
    places: { info: infoPlace({ card: async () => {} }), meals: mealsPlace({ card: async () => {} }) },
    log: () => {},
  });
  spyOn(durableRuntime, "readingDurable").mockReturnValue(Promise.resolve(durable));
  return { faux, append, landed, durable };
}

const said = (append: ReturnType<typeof spyOn>) =>
  (append.mock.calls as [string, string, ThreadMessage][]).filter((c) => c[2].role === "user").map((c) => c[2].text);

const lastRow = <T,>(rows: readonly T[]): T | undefined => rows[rows.length - 1];

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function open(o: InfoCallOptions = options()) {
  const hook = renderHook(() => useInfoCall(o));
  await until(() => true);
  return hook;
}

test("Stop keeps the partial answer, lands it once, and frees the composer", async () => {
  const { faux, landed, durable } = await stubHost([LONG, "Yesterday was quiet."], 60);
  const { result } = await open();
  await act(async () => {
    await result.current.send("what happened today?");
  });
  await until(() => (lastRow(result.current.messages)?.text.length ?? 0) > 30);
  expect(result.current.streaming).toBe(true);

  act(() => result.current.stop());
  await until(() => !result.current.streaming);

  const last = lastRow(result.current.messages)!;
  expect(last.role).toBe("ai");
  expect(LONG.startsWith(last.text)).toBe(true);
  expect(last.streaming).toBeFalsy();
  expect(last.failed).toBeFalsy();
  expect(landed.map((l) => [l.key, l.threadId, l.message.role, l.message.text])).toEqual([
    ["info-2026-08-13", THREAD, "ai", last.text],
  ]);

  // The next question goes out.
  await act(async () => {
    await result.current.send("and yesterday?");
  });
  await until(() => !result.current.streaming && lastRow(result.current.messages)?.text === "Yesterday was quiet.");
  expect(faux.state.callCount).toBe(2);
  await durable.runtime.close(ctx);
}, 20_000);

test("a turn stopped while it is being assembled leaves no row and sends nothing", async () => {
  const { faux, landed, durable } = await stubHost(["unused"]);
  const { result } = await open();
  await act(async () => {
    await result.current.send("what happened today?");
    result.current.stop();
  });
  await until(() => !result.current.streaming);
  expect(result.current.messages.map((m) => [m.role, m.text])).toEqual([["user", "what happened today?"]]);
  expect(faux.state.callCount).toBe(0);
  expect(landed).toEqual([]);
  await durable.runtime.close(ctx);
}, 20_000);

test("a meals turn lands in the meals conversation, not the day's briefing", async () => {
  registerMealsDesk();
  const { landed, durable } = await stubHost(["Fish on Tuesday."]);
  const { result } = await open(options(mealsAnchor(EMPTY_MEALS, "2026-08-13")));
  await act(async () => {
    await result.current.send("plan this week");
  });
  await until(() => landed.length > 0);
  expect(landed.map((l) => [l.key, l.threadId, l.message.text])).toEqual([["info-meals", "meals", "Fish on Tuesday."]]);
  await durable.runtime.close(ctx);
}, 20_000);

test("a line sent while the companion answers is steered into the turn, not dropped", async () => {
  const { faux, append, landed, durable } = await stubHost([LONG.slice(0, 600), "Chips after rates."], 80);
  const { result } = await open();
  await act(async () => {
    await result.current.send("what happened today?");
  });
  await until(() => (lastRow(result.current.messages)?.text.length ?? 0) > 30);
  await act(async () => {
    await result.current.send("and the chips?");
  });
  expect(result.current.messages.some((m) => m.role === "user" && m.text === "and the chips?" && m.queued)).toBe(true);
  await until(() => !result.current.streaming);
  expect(result.current.messages.map((m) => m.role)).toEqual(["user", "ai", "user", "ai"]);
  expect(lastRow(result.current.messages)!.text).toBe("Chips after rates.");
  // The steer is the runtime's to land; the hook wrote only the first line.
  expect(said(append)).toEqual(["what happened today?"]);
  expect(landed.map((l) => l.message.role)).toEqual(["ai", "user", "ai"]);
  expect(faux.state.callCount).toBe(2);
  await durable.runtime.close(ctx);
}, 20_000);

test("stopped before the model took the line: it is filed and asked in the next turn", async () => {
  const { faux, append, durable } = await stubHost([LONG, "Yesterday was quiet."], 60);
  const { result } = await open();
  await act(async () => {
    await result.current.send("what happened today?");
  });
  await until(() => (lastRow(result.current.messages)?.text.length ?? 0) > 30);
  // Stop in the same tick as the line: the steer is still being submitted (docs/pitfall/528).
  await act(async () => {
    await result.current.send("and yesterday?");
    result.current.stop();
  });
  await until(() => faux.state.callCount === 2 && !result.current.streaming);
  expect(said(append)).toEqual(["what happened today?", "and yesterday?"]);
  expect(result.current.messages.map((m) => m.role)).toEqual(["user", "ai", "user", "ai"]);
  expect(lastRow(result.current.messages)!.text).toBe("Yesterday was quiet.");
  await durable.runtime.close(ctx);
}, 20_000);
