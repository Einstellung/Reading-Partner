// The info voice call on the device's durable runtime (docs/soul/87, 第二阶段;
// docs/33 M-voice-3), with a faux provider, a bridge that answers every native
// command, and the app's thread store on an in-memory disk: what the call
// speaks, what lands in the day's thread, what a barge-in leaves, and what a
// line typed into the text chat during a voice turn does.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefingThreadId, type InfoCallAnchor } from "../../../src/info/briefer/anchors";
import { infoBookId } from "../../../src/info/briefer/call";
import { INFO_BRIEFING_KIND, registerInfoDesk } from "../../../src/info/briefer/desk";
import { infoAssemblies, infoPlace, infoThreadKey } from "../../../src/info/briefer/info-durable";
import { registerSecretaryRole } from "../../../src/info/briefer/role";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import * as settings from "../../../src/platform/app/settings";
import { DEFAULT_SETTINGS } from "../../../src/platform/app/settings";
import {
  appendMessage,
  createThread,
  flushThreads,
  getThread,
  loadThreads,
  rebuildThreadStoreForTests,
  type ThreadMessage,
} from "../../../src/platform/app/threads";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { heardRows, infoVoiceThread, voiceFeed, voiceStream } from "../../../src/reading/turn/info-voice";
import { createPlaceSession, registerOpenSession, withPlaceTurnRows } from "../../../src/reading/turn/place-session";
import { drivePlaceTurn } from "../../../src/reading/turn/book-turn-rows";
import { catalogDescribe } from "../../../src/legion/durable/device";
import type { TurnActivity } from "../../../src/ai/turn-view/activity";
import type { ConversationEvent, ConversationSource } from "../../../src/soul/voice/conversation";
import { createVoiceCall, KICKOFF_TURN, type VoiceCall } from "../../../src/soul/voice/voice-call";
import { INTERRUPTED_MARK } from "../../../src/soul/voice/voice-session";
import * as readableLazy from "../../../src/workshop/extract/readable-lazy";
import { testHost } from "../../legion/durable/support/runtime";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";
import { useDom } from "../../support/dom";
import { slowFauxModels } from "./support/file-threads";

// A window, for the thread store's debounced write (debounced-writer.ts).
await useDom();

registerInfoDesk();
registerSecretaryRole();

const DATE = "2026-09-06";
const BOOK = infoBookId(DATE);
const THREAD = briefingThreadId(DATE);
const KEY = infoThreadKey({ place: "info", date: DATE, threadId: THREAD });
const FILE = `threads-${BOOK}.json`;

let disk: FakeDisk;
let durable: ReadingDurable | undefined;
let cards: string[] = [];

beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
  cards = [];
  infoAssemblies.clear();
  spyOn(settings, "loadSettings").mockResolvedValue({ ...DEFAULT_SETTINGS, defaultProviderId: "faux", defaultModelId: "faux-1" });
  spyOn(readableLazy, "loadExtractReadable").mockResolvedValue((() => null) as never);
});

afterEach(async () => {
  await durable?.runtime.close(ctx);
  durable = undefined;
});

function anchor(): InfoCallAnchor {
  return {
    threadId: THREAD,
    emptyTitle: "Today's briefing",
    placeholder: "Ask…",
    desk: [{ kind: INFO_BRIEFING_KIND, ref: { dateKey: DATE, briefing: null, ctx: { reader: "", sources: [], collecting: true } } }],
    position: { title: "Today's briefing", line: null },
  };
}

async function runtime(replies: string[], tokensPerSecond = 2000) {
  const { models, faux } = slowFauxModels(replies, tokensPerSecond);
  durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "info-voice-"))),
    models,
    threads: storeThreadFiles({ load: loadThreads, get: getThread, append: appendMessage, flush: flushThreads }),
    openDesk: async () => [],
    places: {
      info: infoPlace({
        card: async (_origin, _ts, text) => {
          cards.push(text);
        },
      }),
    },
    log: () => {},
  });
  return { faux, durable };
}

async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A call with no plugin under it: the bridge answers every command and keeps what it was told to say. */
function harness(d: ReadingDurable, cutAt = 0) {
  let listener: ((e: ConversationEvent) => void) | null = null;
  const pushed: string[] = [];
  const activity: TurnActivity[] = [];
  const bridge: ConversationSource = {
    start: async (onEvent) => {
      listener = onEvent;
    },
    stop: async () => {
      listener = null;
    },
    setVolume: async () => {},
    speakBegin: async () => 7,
    speakPush: async (text) => {
      pushed.push(text);
    },
    speakClose: async () => {},
    speakStop: async () => ({ utterance: 7, sentence: cutAt, positionMs: 0, durationMs: 0 }),
  };
  const { model, transcript } = infoVoiceThread({
    bookId: BOOK,
    dateKey: DATE,
    anchor: anchor(),
    tools: async () => [],
    durable: () => Promise.resolve(d),
  });
  const call: VoiceCall = createVoiceCall({ bridge, model, transcript });
  call.subscribeActivity((e) => activity.push(e));
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await call.settled();
  };
  const emit = async (e: ConversationEvent) => {
    listener?.(e);
    await settle();
  };
  return {
    call,
    pushed,
    activity,
    emit,
    /** The model turn is over and the player is told it played everything. */
    async played(turn: number) {
      await until(() => call.snapshot().session.asked === null, `turn ${turn} answered`);
      await settle();
      await emit({ kind: "spoken", turn, utterance: 7, reason: "done" });
    },
  };
}

const messages = (): ThreadMessage[] => getThread(BOOK, THREAD)?.messages ?? [];

const GREETING = "Good morning. The rates moved overnight. What do you want to hear about?";
const ANSWER = "The central bank held rates. Markets had priced that in.";

test("the call speaks the stream, and its turns land in the day's thread once, on disk", async () => {
  const { faux, durable: d } = await runtime([GREETING, ANSWER]);
  const h = harness(d);
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await h.played(KICKOFF_TURN);
  await h.emit({ kind: "speech-end", turn: 1, text: "What about rates?", silentMs: 900 });
  await h.played(1);

  // The kickoff note is the driver's sentence, so turn 0 leaves only a reply.
  expect(messages().map((m) => [m.role, m.text])).toEqual([
    ["ai", GREETING],
    ["user", "What about rates?"],
    ["ai", ANSWER],
  ]);
  // What went to the synthesiser is the stream in its spoken form.
  expect(h.pushed[0]).toContain("Good morning");
  expect(h.pushed.join(" ")).toContain("Markets had priced that in");
  // The second turn was assembled over the thread: the greeting, then the line.
  expect(infoAssemblies.get(KEY)?.history).toEqual([{ role: "ai", text: GREETING }]);
  expect(faux.state.callCount).toBe(2);
  // The reader heard every reply: none is put in the box as one nobody saw.
  expect(cards).toEqual([]);
  // The same conversation the text chat opens.
  expect(getThread(BOOK, THREAD)?.annotationId).toBe("info");
  const until3s = Date.now() + 3000;
  while (disk.files.get(FILE) === undefined && Date.now() < until3s) await new Promise((r) => setTimeout(r, 20));
  const file = JSON.parse(disk.files.get(FILE) ?? "{}") as { threads: Record<string, { messages: ThreadMessage[] }> };
  expect(file.threads[THREAD]?.messages.map((m) => m.role)).toEqual(["ai", "user", "ai"]);
});

test("a thread the chat already made is written into, and its lines are the history", async () => {
  const made = createThread(BOOK, "info", THREAD);
  made.messages.push({ role: "user", text: "Asked this morning", ts: 1 }, { role: "ai", text: "Answered then.", ts: 2 });
  const { durable: d } = await runtime([GREETING]);
  const h = harness(d);
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await h.played(KICKOFF_TURN);
  expect(getThread(BOOK, THREAD)).toBe(made);
  expect(made.messages.map((m) => m.text)).toEqual(["Asked this morning", "Answered then.", GREETING]);
  expect(infoAssemblies.get(KEY)?.history).toEqual([
    { role: "user", text: "Asked this morning" },
    { role: "ai", text: "Answered then." },
  ]);
});

const LONG = `First, the rates moved. ${"Then the chips came up again. ".repeat(60)}`;

test("a barge-in stops the turn: one reply lands, cut where the reader talked over it, and the next turn follows it", async () => {
  const { faux, durable: d } = await runtime([LONG, ANSWER], 150);
  const h = harness(d);
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await until(() => h.pushed.length >= 2, "two pushes of the greeting");
  // The reader talks over the greeting, then asks.
  await h.emit({ kind: "speech-stop", turn: 1, cut: { utterance: 7, sentence: 0, charOffset: 4, playedMs: 300 } });
  await h.emit({ kind: "speech-end", turn: 1, text: "What happened?", silentMs: 900 });
  await h.played(1);

  // The synthesiser's first piece is the first clause.
  const heard = `First,\n${INTERRUPTED_MARK}`;
  expect(messages().map((m) => [m.role, m.text])).toEqual([
    ["ai", heard],
    ["user", "What happened?"],
    ["ai", ANSWER],
  ]);
  // The next turn was assembled over what was heard, after the stopped one landed.
  expect(infoAssemblies.get(KEY)?.history).toEqual([{ role: "ai", text: heard }]);
  expect(faux.state.callCount).toBe(2);
  expect((await d.runtime.harness.inspect(ctx)).tasks.length).toBe(0);
}, 30_000);

test("a line typed into the open chat during a voice turn goes into it, not into a second turn", async () => {
  const A = `The rates held. ${"Markets shrugged. ".repeat(25)}`;
  const B = "The chips rules start next month.";
  const { faux, durable: d } = await runtime([GREETING, A, B], 200);
  let screen: CallRow[] = [];
  const filed: { text: string; ts: number }[] = [];
  const session = createPlaceSession({
    durable: () => Promise.resolve(d),
    key: KEY,
    surface: "info",
    assemble: async () => ({ kind: "failed", message: "the chat was not asked" }),
    lastLine: () => 0,
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
    },
    file: (lines) => filed.push(...lines),
    streaming: () => {},
  });
  const closed = registerOpenSession(KEY, session);
  try {
    const h = harness(d);
    await h.call.start();
    await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
    await h.played(KICKOFF_TURN);
    await h.emit({ kind: "speech-end", turn: 1, text: "What about rates?", silentMs: 900 });
    await until(() => session.running() && screen.some((r) => r.role === "ai" && r.streaming && r.text.length > 20), "the voice turn streaming in the chat");
    expect(screen.some((r) => r.role === "user" && r.text === "What about rates?")).toBe(true);
    expect(session.say("And the chips?", Date.now())).toBe(true);
    await h.played(1);
    await session.idle();

    expect(messages().map((m) => [m.role, m.text.trim()])).toEqual([
      ["ai", GREETING],
      ["user", "What about rates?"],
      ["ai", A.trim()],
      ["user", "And the chips?"],
      ["ai", B],
    ]);
    // The reply to the typed line was spoken too, in the same turn.
    expect(h.pushed.join(" ")).toContain(B);
    expect(faux.state.callCount).toBe(3);
    expect(filed).toEqual([]);
    // The chat drew the whole call: each spoken line above its reply.
    expect(screen.map((r) => [r.role, r.text.trim()])).toEqual([
      ["ai", GREETING],
      ["user", "What about rates?"],
      ["ai", A.trim()],
      ["user", "And the chips?"],
      ["ai", B],
    ]);
  } finally {
    closed();
  }
}, 30_000);

test("closing the chat during a voice turn does not stop it: the call speaks it to the end and it lands once", async () => {
  const A = `The rates held. ${"Markets shrugged. ".repeat(25)}`;
  const { faux, durable: d } = await runtime([GREETING, A], 200);
  let screen: CallRow[] = [];
  const session = createPlaceSession({
    durable: () => Promise.resolve(d),
    key: KEY,
    surface: "info",
    assemble: async () => ({ kind: "failed", message: "the chat was not asked" }),
    lastLine: () => 0,
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
    },
    file: () => {},
    streaming: () => {},
  });
  const closed = registerOpenSession(KEY, session);
  const h = harness(d);
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await h.played(KICKOFF_TURN);
  await h.emit({ kind: "speech-end", turn: 1, text: "What about rates?", silentMs: 900 });
  await until(() => session.running() && screen.some((r) => r.role === "ai" && r.streaming && r.text.length > 20), "the voice turn streaming in the chat");
  // The chat closes as the hook's cleanup does it.
  session.detach();
  closed();
  await h.played(1);
  await session.idle();

  expect(messages().map((m) => [m.role, m.text.trim()])).toEqual([
    ["ai", GREETING],
    ["user", "What about rates?"],
    ["ai", A.trim()],
  ]);
  expect(h.pushed.join("")).toContain("Markets shrugged. Markets shrugged.");
  expect(faux.state.callCount).toBe(2);
}, 30_000);

test("the stream joins a turn's replies, and every tool that goes out comes back once", () => {
  const deltas: string[] = [];
  const activity: string[] = [];
  const feed = voiceFeed({
    onDelta: (c) => deltas.push(c),
    onActivity: (e) => activity.push(`${e.phase}:${e.name}`),
  });
  const line: CallRow = { role: "user", text: "Q", ts: 1 };
  feed.push([line, { role: "ai", text: "Let me ", ts: 2, streaming: true }]);
  feed.push([line, { role: "ai", text: "Let me look.", ts: 2, tools: [{ name: "read_page", label: "Read", state: "running" }] }]);
  feed.push([
    line,
    { role: "ai", text: "Let me look.", ts: 2, tools: [{ name: "read_page", label: "Read", state: "done" }] },
    { role: "ai", text: "It says yes.", ts: 3 },
  ]);
  expect(deltas).toEqual(["Let me ", "look.", "\nIt says yes."]);
  expect(activity).toEqual(["start:read_page", "end:read_page"]);
  expect(voiceStream([line, { role: "ai", text: "", ts: 2 }, { role: "ai", text: "B", ts: 3 }])).toEqual({
    text: "B",
    spans: [{ ts: 3, start: 0, end: 1 }],
  });
});

test("what was heard maps onto the landed rows: the cut row shortened and marked, the rest emptied", () => {
  const { text, spans } = voiceStream([
    { role: "ai", text: "One. Two.", ts: 10 },
    { role: "ai", text: "Three. Four.", ts: 11 },
    { role: "ai", text: "Five.", ts: 12 },
  ]);
  expect(heardRows(text, spans, { role: "ai", turn: 1, text: `One. Two.\nThree.\n${INTERRUPTED_MARK}`, interrupted: true })).toEqual([
    { ts: 10, text: "One. Two." },
    { ts: 11, text: `Three.\n${INTERRUPTED_MARK}` },
    { ts: 12, text: "" },
  ]);
  expect(heardRows(text, spans, { role: "ai", turn: 1, text: text, interrupted: false })).toEqual([
    { ts: 10, text: "One. Two." },
    { ts: 11, text: "Three. Four." },
    { ts: 12, text: "Five." },
  ]);
  expect(heardRows(text, spans, { role: "ai", turn: 1, text: "Something else", interrupted: false })).toEqual([]);
});

// A turn with nobody's session under it: a bell's headless one, one a closed chat left, one recovery resumed.
async function otherTurn(d: ReadingDurable, line: { text: string; ts?: number }, bell?: string, onRows: (rows: CallRow[]) => void = () => {}) {
  infoAssemblies.set(KEY, { history: [{ role: "ai", text: GREETING }], tools: [] });
  return drivePlaceTurn(
    d,
    {
      key: KEY,
      origin: { place: "info", date: DATE, threadId: THREAD },
      conversation: THREAD,
      surface: "info",
      line,
      ...(bell ? { bell: { id: bell } } : {}),
      systemPrompt: "You are the secretary.",
      tools: [],
      model: { provider: "faux", modelId: "faux-1" },
      describe: catalogDescribe([]),
    },
    onRows,
  );
}

/** Every time the call gave up on a line it was asked. */
function callFailures() {
  const failed: unknown[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (args[0] === "voice call model turn failed") failed.push(args[1]);
  });
  return { failed, restore: () => spy.mockRestore() };
}

const BELL_REPLY = `Your run finished. ${"The digest is in the box. ".repeat(20)}`;

test("a line spoken while a bell's turn runs with nobody looking waits for it, then is answered once over what it landed", async () => {
  const { faux, durable: d } = await runtime([GREETING, BELL_REPLY, ANSWER], 200);
  const failures = callFailures();
  try {
    const h = harness(d);
    await h.call.start();
    await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
    await h.played(KICKOFF_TURN);
    let streamed = false;
    const bell = await otherTurn(d, { text: "[bell] A run finished." }, "bell-1", (rows) => {
      if (rows.some((r) => r.role === "ai" && r.text.length > 20)) streamed = true;
    });
    await until(() => streamed, "the bell's turn streaming");
    await h.emit({ kind: "speech-end", turn: 1, text: "What about rates?", silentMs: 900 });
    // Waiting is not failing: the line is still being asked.
    expect(failures.failed).toEqual([]);
    expect(h.call.snapshot().session.asked).not.toBeNull();
    expect((await bell.ended).kind).toBe("answered");
    await h.played(1);

    expect(failures.failed).toEqual([]);
    const said = messages().map((m) => [m.role, m.text.trim()]);
    expect(said.filter(([, t]) => t === "What about rates?")).toHaveLength(1);
    expect(said.filter(([, t]) => t === ANSWER)).toHaveLength(1);
    expect(said[said.length - 1]).toEqual(["ai", ANSWER]);
    expect(said.some(([r, t]) => r === "ai" && t === BELL_REPLY.trim())).toBe(true);
    // Assembled after the bell's reply landed, with it in the history.
    expect(infoAssemblies.get(KEY)?.history.some((m) => m.text.trim() === BELL_REPLY.trim())).toBe(true);
    expect(h.pushed.join(" ")).toContain("Markets had priced that in");
    expect(h.pushed.join(" ")).not.toContain("The digest is in the box");
    expect(faux.state.callCount).toBe(3);
  } finally {
    failures.restore();
  }
}, 30_000);

test("a line spoken while the open chat follows a resumed turn waits for it, then runs in the chat", async () => {
  const RESUMED = `Picking up where I was. ${"The chips story again. ".repeat(20)}`;
  const { faux, durable: d } = await runtime([GREETING, RESUMED, ANSWER], 200);
  const failures = callFailures();
  let screen: CallRow[] = [];
  const session = createPlaceSession({
    durable: () => Promise.resolve(d),
    key: KEY,
    surface: "info",
    assemble: async () => ({ kind: "failed", message: "the chat was not asked" }),
    lastLine: () => 0,
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
    },
    file: () => {},
    streaming: () => {},
  });
  const h = harness(d);
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await h.played(KICKOFF_TURN);
  // A turn nothing on screen started, followed by the chat opened on it.
  let streamed = false;
  await otherTurn(d, { text: "Go on about the chips." }, undefined, (rows) => {
    if (rows.some((r) => r.role === "ai" && r.text.length > 20)) streamed = true;
  });
  await until(() => streamed, "the resumed turn streaming");
  const closed = registerOpenSession(KEY, session);
  try {
    expect(await session.resume()).toBe(true);
    await h.emit({ kind: "speech-end", turn: 1, text: "What about rates?", silentMs: 900 });
    expect(failures.failed).toEqual([]);
    await h.played(1);
    await session.idle();

    expect(failures.failed).toEqual([]);
    const said = messages().map((m) => [m.role, m.text.trim()]);
    expect(said.filter(([, t]) => t === ANSWER)).toHaveLength(1);
    expect(said[said.length - 1]).toEqual(["ai", ANSWER]);
    expect(faux.state.callCount).toBe(3);
    // The chat drew both turns, the spoken line above the reply to it, each once.
    const drawn = screen.map((r) => [r.role, r.text.trim()]);
    expect(drawn.filter(([, t]) => t === "What about rates?")).toHaveLength(1);
    expect(drawn.slice(-2)).toEqual([
      ["user", "What about rates?"],
      ["ai", ANSWER],
    ]);
    expect(drawn.some(([r, t]) => r === "ai" && t === RESUMED.trim())).toBe(true);
  } finally {
    closed();
    failures.restore();
  }
}, 30_000);

test("a line spoken during a text turn the reader closed the chat on waits for it, then is answered once", async () => {
  const TYPED = `The rates held. ${"Markets shrugged. ".repeat(20)}`;
  const B = "The chips rules start next month.";
  const { faux, durable: d } = await runtime([GREETING, TYPED, B], 200);
  const failures = callFailures();
  let screen: CallRow[] = [];
  const typed = { role: "user" as const, text: "Did the rates move?", ts: 0 };
  const session = createPlaceSession({
    durable: () => Promise.resolve(d),
    key: KEY,
    surface: "info",
    assemble: async () => {
      infoAssemblies.set(KEY, { history: [{ role: "ai", text: GREETING }], tools: [] });
      return {
        kind: "turn",
        request: {
          key: KEY,
          origin: { place: "info", date: DATE, threadId: THREAD },
          conversation: THREAD,
          surface: "info",
          line: { text: typed.text, ts: typed.ts },
          systemPrompt: "You are the secretary.",
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
        },
      };
    },
    lastLine: () => typed.ts,
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
    },
    file: () => {},
    streaming: () => {},
  });
  const closed = registerOpenSession(KEY, session);
  const h = harness(d);
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await h.played(KICKOFF_TURN);
  try {
    // The reader types into the chat, and closes it while the answer is written.
    typed.ts = Date.now();
    appendMessage(BOOK, THREAD, typed);
    session.ask();
    await until(() => screen.some((r) => r.role === "ai" && r.streaming && r.text.length > 20), "the typed turn streaming");
    session.detach();
    closed();
    await h.emit({ kind: "speech-end", turn: 1, text: "And the chips?", silentMs: 900 });
    expect(failures.failed).toEqual([]);
    await h.played(1);

    expect(failures.failed).toEqual([]);
    // The spoken line went into the file when it was said, before the typed turn landed.
    expect(messages().map((m) => [m.role, m.text.trim()])).toEqual([
      ["ai", GREETING],
      ["user", typed.text],
      ["user", "And the chips?"],
      ["ai", TYPED.trim()],
      ["ai", B],
    ]);
    expect(infoAssemblies.get(KEY)?.history.map((m) => m.text.trim())).toEqual([GREETING, typed.text, TYPED.trim()]);
    // The call spoke its own turn only.
    expect(h.pushed.join(" ")).toContain(B);
    expect(h.pushed.join(" ")).not.toContain("Markets shrugged");
    expect(faux.state.callCount).toBe(3);
  } finally {
    closed();
    failures.restore();
  }
}, 30_000);
