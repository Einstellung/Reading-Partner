// A bell answered at the door on the durable runtime (door-bell.ts,
// reading/turn/place-bell.ts), on a faux provider: headless when nobody has the
// conversation open, in the open conversation's session otherwise, after the
// reader's turn has landed when it is busy, and never twice for one bell.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Settings } from "../../../src/platform/app/settings";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { createPlaceSession, openPlaceSession, registerOpenSession, withPlaceTurnRows } from "../../../src/reading/turn/place-session";
import { doorOrigin, doorPlace, doorThreadKey, type TurnDelivery } from "../../../src/soul";
import type { AssembledDoorTurn } from "../../../src/soul/door-durable";
import { deliverDoorBell, type DoorBellDeps } from "../../../src/reading/turn/door-bell";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const DATE = "2026-10-11";
const ORIGIN = doorOrigin(DATE, "d1");
const KEY = doorThreadKey(ORIGIN);
const LINE = { role: "user" as const, text: "What should I read next?", ts: 1000 };
const LONG = "Start with the short essays, then the long one. ".repeat(30);

async function rig(replies: string[], tokensPerSecond = 400) {
  const faux = fauxProvider({
    tokensPerSecond,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  const file = fakeThreads([{ role: "ai", text: "Morning.", ts: 500 }, LINE]);
  const cards: number[] = [];
  const assembled = new Map<string, AssembledDoorTurn>();
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "door-bell-"))),
    models,
    threads: file.threads,
    openDesk: async () => [],
    places: {
      door: doorPlace({ assembled, openDesk: async () => [], watching: () => false, card: async (_o, ts) => void cards.push(ts) }),
    },
    log: () => {},
  });
  const sent: string[] = [];
  const deps: DoorBellDeps = {
    durable: () => Promise.resolve(durable),
    threads: file.threads,
    session: openPlaceSession,
    now: Date.now,
    openThread: async () => ({ id: ORIGIN.threadId }),
    prepare: async (input) => {
      const bell = input.history[input.history.length - 1]!;
      sent.push(bell.text);
      assembled.set(KEY, { history: input.history.slice(0, -1), tools: [] });
      return {
        kind: "turn",
        key: KEY,
        origin: ORIGIN,
        systemPrompt: "You are Lumen.",
        line: bell.text,
        tools: [],
        notice: "",
        model: { provider: "faux", modelId: "faux-1" },
      };
    },
    watching: () => false,
  };
  return { durable, faux, file, cards, assembled, deps, sent };
}

function bell(id: string, waits?: () => void): TurnDelivery {
  return {
    origin: { place: "door", date: DATE },
    settings: {} as Settings,
    bell: "[bell from legion — this was not said by the reader]\nA run finished.",
    bellId: id,
    runId: `run-${id}`,
    ...(waits ? { onWait: waits } : {}),
  };
}

function openChat(durable: ReadingDurable, assembled: Map<string, AssembledDoorTurn>) {
  let screen: CallRow[] = [{ role: "ai", text: "Morning.", ts: 500 }, LINE];
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  const session = createPlaceSession({
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
      if (rows.some((r) => r.role === "ai" && r.streaming && r.text.length > 30)) streamed();
    },
    file: () => {},
    streaming: () => {},
  });
  const closed = registerOpenSession(KEY, session);
  const close = () => {
    session.leave();
    closed();
  };
  return { session, close, screen: () => screen, streaming };
}

test("a bell with nobody at the door runs headless, lands once stamped with its run, and is not started twice", async () => {
  const { durable, faux, file, cards, deps } = await rig(["The run found three essays."]);
  const first = await deliverDoorBell(bell("b1"), deps);
  expect(first).toEqual({ status: "answered", reply: "The run found three essays.", watching: false });
  const landed = file.messages.filter((m) => m.role === "ai" && m.text === "The run found three essays.");
  expect(landed).toHaveLength(1);
  expect(landed[0]!.origin?.runId).toBe("run-b1");
  // The bell's own card is the bell pass's to put (soul/bell.ts), not the lander's.
  expect(cards).toEqual([]);
  // The same bell again (a restart before the ack): found by its id, not asked again.
  const again = await deliverDoorBell(bell("b1"), deps);
  expect(again).toEqual({ status: "answered", reply: "The run found three essays.", watching: false });
  expect(faux.state.callCount).toBe(1);
  await durable.runtime.close(ctx);
});

test("a bell for a door conversation busy with the reader's turn waits until it has landed, then streams in it", async () => {
  const { durable, faux, file, assembled, deps } = await rig([LONG.slice(0, 600), "And the run is done."], 120);
  const chat = openChat(durable, assembled);
  chat.session.ask();
  await chat.streaming;
  let waited = 0;
  const outcome = await deliverDoorBell(bell("b2", () => (waited += 1)), deps);
  expect(waited).toBeGreaterThan(0);
  expect(outcome).toEqual({ status: "answered", reply: "And the run is done.", watching: false });
  expect(faux.state.callCount).toBe(2);
  // The reader's answer landed before the bell's turn started.
  expect(file.messages.map((m) => [m.role, m.text.slice(0, 20)])).toEqual([
    ["ai", "Morning."],
    ["user", LINE.text.slice(0, 20)],
    ["ai", LONG.slice(0, 20)],
    ["ai", "And the run is done."],
  ]);
  // The open conversation drew the bell's turn.
  expect(chat.screen().map((r) => r.text)).toContain("And the run is done.");
  chat.close();
  await durable.runtime.close(ctx);
});

test("a bell's turn in the open door conversation can be stopped there, keeping the half sentence", async () => {
  const { durable, file, assembled, deps } = await rig([LONG], 60);
  const chat = openChat(durable, assembled);
  const outcome = deliverDoorBell(bell("b3"), deps);
  await chat.streaming;
  expect(chat.session.running()).toBe(true);
  chat.session.stop();
  const ended = await outcome;
  expect(ended?.status).toBe("answered");
  const half = file.messages.filter((m) => m.role === "ai" && m.origin?.runId === "run-b3");
  expect(half).toHaveLength(1);
  expect(half[0]!.text.length).toBeGreaterThan(30);
  expect(half[0]!.text.length).toBeLessThan(LONG.length);
  expect(chat.session.running()).toBe(false);
  chat.close();
  expect(openPlaceSession(KEY)).toBeUndefined();
  await durable.runtime.close(ctx);
});

test("what the reader says into a bell's turn at the open door goes into that turn", async () => {
  const { durable, faux, file, assembled, deps } = await rig([LONG.slice(0, 600), "About the novel, yes."], 80);
  const chat = openChat(durable, assembled);
  const outcome = deliverDoorBell(bell("b4"), deps);
  await chat.streaming;
  expect(chat.session.say("And the novel?", Date.now())).toBe(true);
  expect(await outcome).toMatchObject({ status: "answered", reply: "About the novel, yes." });
  // One turn: the steer was taken by it, not filed for a turn of its own.
  expect(faux.state.callCount).toBe(2);
  expect(file.messages.filter((m) => m.role === "user").map((m) => m.text)).toEqual([LINE.text, "And the novel?"]);
  chat.close();
  await durable.runtime.close(ctx);
});
