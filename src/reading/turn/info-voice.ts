// The info voice call's turns on the device's durable runtime (docs/soul/87,
// 第二阶段; docs/33 M-voice-3). A call is the day's info conversation in
// another modality: every turn is a turn of the same conversation the text
// chat holds (info/briefer/info-durable.ts), assembled by prepareInfoTurn,
// landed and recovered by the runtime like the chat's.
//
// What the call adds is what it does with the turn. The rows each view
// projects are read as one stream of text, whose growth goes to the
// synthesiser, and their tools' starts and ends go to the body. A barge-in
// stops the turn, and the half sentence lands. The transcript writes the
// reader's lines; the reply is the runtime's to land, and what the transcript
// is told about it afterwards — the part the reader heard, cut where they
// talked over it — is patched onto the landed rows, so the conversation keeps
// what was heard (docs/33 "交互").
//
// One conversation, one turn at a time: with the text chat open on it the
// turn runs in the chat's session (place-session.ts voice()), so the chat
// shows it and a line typed meanwhile goes into it; with nothing open it runs
// on its own, and a chat opened during it follows it (resume()). A line spoken
// while another turn runs on the conversation — the reader's, a bell's, one a
// closed chat left running, one recovery resumed — waits for it to land and is
// then assembled over what it left, as a bell does (place-bell.ts). It is not
// steered into that turn: the call speaks only its own turns.
//
// Lives here and not in info/briefer: it drives place-session.ts, and
// reading/turn already depends on info/briefer (info-bell.ts).

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { replayableHistory } from "../../ai/turn-view/turn-rows";
import type { TurnActivity } from "../../ai/turn-view/activity";
import { catalogDescribe, type DeviceDurable } from "../../legion/durable/device";
import { turnInFlight, TurnBusy } from "../../legion/durable/turn";
import { STALL_MESSAGE } from "../../legion/execute/stall";
import type { AgentTool } from "../../legion/execute/contract";
import {
  appendMessage,
  createThread,
  getThread,
  patchThreadMessage,
  type ThreadStore,
} from "../../platform/app/threads";
import {
  infoThreadKey,
  infoThreadOrigin,
  prepareInfoTurn,
  watchInfoConversation,
  type InfoTurnPrepared,
} from "../../info/briefer/info-durable";
import type { InfoCallAnchor } from "../../info/briefer/anchors";
import type { VoiceCallModel, VoiceCallTranscript } from "../../soul/voice/voice-call";
import { INTERRUPTED_MARK, type VoiceTurn } from "../../soul/voice/voice-session";
import { drivePlaceTurn, type BookTurnEnd } from "./book-turn-rows";
import { turnsStarting } from "./detached-turns";
import type { CallRow } from "./call-state";
import { readingDurable } from "./durable-runtime";
import type { StallOptions } from "./durable-turn";
import { openPlaceSession, type PlaceBellRequest, type PlaceSession } from "./place-session";

/** One reply row's text inside the stream the call speaks. */
export interface VoiceSpan {
  ts: number;
  start: number;
  end: number;
}

/** The text a turn's rows say, in order: its replies joined, and where each one sits. */
export function voiceStream(rows: readonly CallRow[]): { text: string; spans: VoiceSpan[] } {
  let text = "";
  const spans: VoiceSpan[] = [];
  for (const row of rows) {
    if (row.role !== "ai" || row.text === "") continue;
    if (text !== "") text += "\n";
    spans.push({ ts: row.ts, start: text.length, end: text.length + row.text.length });
    text += row.text;
  }
  return { text, spans };
}

/**
 * Every view's rows, as the call hears them: what the stream grew by, and the
 * tools that went out or came back since the last view.
 */
export function voiceFeed(out: { onDelta(chunk: string): void; onActivity(event: TurnActivity): void }): {
  push(rows: readonly CallRow[]): void;
} {
  let fed = "";
  const tools = new Map<string, boolean>();
  return {
    push(rows) {
      const { text } = voiceStream(rows);
      if (text.length > fed.length && text.startsWith(fed)) {
        out.onDelta(text.slice(fed.length));
        fed = text;
      }
      for (const row of rows) {
        if (row.role !== "ai") continue;
        (row.tools ?? []).forEach((tool, i) => {
          const id = `${row.ts}:${i}`;
          const over = tool.state !== "running";
          const was = tools.get(id);
          if (was === undefined) out.onActivity({ kind: "tool", name: tool.name, phase: "start" });
          if (was !== true && over) out.onActivity({ kind: "tool", name: tool.name, phase: "end" });
          tools.set(id, over);
        });
      }
    },
  };
}

/**
 * The landed reply rows rewritten to what the reader heard: `heard` is the
 * transcript's entry for the turn, a trimmed prefix of `stream`, marked when
 * they talked over it. A row past the cut was never heard and keeps no text.
 * Empty when the entry is not a prefix of what landed.
 */
export function heardRows(stream: string, spans: readonly VoiceSpan[], heard: VoiceTurn): { ts: number; text: string }[] {
  const mark = `\n${INTERRUPTED_MARK}`;
  const said = heard.interrupted && heard.text.endsWith(mark) ? heard.text.slice(0, -mark.length) : heard.text;
  const lead = stream.length - stream.trimStart().length;
  const cut = lead + said.length;
  if (stream.slice(lead, cut) !== said) return [];
  const rows = spans.map((span) => ({
    ts: span.ts,
    text: span.end <= cut ? stream.slice(span.start, span.end) : span.start < cut ? stream.slice(span.start, cut).trimEnd() : "",
  }));
  if (heard.interrupted) {
    const last = rows.map((r) => r.text !== "").lastIndexOf(true);
    if (last >= 0) rows[last] = { ...rows[last]!, text: `${rows[last]!.text}${mark}` };
  }
  return rows;
}

/** The thread store calls the call makes: the app's, or a test's over a directory. */
export type VoiceThreadStore = Pick<ThreadStore, "get" | "create" | "append" | "patch">;

const appStore: VoiceThreadStore = {
  get: getThread,
  create: createThread,
  append: appendMessage,
  patch: patchThreadMessage,
};

export interface InfoVoiceOptions {
  bookId: string;
  /** The day the call is about. */
  dateKey: string;
  anchor: InfoCallAnchor;
  tools: () => Promise<AgentTool[]>;
  store?: VoiceThreadStore;
  durable?: () => Promise<DeviceDurable> | undefined;
  /** The session a surface has open on the conversation, if any. */
  session?: (key: string) => PlaceSession | undefined;
  prepare?: (input: Parameters<typeof prepareInfoTurn>[0]) => Promise<InfoTurnPrepared>;
  stall?: StallOptions;
  now?: () => number;
  /** Mark the conversation as being looked at; the returned function takes that back. */
  watch?: (key: string) => () => void;
}

interface Reply {
  /** What landed, once the turn has settled. */
  landed?: { stream: string; spans: VoiceSpan[] };
  /** What the transcript says was heard of it. */
  heard?: VoiceTurn;
}

/** The two ports a voice call takes (soul/voice/voice-call.ts), on the day's info conversation. */
const BUSY = Symbol("busy");

export function infoVoiceThread(opts: InfoVoiceOptions): { model: VoiceCallModel; transcript: VoiceCallTranscript } {
  const store = opts.store ?? appStore;
  const now = opts.now ?? Date.now;
  const durable = opts.durable ?? readingDurable;
  const sessionOf = opts.session ?? openPlaceSession;
  const prepare = opts.prepare ?? prepareInfoTurn;
  const watch = opts.watch ?? watchInfoConversation;
  const { bookId } = opts;
  const threadId = opts.anchor.threadId;
  // Keyed by the call's turn numbers, which start again with every call.
  let lines = new Map<number, number>();
  let replies = new Map<number, Reply>();
  let last = 0;

  const stamp = () => {
    // Messages are addressed by their stamp, and two of a call's turns can land in the same millisecond.
    const ts = Math.max(now(), last + 1);
    last = ts;
    return ts;
  };

  const patchHeard = (reply: Reply) => {
    if (!reply.landed || !reply.heard) return;
    const have = store.get(bookId, threadId)?.messages ?? [];
    for (const row of heardRows(reply.landed.stream, reply.landed.spans, reply.heard)) {
      const was = have.find((m) => m.role === "ai" && m.ts === row.ts);
      if (was && was.text.trim() !== row.text.trim()) store.patch(bookId, threadId, row.ts, { text: row.text });
    }
  };

  const transcript: VoiceCallTranscript = {
    begin() {
      lines = new Map();
      replies = new Map();
      // The call is often the day's first way into the conversation, and a
      // message appended to a thread that is not there is dropped in silence
      // (threads.ts). Same id and anchor as use-info-call.ts.
      if (!store.get(bookId, threadId)) store.create(bookId, "info", threadId);
    },
    record(entry) {
      if (entry.role === "user") {
        const at = lines.get(entry.turn);
        if (at !== undefined) {
          store.patch(bookId, threadId, at, { text: entry.text });
          return;
        }
        const ts = stamp();
        lines.set(entry.turn, ts);
        store.append(bookId, threadId, { role: "user", text: entry.text, ts });
        return;
      }
      const reply = replies.get(entry.turn);
      if (!reply) return;
      reply.heard = entry;
      patchHeard(reply);
    },
  };

  // Resolves once no turn runs on the conversation, or the signal has gone.
  async function quiet(runtime: DeviceDurable, key: string, signal: AbortSignal): Promise<void> {
    const gone = new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    for (;;) {
      if (signal.aborted) return;
      const session = sessionOf(key);
      if (session?.running()) {
        await Promise.race([session.idle(), gone]);
        continue;
      }
      // One being assembled, then one with no session of its own (a bell's, a closed chat's, a resumed one).
      await Promise.race([turnsStarting(key), gone]);
      if (signal.aborted) return;
      const found = await turnInFlight(runtime.runtime, key, BACKGROUND_CONTEXT);
      if (!found) return;
      await Promise.race([found.settled, gone]);
    }
  }

  // The turn in the open conversation's session, or on its own; null when the
  // signal went first, BUSY when another turn got the conversation first.
  async function run(
    runtime: DeviceDurable,
    request: PlaceBellRequest,
    after: number,
    onRows: (rows: CallRow[]) => void,
    signal: AbortSignal,
  ): Promise<BookTurnEnd | null | typeof BUSY> {
    if (signal.aborted) return null;
    const session = sessionOf(request.key);
    if (session?.running()) return BUSY;
    try {
      const turn = session
        ? session.voice(after, request, onRows)
        : await drivePlaceTurn(runtime, { ...request, ...opts.stall }, onRows);
      if (!turn) return BUSY;
      const stop = () => turn.stop();
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      try {
        return await turn.ended;
      } finally {
        signal.removeEventListener("abort", stop);
      }
    } catch (e) {
      if (e instanceof TurnBusy) return BUSY;
      throw e;
    }
  }

  async function answer({ turn, text, onDelta, onActivity, signal }: Parameters<VoiceCallModel["ask"]>[0]): Promise<void> {
    // The reader's line is in the thread already (the machine records before
    // it asks); the opening turn's kickoff is the driver's and has no line.
    const lineTs = lines.get(turn);
    const started = durable();
    if (!started) throw new Error("the turn runtime has not started");
    const runtime = await started;
    const key = infoThreadKey(infoThreadOrigin(opts.anchor, opts.dateKey));
    let end: BookTurnEnd | null | typeof BUSY = BUSY;
    let reply: Reply = {};
    while (end === BUSY) {
      // Another turn on the conversation lands first, and this one is assembled over what it left.
      await quiet(runtime, key, signal);
      if (signal.aborted) return;
      // The line by role as well as stamp: a reply can land in the same millisecond (docs/pitfall/554).
      const others = (store.get(bookId, threadId)?.messages ?? []).filter((m) => !(m.role === "user" && m.ts === lineTs));
      const prepared = await prepare({
        anchor: opts.anchor,
        key: bookId,
        dateKey: opts.dateKey,
        signal,
        messages: [...replayableHistory(others), { role: "user", text }],
        // No meals tools: a call is only ever anchored to a day.
        companionTools: opts.tools,
      });
      if (signal.aborted) return;
      if (prepared.kind === "failed") throw new Error(prepared.message);
      // Abandoned, or too big to leave the model room to answer: the floor goes back to the reader.
      if (prepared.kind !== "turn") return;
      const request: PlaceBellRequest = {
        key: prepared.key,
        origin: prepared.origin,
        conversation: threadId,
        surface: "info",
        line: { text: prepared.line, ...(lineTs !== undefined ? { ts: lineTs } : {}) },
        systemPrompt: prepared.systemPrompt,
        tools: prepared.tools,
        model: prepared.model,
        ...(prepared.thinkingLevel ? { thinkingLevel: prepared.thinkingLevel } : {}),
        describe: catalogDescribe(prepared.tools),
      };
      reply = {};
      replies.set(turn, reply);
      const feed = voiceFeed({ onDelta, onActivity });
      // The turn's rows go under the line, and under what a turn that landed after the line left.
      const stamps = others.map((m) => m.ts);
      const after = lineTs !== undefined ? Math.max(lineTs - 1, ...stamps) : Math.max(now(), ...stamps);
      // The reader hears the reply as it is written: it lands as one they saw, without a box card.
      const unwatch = watch(prepared.key);
      try {
        end = await run(runtime, request, after, (rows) => feed.push(rows), signal);
      } finally {
        unwatch();
      }
    }
    if (!end) return;
    // Cut by the stall watch: nothing landed.
    if (end.kind === "stalled") throw new Error(STALL_MESSAGE);
    const landed = voiceStream(end.rows);
    reply.landed = { stream: landed.text, spans: landed.spans };
    patchHeard(reply);
    if (end.kind === "failed") throw new Error(end.message);
  }

  // The turn before, until it has landed. A barge-in stops a turn and asks the
  // next at once; the stopped one is still landing, so the next would be
  // refused (TurnBusy) and would be assembled without the reply it follows.
  let landing: Promise<unknown> = Promise.resolve();

  const model: VoiceCallModel = {
    ask(req) {
      const asked = landing.then(() => answer(req));
      landing = asked.catch(() => {});
      return asked;
    },
  };

  return { model, transcript };
}
