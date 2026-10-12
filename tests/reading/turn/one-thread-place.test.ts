// The coach's and the retell's conversations on the device's durable runtime
// (docs/soul/87, 第二阶段; docs/44, docs/31): each place (reading/rehearsal/
// coach-durable.ts, reading/retell/retell-durable.ts, over reading/turn/
// one-thread-place.ts) driven by the place session on a faux provider. A turn
// lands in the thing's thread file once, Stop keeps the half sentence, and a
// turn left in flight is joined and reads its history off the file. The
// retell's opening turn sends the kickoff, which is never a row of the file.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TURN_SECTION, type PlaceFactory } from "../../../src/legion/durable/device";
import { startTurn } from "../../../src/legion/durable/turn";
import { DEFAULT_SETTINGS } from "../../../src/platform/app/settings";
import type { ThreadMessage } from "../../../src/platform/app/threads";
import { coachConversationKey, coachOrigin, coachPlace, COACH_PLACE, prepareCoachTurn } from "../../../src/reading/rehearsal/coach-durable";
import { prepareRetellTurn, retellConversationKey, retellOrigin, retellPlace, RETELL_PLACE } from "../../../src/reading/retell/retell-durable";
import { RETELL_KICKOFF } from "../../../src/reading/retell/prompt";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import {
  watchOneThread,
  type AssembledThreadTurn,
  type BuiltThreadTurn,
  type OneThreadOrigin,
} from "../../../src/reading/turn/one-thread-place";
import { createPlaceSession, withPlaceTurnRows, type PlaceAssembled, type PlaceSession } from "../../../src/reading/turn/place-session";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const LINE = { role: "user" as const, text: "Here is how the second pass went.", ts: 1000 };
const EARLIER = { role: "ai" as const, text: "Give it once more from the top.", ts: 500 };
const LONG = "Open with the question, then the two cases, slowly. ".repeat(30);
const SETTINGS = { ...DEFAULT_SETTINGS, defaultProviderId: "faux", defaultModelId: "faux-1", chatThinking: "off" as const };

interface Case {
  name: string;
  place: string;
  key: string;
  origin: OneThreadOrigin;
  factory(assembled: Map<string, AssembledThreadTurn>, card: Card): PlaceFactory;
  /** The turn's messages before the reader's line, as the domain's builder answers them. */
  before: BuiltThreadTurn["messages"];
  /** The roles a turn resumed after a restart sends before its line. */
  restartHistory: ("user" | "assistant")[];
  prepare(assembled: Map<string, AssembledThreadTurn>, built: BuiltThreadTurn, lineTs?: number): Promise<PlaceAssembled>;
}

type Card = (id: string, ts: number, text: string) => Promise<void>;

const built = (messages: BuiltThreadTurn["messages"]): BuiltThreadTurn => ({
  systemPrompt: "You are the coach.",
  tools: [],
  messages,
  notice: "",
  refusal: "",
});

const CASES: Case[] = [
  {
    name: "coach",
    place: COACH_PLACE,
    key: coachConversationKey("o1"),
    origin: coachOrigin("o1"),
    factory: (assembled, card) => coachPlace({ assembled, openDesk: async () => [], card }),
    before: [{ role: "ai", text: EARLIER.text }],
    restartHistory: ["assistant"],
    prepare: (assembled, turn, lineTs) =>
      prepareCoachTurn({ outline: { id: "o1" }, settings: SETTINGS, lineTs: lineTs ?? 0, history: [], talk: {} } as never, {
        assembled,
        build: async () => turn as never,
      }),
  },
  {
    name: "retell",
    place: RETELL_PLACE,
    key: retellConversationKey("r1"),
    origin: retellOrigin("r1"),
    factory: (assembled, card) => retellPlace({ assembled, openDesk: async () => [], card }),
    before: [
      { role: "user", text: RETELL_KICKOFF },
      { role: "ai", text: EARLIER.text },
    ],
    restartHistory: ["user", "assistant"],
    prepare: (assembled, turn, lineTs) =>
      prepareRetellTurn(
        { retell: { id: "r1" }, materials: [], topicName: "", settings: SETTINGS, ...(lineTs !== undefined ? { lineTs } : {}) } as never,
        { assembled, build: async () => turn as never },
      ),
  },
];

async function rig(c: Case, replies: string[], options: { tokensPerSecond?: number; file?: ThreadMessage[] } = {}) {
  const cards: { id: string; ts: number; text: string }[] = [];
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 400,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  const file = fakeThreads(options.file ?? [EARLIER, LINE]);
  const assembled = new Map<string, AssembledThreadTurn>();
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), `${c.name}-durable-`))),
    models,
    threads: file.threads,
    openDesk: async () => [],
    places: { [c.place]: c.factory(assembled, async (id, ts, text) => void cards.push({ id, ts, text })) },
    log: () => {},
  });
  return { durable, faux, file, assembled, cards };
}

function session(c: Case, durable: ReadingDurable, assembled: Map<string, AssembledThreadTurn>, options: { line?: boolean } = {}) {
  const withLine = options.line ?? true;
  let screen: CallRow[] = withLine ? [EARLIER, LINE] : [];
  let ended!: () => void;
  let ends = new Promise<void>((resolve) => (ended = resolve));
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  const s: PlaceSession = createPlaceSession({
    durable: () => Promise.resolve(durable),
    key: c.key,
    surface: "talk",
    assemble: () =>
      withLine
        ? c.prepare(assembled, built([...c.before, { role: "user", text: LINE.text }]), LINE.ts)
        : c.prepare(assembled, built([{ role: "user", text: RETELL_KICKOFF }])),
    lastLine: () => (withLine ? LINE.ts : 0),
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
      const ai = rows.find((r) => r.role === "ai" && r.streaming);
      if (ai && ai.text.length > 30) streamed();
    },
    file: () => {},
    streaming: (on) => {
      if (on) return;
      ended();
      ends = new Promise<void>((resolve) => (ended = resolve));
    },
  });
  return { s, screen: () => screen, streaming, ended: () => ends };
}

for (const c of CASES) {
  test(`${c.name}: a turn lands in the thread file once, history from the assembly`, async () => {
    const { durable, file, assembled, faux } = await rig(c, ["Slower in the middle."]);
    const view = session(c, durable, assembled);
    const ended = view.ended();
    view.s.ask();
    await ended;
    expect(view.screen().map((r) => [r.role, r.text])).toEqual([
      ["ai", EARLIER.text],
      ["user", LINE.text],
      ["ai", "Slower in the middle."],
    ]);
    expect(file.messages.map((m) => [m.role, m.text])).toEqual([
      ["ai", EARLIER.text],
      ["user", LINE.text],
      ["ai", "Slower in the middle."],
    ]);
    expect(file.messages[2]!.ts).toBe(view.screen()[2]!.ts);
    // The turn's line went once, after the assembly's history.
    const sent = faux.state.callCount;
    expect(sent).toBe(1);
    const history = await durable.places.get(c.place)!.readHistory(c.origin, { excludeTs: LINE.ts }, ctx);
    expect(history.map((m) => m.role)).toEqual(c.restartHistory);
    await durable.runtime.close(ctx);
  });

  test(`${c.name}: Stop keeps the half sentence on screen and in the file, and asks nothing again`, async () => {
    const { durable, faux, file, assembled } = await rig(c, [LONG], { tokensPerSecond: 60 });
    const view = session(c, durable, assembled);
    const ended = view.ended();
    view.s.ask();
    await view.streaming;
    view.s.stop();
    await ended;
    const half = view.screen()[2]!;
    expect(half.role).toBe("ai");
    expect(half.text.length).toBeGreaterThan(30);
    expect(LONG.startsWith(half.text)).toBe(true);
    expect(half.streaming).toBeUndefined();
    expect(file.messages[file.messages.length - 1]!.text).toBe(half.text);
    expect(faux.state.callCount).toBe(1);
    await durable.runtime.close(ctx);
  });

  test(`${c.name}: a turn in flight when the view opens is joined and lands; history off the file`, async () => {
    const { durable, faux, file, assembled } = await rig(c, [LONG.slice(0, 400)], { tokensPerSecond: 100 });
    await startTurn(
      durable.runtime,
      {
        key: c.key,
        origin: c.origin,
        content: LINE.text,
        sections: { [TURN_SECTION]: "You are the coach." },
        tools: [],
        model: { provider: "faux", modelId: "faux-1" },
        excludeTs: LINE.ts,
      },
      ctx,
    );
    const view = session(c, durable, assembled);
    const ended = view.ended();
    expect(await view.s.resume()).toBe(true);
    await view.streaming;
    await ended;
    expect(view.screen().map((r) => r.role)).toEqual(["ai", "user", "ai"]);
    expect(file.messages.map((m) => m.role)).toEqual(["ai", "user", "ai"]);
    expect(file.messages[2]!.text).toBe(LONG.slice(0, 400));
    expect(assembled.size).toBe(0);
    // Read off the file without the turn's line: what was said before it, then the reply that has landed.
    const history = await durable.places.get(c.place)!.readHistory(c.origin, { excludeTs: LINE.ts }, ctx);
    expect(history.map((m) => m.role)).toEqual([...c.restartHistory, "assistant"]);
    expect(faux.state.callCount).toBe(1);
    await durable.runtime.close(ctx);
  });

  // Closing the view is not Stop (docs/soul/87, 第二阶段「关对话不停回合」).
  test(`${c.name}: closed mid-answer, the turn runs on, lands once and puts one box card`, async () => {
    const reply = LONG.slice(0, 500);
    const { durable, faux, file, assembled, cards } = await rig(c, [reply], { tokensPerSecond: 100 });
    const open = watchOneThread(c.key);
    const view = session(c, durable, assembled);
    view.s.ask();
    await view.streaming;
    const drawn = view.screen().length;
    open();
    view.s.detach();
    await view.s.idle();
    expect(file.messages.filter((m) => m.role === "ai" && m.text === reply)).toHaveLength(1);
    expect(cards).toEqual([{ id: c.origin.id, ts: file.messages[file.messages.length - 1]!.ts, text: reply }]);
    // The closed view draws nothing more.
    expect(view.screen().length).toBe(drawn);
    expect(view.screen().some((r) => r.text === reply)).toBe(false);
    expect(faux.state.callCount).toBe(1);
    await durable.runtime.close(ctx);
  });

  test(`${c.name}: closed and opened again mid-answer, the new view follows the turn; it lands once, no card`, async () => {
    const reply = LONG.slice(0, 500);
    const { durable, faux, file, assembled, cards } = await rig(c, [reply], { tokensPerSecond: 100 });
    const first = watchOneThread(c.key);
    const view = session(c, durable, assembled);
    view.s.ask();
    await view.streaming;
    first();
    view.s.detach();
    const second = watchOneThread(c.key);
    const again = session(c, durable, assembled);
    const ended = again.ended();
    expect(await again.s.resume()).toBe(true);
    await again.streaming;
    expect(again.s.running()).toBe(true);
    await ended;
    second();
    expect(again.screen().map((r) => [r.role, r.text])).toEqual([
      ["ai", EARLIER.text],
      ["user", LINE.text],
      ["ai", reply],
    ]);
    expect(file.messages.filter((m) => m.role === "ai" && m.text === reply)).toHaveLength(1);
    expect(cards).toEqual([]);
    expect(faux.state.callCount).toBe(1);
    await durable.runtime.close(ctx);
  });
}

test("retell: the opening turn sends the kickoff as its line; the file gets only the reply", async () => {
  const retell = CASES[1]!;
  const { durable, faux, file, assembled } = await rig(retell, [], { file: [] });
  let sent = "";
  faux.setResponses([
    (context) => {
      sent = JSON.stringify(context);
      return fauxAssistantMessage(fauxText("Here is the skeleton. Which thread?"));
    },
  ]);
  const view = session(retell, durable, assembled, { line: false });
  const ended = view.ended();
  view.s.ask();
  await ended;
  expect(view.screen().map((r) => [r.role, r.text])).toEqual([["ai", "Here is the skeleton. Which thread?"]]);
  expect(file.messages.map((m) => [m.role, m.text])).toEqual([["ai", "Here is the skeleton. Which thread?"]]);
  expect(sent).toContain(JSON.stringify(RETELL_KICKOFF).slice(1, 41));
  expect(faux.state.callCount).toBe(1);
  // Off the file, a turn whose line is not a row (the kickoff) sends no second kickoff.
  assembled.clear();
  const history = await durable.places.get(RETELL_PLACE)!.readHistory(retell.origin, {}, ctx);
  expect(history.map((m) => m.role)).toEqual(["assistant"]);
  await durable.runtime.close(ctx);
});

test("prepare: a refusal is not sent, and a turn not ending on the reader's line is an error", async () => {
  const coach = CASES[0]!;
  const assembled = new Map<string, AssembledThreadTurn>();
  expect(await coach.prepare(assembled, { ...built([{ role: "user", text: "x" }]), refusal: "too big" }, 1)).toEqual({
    kind: "refused",
    message: "too big",
  });
  expect(assembled.size).toBe(0);
  await expect(coach.prepare(assembled, built([{ role: "ai", text: "x" }]), 1)).rejects.toThrow();
  const ok = await coach.prepare(assembled, built([...coach.before, { role: "user", text: LINE.text }]), LINE.ts);
  expect(ok.kind === "turn" && ok.request.line).toEqual({ text: LINE.text, ts: LINE.ts });
  expect(ok.kind === "turn" && ok.request.origin).toEqual({ place: COACH_PLACE, id: "o1" });
  expect(assembled.get(coach.key)!.history).toEqual(coach.before);
});
