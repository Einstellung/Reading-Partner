// A conversation at the door on the device's durable runtime (docs/soul/87,
// 第二阶段): the door's place (soul/door-durable.ts) driven by the place session
// (reading/turn/place-session.ts), on a faux provider. A turn lands in the
// day's file, Stop keeps the half sentence, a line said into the turn is
// steered into it, a reply nobody saw gets a card, a turn left in flight is
// joined, a turn whose conversation is closed runs on, and a turn this process
// did not assemble reads its history off the file.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TURN_SECTION } from "../../src/legion/durable/device";
import { startTurn } from "../../src/legion/durable/turn";
import type { CallRow } from "../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../src/reading/turn/durable-runtime";
import { createPlaceSession, withPlaceTurnRows, type PlaceSession } from "../../src/reading/turn/place-session";
import { doorOrigin, doorPlace, doorThreadKey, type AssembledDoorTurn } from "../../src/soul/door-durable";
import { testHost } from "../legion/durable/support/runtime";
import { fakeThreads } from "../reading/turn/support/durable-threads";

const ORIGIN = doorOrigin("2026-10-11", "d1");
const KEY = doorThreadKey(ORIGIN);
const LINE = { role: "user" as const, text: "What should I read next?", ts: 1000 };
const LONG = "Start with the short essays, then the long one. ".repeat(30);

async function rig(replies: string[], options: { watching?: boolean | { on: boolean }; tokensPerSecond?: number } = {}) {
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 400,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  const file = fakeThreads([{ role: "ai", text: "Morning.", ts: 500 }, LINE]);
  const cards: { ts: number; text: string }[] = [];
  const assembled = new Map<string, AssembledDoorTurn>();
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "door-durable-"))),
    models,
    threads: file.threads,
    openDesk: async () => [],
    places: {
      door: doorPlace({
        assembled,
        openDesk: async () => [],
        watching: () => (typeof options.watching === "object" ? options.watching.on : (options.watching ?? true)),
        card: async (_origin, ts, text) => {
          cards.push({ ts, text });
        },
      }),
    },
    log: () => {},
  });
  return { durable, faux, file, cards, assembled };
}

function session(durable: ReadingDurable, assembled: Map<string, AssembledDoorTurn>) {
  let screen: CallRow[] = [LINE];
  const filed: { text: string; ts: number }[] = [];
  let ended!: () => void;
  let ends = new Promise<void>((resolve) => (ended = resolve));
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  const s: PlaceSession = createPlaceSession({
    durable: () => Promise.resolve(durable),
    key: KEY,
    surface: "door",
    assemble: async () => {
      assembled.set(KEY, { history: [{ role: "ai", text: "Morning." }], tools: [] });
      return {
        kind: "turn",
        request: {
          key: KEY,
          origin: ORIGIN,
          conversation: ORIGIN.threadId,
          surface: "door",
          line: { text: LINE.text, ts: LINE.ts },
          systemPrompt: "You are Lumen.",
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
        },
      };
    },
    lastLine: () => LINE.ts,
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
      const ai = rows.find((r) => r.role === "ai" && r.streaming);
      if (ai && ai.text.length > 30) streamed();
    },
    file: (lines) => filed.push(...lines),
    streaming: (on) => {
      if (on) return;
      ended();
      ends = new Promise<void>((resolve) => (ended = resolve));
    },
  });
  return { s, screen: () => screen, filed, streaming, ended: () => ends };
}

test("a door turn lands in the day's file once, history from the assembly, no card while watched", async () => {
  const { durable, file, cards, assembled } = await rig(["Try the essays first."]);
  const view = session(durable, assembled);
  const ended = view.ended();
  view.s.ask();
  await ended;
  expect(view.screen().map((r) => [r.role, r.text])).toEqual([
    ["user", LINE.text],
    ["ai", "Try the essays first."],
  ]);
  expect(file.messages.map((m) => [m.role, m.text])).toEqual([
    ["ai", "Morning."],
    ["user", LINE.text],
    ["ai", "Try the essays first."],
  ]);
  // The screen's row is the landed row: same timestamp, so the store's echo is skipped.
  expect(file.messages[2]!.ts).toBe(view.screen()[1]!.ts);
  // The assembly's history, not the file's (which now holds the reply too).
  const sent = await durable.places.get("door")!.readHistory(ORIGIN, { excludeTs: LINE.ts }, ctx);
  expect(sent.map((m) => m.role)).toEqual(["assistant"]);
  expect(cards).toEqual([]);
  await durable.runtime.close(ctx);
});

test("Stop keeps the half sentence on screen and in the file; the turn's line is not asked again", async () => {
  const { durable, faux, file, assembled } = await rig([LONG], { tokensPerSecond: 60 });
  const view = session(durable, assembled);
  const ended = view.ended();
  view.s.ask();
  await view.streaming;
  view.s.stop();
  await ended;
  const half = view.screen()[1]!;
  expect(half.role).toBe("ai");
  expect(half.text.length).toBeGreaterThan(30);
  expect(LONG.startsWith(half.text)).toBe(true);
  expect(half.streaming).toBeUndefined();
  expect(file.messages[file.messages.length - 1]!.text).toBe(half.text);
  expect(faux.state.callCount).toBe(1);
  await durable.runtime.close(ctx);
});

test("a line said into the turn is steered into it, and the reply after it is a row of its own", async () => {
  const { durable, faux, file, assembled } = await rig([LONG.slice(0, 600), "And then the novel."], { tokensPerSecond: 80 });
  const view = session(durable, assembled);
  const ended = view.ended();
  view.s.ask();
  await view.streaming;
  const at = Date.now();
  expect(view.s.say("What about novels?", at)).toBe(true);
  expect(view.screen().some((r) => r.role === "user" && r.ts === at && r.queued)).toBe(true);
  await ended;
  expect(view.screen().map((r) => r.role)).toEqual(["user", "ai", "user", "ai"]);
  expect(view.screen()[2]).toMatchObject({ text: "What about novels?", ts: at });
  expect(view.screen()[3]!.text).toBe("And then the novel.");
  expect(file.messages.slice(1).map((m) => m.role)).toEqual(["user", "ai", "user", "ai"]);
  expect(view.filed).toEqual([]);
  expect(faux.state.callCount).toBe(2);
  await durable.runtime.close(ctx);
});

test("a reply that lands with the conversation closed gets a card", async () => {
  const { durable, cards, assembled } = await rig(["Read the essays."], { watching: false });
  const view = session(durable, assembled);
  const ended = view.ended();
  view.s.ask();
  await ended;
  expect(cards.map((c) => c.text)).toEqual(["Read the essays."]);
  await durable.runtime.close(ctx);
});

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("closing the conversation does not stop its turn: opened again it is joined, and closed it lands once with a card", async () => {
  const looking = { on: true };
  const { durable, faux, file, cards, assembled } = await rig([LONG.slice(0, 900)], { watching: looking, tokensPerSecond: 80 });
  const first = session(durable, assembled);
  first.s.ask();
  await first.streaming;
  first.s.detach();
  looking.on = false;
  const frozen = first.screen();

  const again = session(durable, assembled);
  looking.on = true;
  expect(await again.s.resume()).toBe(true);
  await again.streaming;
  again.s.detach();
  looking.on = false;

  await until(() => cards.length > 0);
  expect(file.messages.slice(1).map((m) => [m.role, m.text])).toEqual([
    ["user", LINE.text],
    ["ai", LONG.slice(0, 900)],
  ]);
  expect(cards.map((c) => c.text)).toEqual([LONG.slice(0, 900)]);
  // Nothing is drawn on a closed screen, nothing is filed for it, and the turn is not asked again.
  expect(first.screen()).toBe(frozen);
  expect(first.filed).toEqual([]);
  expect(again.filed).toEqual([]);
  expect(faux.state.callCount).toBe(1);
  await durable.runtime.close(ctx);
});

test("a turn in flight when the conversation opens is joined, drawn and lands; history off the file", async () => {
  const { durable, faux, file, assembled } = await rig([LONG.slice(0, 400)], { tokensPerSecond: 100 });
  await startTurn(
    durable.runtime,
    {
      key: KEY,
      origin: ORIGIN,
      content: LINE.text,
      sections: { [TURN_SECTION]: "You are Lumen." },
      tools: [],
      model: { provider: "faux", modelId: "faux-1" },
      excludeTs: LINE.ts,
    },
    ctx,
  );
  const view = session(durable, assembled);
  const ended = view.ended();
  expect(await view.s.resume()).toBe(true);
  await view.streaming;
  await ended;
  expect(view.screen().map((r) => r.role)).toEqual(["user", "ai"]);
  expect(file.messages[file.messages.length - 1]!.text).toBe(LONG.slice(0, 400));
  // Nothing assembled here: the history is the file's (the reply has landed), without the reader's line.
  expect(assembled.size).toBe(0);
  const history = await durable.places.get("door")!.readHistory(ORIGIN, { excludeTs: LINE.ts }, ctx);
  expect(history.map((m) => m.role)).toEqual(["assistant", "assistant"]);
  expect(faux.state.callCount).toBe(1);
  await durable.runtime.close(ctx);
});

test("an idle conversation has nothing to join", async () => {
  const { durable, assembled } = await rig([]);
  const view = session(durable, assembled);
  expect(await view.s.resume()).toBe(false);
  expect(view.s.running()).toBe(false);
  await durable.runtime.close(ctx);
});

test("cards raised during a turn stay above its rows", () => {
  const card = { role: "ai" as const, text: "", ts: 1500, card: true };
  const rows: (CallRow & { card?: boolean })[] = [{ role: "ai", text: "Filed it.", ts: 1001 }];
  const screen: (CallRow & { card?: boolean })[] = [LINE, card, { role: "ai", text: "", ts: 1001, streaming: true }];
  const out = withPlaceTurnRows(screen, 1000, rows, (m) =>
    m.card === true,
  );
  expect(out.map((r) => r.ts)).toEqual([1000, 1500, 1001]);
});
