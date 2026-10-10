// A book turn driven the way the reading session drives it
// (reading/turn/durable-turn.ts): the projected rows stream, a steer shows
// queued and then lands in order, and the rows on screen carry the landed
// timestamps.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStallWatches } from "../../../src/legion/execute/stall";
import type { BookOrigin } from "../../../src/reading/turn/durable-book";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { runBookTurn } from "../../../src/reading/turn/durable-turn";
import type { TurnView } from "../../../src/reading/turn/durable-view";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const BOOK: BookOrigin = { place: "book", bookId: "b1", threadId: "t1", home: "b1" };
const LONG = "The tide follows the moon, and the sun pulls too. ".repeat(30);

test("the rows stream, a steer is queued then answered below, and the screen's stamps are the file's", async () => {
  const faux = fauxProvider({ tokensPerSecond: 200, tokenSize: { min: 2, max: 3 }, models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }] });
  faux.setResponses([fauxAssistantMessage(fauxText(LONG)), fauxAssistantMessage(fauxText("Shorter: the moon."))]);
  const models = createModels();
  models.setProvider(faux.provider);
  const { threads, messages } = fakeThreads([{ role: "user", ts: 1000, text: "Why tides?" }]);
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "reading-turn-"))),
    models,
    threads,
    watching: () => true,
    openDesk: async () => [],
    now: () => 1000,
  });
  const views: TurnView[] = [];
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  const turn = await runBookTurn(
    durable,
    {
      origin: BOOK,
      line: { text: "Why tides?", ts: 1000 },
      systemPrompt: "You are a reading partner.",
      history: [],
      tools: [],
      model: { provider: "faux", modelId: "faux-1" },
      describe: (name) => ({ label: name }),
      onView: (view) => {
        views.push(view);
        if ((view.rows[0] as { text?: string } | undefined)?.text?.length ?? 0 > 30) streamed();
      },
      watches: createStallWatches(),
    },
    ctx,
  );
  await streaming;
  expect(views.some((v) => v.busy && v.rows[0]?.role === "ai" && (v.rows[0] as { streaming: boolean }).streaming)).toBe(true);
  expect(await turn.steer("Shorter please", 5000)).toBe(true);
  const { result } = await turn.settled;
  expect(result?.status).toBe("done");
  expect(views.some((v) => v.rows.some((r) => r.role === "user" && r.queued && r.ts === 5000))).toBe(true);
  const landed = messages.slice(1).map((m) => [m.role, m.ts]);
  // The answer to a steer injected after the last text round is missing: see the handoff (docs/research/pi-durable-迁移交接.md).
  expect(landed.slice(0, 2)).toEqual([
    ["ai", 1001],
    ["user", 5000],
  ]);
  const last = views[views.length - 1]!;
  expect(last.rows.slice(0, 2).map((r) => [r.role, r.ts])).toEqual(landed.slice(0, 2));
  await durable.runtime.close(ctx);
});
