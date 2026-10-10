// A bell answered in its book thread on the durable runtime
// (reading/turn/deliver.ts, docs/soul/87): it starts a turn of its own when the
// thread is free, waits for a busy thread's turn to land first without taking
// its place, and a restart does not answer it twice.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../../src/platform/app/settings";
import type { TurnDelivery } from "../../../src/soul";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { deliverBookBell, type BookBellDeps } from "../../../src/reading/turn/deliver";
import { openReadingDurable, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { createLiveTurns } from "../../../src/reading/turn/live-turns";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const BELL = "[bell from legion — this was not said by the reader]\nThe literature is in.";
const settings = { ...DEFAULT_SETTINGS, defaultProviderId: "faux", defaultModelId: "faux-1" };
const input: TurnDelivery = {
  origin: { place: "book", bookId: "b1", threadId: "t1" },
  settings: settings as TurnDelivery["settings"],
  bell: BELL,
  bellId: "run-done-r-1",
  runId: "r-1",
};

function faux(replies: string[]) {
  const provider = fauxProvider({ models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }] });
  provider.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(provider.provider);
  return { models, provider };
}

async function setup(replies: string[], dir = mkdtempSync(join(tmpdir(), "deliver-bell-"))) {
  const { models, provider } = faux(replies);
  const file = fakeThreads([{ role: "user", ts: 1000, text: "Find me the literature." }]);
  const cards: number[] = [];
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(dir),
    models,
    threads: file.threads,
    watching: () => false,
    card: async (_origin, ts) => {
      cards.push(ts);
    },
    openDesk: async () => [],
    now: () => 2000,
  });
  const turns = createLiveTurns<CallRow>();
  const deps: BookBellDeps = {
    durable: () => Promise.resolve(durable),
    open: async () => ({
      key: "b1",
      threadId: "t1",
      turn: {
        systemPrompt: "You are a reading partner.",
        tools: [],
        messages: [
          { role: "user", text: "Find me the literature." },
          { role: "user", text: BELL },
        ],
        refusal: "",
      },
    }),
    turns,
    threads: file.threads,
    watching: () => false,
    now: () => 2000,
  };
  return { durable, deps, turns, file, cards, provider, dir };
}

const close = (durable: ReadingDurable) => durable.runtime.close(ctx);

test("a free thread answers the bell with its own turn: the reply lands stamped, the bell does not", async () => {
  const { durable, deps, file, cards, turns } = await setup(["Four papers came back."]);
  const shown: CallRow[][] = [];
  turns.listen((threadId) => {
    const rows = turns.get(threadId)?.rows;
    if (rows) shown.push(rows);
  });
  const outcome = await deliverBookBell(input, deps);
  expect(outcome).toEqual({ status: "answered", reply: "Four papers came back.", watching: false });
  expect(file.messages.map((m) => [m.role, m.text, m.origin])).toEqual([
    ["user", "Find me the literature.", undefined],
    ["ai", "Four papers came back.", { runId: "r-1" }],
  ]);
  // The bell's run card is the bell pass's to put; the lander puts none.
  expect(cards).toEqual([]);
  // The turn was registered on its thread and drawn as it went.
  expect(shown.some((rows) => rows.some((r) => r.role === "ai" && r.text === "Four papers came back."))).toBe(true);
  expect(turns.has("t1")).toBe(false);
  await close(durable);
});

test("a busy thread is waited for: the reader's turn keeps its entry, and the bell starts after it settles", async () => {
  const { durable, deps, file, turns, provider } = await setup(["The bell's answer."]);
  const reader = new AbortController();
  turns.start({ threadId: "t1", bookId: "b1", home: "b1", controller: reader, message: { role: "ai", text: "", ts: 1500 } });
  let outcome: unknown;
  const delivering = deliverBookBell(input, deps).then((o) => (outcome = o));
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Nothing was sent and nothing replaced the reader's turn.
  expect(outcome).toBeUndefined();
  expect(provider.state.callCount).toBe(0);
  expect(reader.signal.aborted).toBe(false);
  expect(turns.get("t1")?.controller).toBe(reader);
  // The reader's turn ends the way it would have: its own entry is there to settle.
  file.messages.push({ role: "ai", text: "The reader's answer.", ts: 1600 });
  expect(turns.settle("t1", reader)?.controller).toBe(reader);
  await delivering;
  expect(outcome).toMatchObject({ status: "answered", reply: "The bell's answer." });
  expect(file.messages.map((m) => m.text)).toEqual(["Find me the literature.", "The reader's answer.", "The bell's answer."]);
  await close(durable);
});

test("after a restart the bell's earlier turn is found, and it is not answered twice", async () => {
  const first = await setup(["Answered once."]);
  expect(await deliverBookBell(input, first.deps)).toMatchObject({ status: "answered" });
  await close(first.durable);

  // The process died before the ack: the next pass finds the bell still queued.
  const again = await setup([], first.dir);
  again.file.messages.push(...first.file.messages.slice(1));
  const outcome = await deliverBookBell(input, again.deps);
  expect(outcome).toEqual({ status: "answered", reply: "Answered once.", watching: false });
  expect(again.provider.state.callCount).toBe(0);
  expect(again.file.messages.filter((m) => m.role === "ai").length).toBe(1);
  await close(again.durable);
});

test("a failed bell turn says so, so the bell stays queued", async () => {
  const { durable, deps, turns } = await setup([]);
  const outcome = await deliverBookBell(input, deps);
  expect(outcome?.status).toBe("failed");
  expect(turns.has("t1")).toBe(false);
  await close(durable);
});
