// The meals chat's turn on the device's durable runtime (docs/soul/87), driven
// through the hook with a faux provider: a meals turn lands in the meals
// conversation.

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
import * as durableRuntime from "../../../../src/reading/turn/durable-runtime";
import * as readableLazy from "../../../../src/workshop/extract/readable-lazy";
import * as settings from "../../../../src/platform/app/settings";
import * as threads from "../../../../src/platform/app/threads";
import { DEFAULT_SETTINGS } from "../../../../src/platform/app/settings";
import { mealsPlace } from "../../../../src/meals/conversation/durable";
import { mealsAnchor } from "../../../../src/meals/conversation/anchor";
import { registerMealsRole } from "../../../../src/meals/conversation/role";
import { useMealsCall } from "../../../../src/ui/components/meals/use-meals-call";
import { registerMealsDesk } from "../../../../src/meals/desk";
import { EMPTY_MEALS } from "../../../../src/meals/plan/types";
import type { ThreadFiles } from "../../../../src/legion/durable/thread-files";
import type { Thread, ThreadMessage } from "../../../../src/platform/app/threads";
import { testHost } from "../../../legion/durable/support/runtime";

/** The app's files stubbed, and a durable runtime on a faux provider where the hook finds it. */
async function stubHost(replies: string[], tokensPerSecond = 400) {
  spyOn(settings, "loadSettings").mockResolvedValue({
    ...DEFAULT_SETTINGS,
    defaultProviderId: "faux",
    defaultModelId: "faux-1",
  });
  spyOn(threads, "loadThreads").mockResolvedValue({});
  const thread = { id: "meals", annotationId: "info", messages: [] } as unknown as Thread;
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
  // The box cards put for replies that landed with nobody looking.
  const cards: string[] = [];
  const card = async (_origin: unknown, _ts: number, text: string) => {
    cards.push(text);
  };
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
    host: testHost(mkdtempSync(join(tmpdir(), "meals-call-"))),
    models,
    threads: files,
    openDesk: async () => [],
    places: { meals: mealsPlace({ card }) },
    log: () => {},
  });
  spyOn(durableRuntime, "readingDurable").mockReturnValue(Promise.resolve(durable));
  return { faux, append, landed, durable, cards };
}

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

test("a meals turn lands in the meals conversation, not the day's briefing", async () => {
  registerMealsDesk();
  registerMealsRole();
  const { landed, durable } = await stubHost(["Fish on Tuesday."]);
  const anchor = mealsAnchor(EMPTY_MEALS, "2026-08-13");
  const { result } = renderHook(() => useMealsCall({ anchor, pipCards: true, onHangUp: () => {} }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    await result.current.send("plan this week");
  });
  await until(() => landed.length > 0);
  expect(landed.map((l) => [l.key, l.threadId, l.message.text])).toEqual([["info-meals", "meals", "Fish on Tuesday."]]);
  await durable.runtime.close(ctx);
}, 20_000);
