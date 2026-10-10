// The reading side of the durable runtime end to end, on the faux provider and
// the bun:sqlite stand-in (reading/turn/durable-runtime.ts): a book turn lands
// in its thread file and says it settled; the steers a recovery withdrew go
// into the file; the catalog covers what the desks mount.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "../../../src/legion/execute/contract";
import { startTurn } from "../../../src/legion/durable/turn";
import { bookThreadKey, bookThreadOrigin, type BookOrigin } from "../../../src/reading/turn/durable-book";
import { landWithdrawnSteers, openReadingDurable, type SettledEvent } from "../../../src/reading/turn/durable-runtime";
import { appToolCatalog } from "../../../src/ui/components/common/durable-catalog";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const BOOK: BookOrigin = { place: "book", bookId: "b1", threadId: "t1", home: "b1" };

function fauxModels(texts: string[]) {
  const faux = fauxProvider({
    tokensPerSecond: 5000,
    tokenSize: { min: 1, max: 2 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(texts.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

const lookup = {
  name: "lookup",
  label: () => "Looking it up",
  effect: "read",
  replay: "safe",
  description: "Look something up",
  parameters: { type: "object", properties: {} },
  execute: async () => "found",
} as unknown as AgentTool;

test("a book turn lands in its thread file and says the conversation is free", async () => {
  const { threads, messages } = fakeThreads([
    { role: "user", ts: 10, text: "Earlier question" },
    { role: "ai", ts: 11, text: "Earlier answer" },
    { role: "user", ts: 1000, text: "What moves the tides?" },
  ]);
  const cards: number[] = [];
  const durable = await openReadingDurable({
    catalog: [lookup],
    host: testHost(mkdtempSync(join(tmpdir(), "reading-durable-"))),
    models: fauxModels(["The moon."]),
    threads,
    card: async (_origin, ts) => {
      cards.push(ts);
    },
    openDesk: async () => [lookup],
    now: () => 1000,
  });
  expect(durable.recovered).toEqual([]);
  const settled: SettledEvent[] = [];
  durable.onTurnSettled((event) => settled.push(event));
  const turn = await startTurn(
    durable.runtime,
    {
      key: bookThreadKey(BOOK),
      origin: bookThreadOrigin(BOOK),
      content: "What moves the tides?",
      sections: { turn: "You are a reading partner." },
      tools: ["lookup"],
      model: { provider: "faux", modelId: "faux-1" },
      excludeTs: 1000,
    },
    ctx,
  );
  expect((await turn.settled)?.landed).toBe(true);
  expect(messages.map((m) => [m.role, m.ts, m.text])).toEqual([
    ["user", 10, "Earlier question"],
    ["ai", 11, "Earlier answer"],
    ["user", 1000, "What moves the tides?"],
    ["ai", 1001, "The moon."],
  ]);
  expect(cards).toEqual([1001]);
  expect(settled.map((e) => [e.origin.place, e.result.status, e.result.landed])).toEqual([["book", "done", true]]);
  await durable.runtime.close(ctx);
});

test("the steers a recovery withdrew go into the thread file once, at the moment they were said", async () => {
  const { threads, messages, log } = fakeThreads([{ role: "user", ts: 7000, text: "Already there" }]);
  const durable = await openReadingDurable({
    catalog: [lookup],
    host: testHost(mkdtempSync(join(tmpdir(), "reading-durable-"))),
    models: fauxModels([]),
    threads,
    openDesk: async () => [lookup],
  });
  const conversation = await durable.runtime.conversationFor(bookThreadKey(BOOK), bookThreadOrigin(BOOK), ctx);
  await landWithdrawnSteers(
    durable.runtime,
    [
      {
        conversationId: conversation.id,
        submission: 1 as never,
        outcome: "mid-text",
        steers: [
          { ts: 7000, text: "Already there" },
          { ts: 8000, text: "Shorter please" },
          { text: "No timestamp" },
        ],
      },
    ],
    threads,
    () => 9000,
    ctx,
  );
  expect(messages.map((m) => [m.ts, m.text])).toEqual([
    [7000, "Already there"],
    [8000, "Shorter please"],
    [9000, "No timestamp"],
  ]);
  expect(log).toEqual(["append:user:8000", "append:user:9000", "flush"]);
  await durable.runtime.close(ctx);
});

test("the catalog holds every tool once, the research sub-agent with its real description", () => {
  const catalog = appToolCatalog();
  const names = catalog.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names.length).toBeGreaterThan(40);
  expect(catalog.find((t) => t.name === "research_literature")?.description.length).toBeGreaterThan(20);
  expect(names).toContain("read_pages");
  expect(names).toContain("observation_search");
});
