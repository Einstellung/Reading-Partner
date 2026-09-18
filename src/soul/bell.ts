// Answering the bell (docs/55): the only way a turn starts that the reader did
// not start.
//
// A bell is not a message from the reader and is never written into the
// conversation. It is rendered into one line of prose, put at the end of what
// was said at the door today, and sent; what comes back is the soul talking to
// the reader, and that is what the day's file keeps. So the conversation holds
// only what the soul said, and the next turn replaying it sees a remark that
// arrived out of nowhere — which is what it was.
//
// The order at the end of a bell is the mailbox order the run ledger rests on:
// the reply is on disk, then `delivered`, then `ack`, then the run file's own
// `deliveredAt`. A turn that refused or
// failed acks nothing, and the bell is still queued for the next pass.
//
// Not every bell is a turn. A run a program delegated is answered by the ledger
// alone: acked, stamped, and nothing said (docs/55 step 12). Only its failure
// reaches the reader, as one card to decide about.
//
// One at a time. The soul's harness serialises turns anyway (legion/execute/
// held.ts), but a pass that fired every bell at once would queue a stack of
// turns behind a reader who is in the middle of one.
//
// Except where the reader is in the middle of one right there: a bell for a
// conversation that already has a turn running is put into that turn instead
// (docs/72). The soul is mid-answer to the reader, and a second turn behind it
// would answer the machine into a room the reader has left. The bell is acked
// when the model has actually been handed it, so a turn that ends first leaves
// the bell queued for the next pass.

import { appBells, type Bell, type BellStore } from "../legion/bell";
import { appRuns, type RunStore } from "../legion/run";
import { runAgentTurn, type AgentTool } from "../legion/execute/turn";
import type { SteerPort } from "../legion/execute/contract";
import type { HeldHarness } from "../legion/execute/held";
import type { DeskMessage } from "../desk";
import type { ProviderId } from "../ai";
import { appendMessage, createBookThread, flushThreads, getBookThread, loadThreads } from "../platform/app/threads";
import { toReasoning, type Settings } from "../platform/app/settings";
import { appBox, type BoxOrigin, type BoxStore } from "../box";
import { doorDate, doorKey, openDoorTurn } from "./door";
import {
  deliveryOpener,
  liveDeliverer,
  parseOrigin,
  type DeliveredTurn,
  type Delivery,
} from "./delivery";
import { soulHarness } from "./harness";

/** What one bell turn is sent. The default sender is the app's; tests pass one. */
export interface BellTurn {
  settings: Settings;
  systemPrompt: string;
  messages: DeskMessage[];
  tools: AgentTool[];
  harness: HeldHarness;
  threadId: string;
  signal?: AbortSignal;
  /**
   * The turn has a run to queue into. The place holding the conversation open
   * takes it, so the reader talking while the bell is being answered steers
   * that turn instead of starting a second one on the same thread (docs/72).
   */
  onSteerable?: (port: SteerPort) => void;
}

/** Runs one assembled bell turn and answers with what the soul said. */
export type SendBellTurn = (turn: BellTurn) => Promise<string>;

export interface AnswerBellDeps {
  settings: Settings;
  /** The inbox. The device's own unless a test hands one in. */
  bells?: BellStore;
  /** The hot layer, where an ack is stamped on the run the bell was about. */
  runs?: RunStore;
  /** The Red Box a delivered run leaves an item in. The device's own unless injected. */
  box?: BoxStore;
  /** The lane every soul turn runs on. */
  harness?: HeldHarness;
  send?: SendBellTurn;
  now?: () => number;
  newThreadId?: () => string;
  signal?: AbortSignal;
  /** A turn that could not be taken. The bell stays queued either way. */
  onTrouble?: (bell: Bell, reason: string) => void;
}

/**
 * What the model is told a bell is. Flat text, and it says in its first line
 * that legion sent it — a turn that mistook this for the reader speaking would
 * answer the machine instead of the person.
 */
export function renderBell(bell: Bell): string {
  const lines = ["[bell from legion — this was not said by the reader]"];
  if (bell.type === "run-done") {
    const { runId, kind, brief, truncated, output } = bell.payload;
    lines.push(`A run you delegated has finished: ${runId} (kind: ${kind}).`, "", brief);
    if (truncated) lines.push("", "The brief above was cut to fit; the whole of it is in the output.");
    if (output) lines.push("", `Everything the run produced is at: ${output}`);
  } else if (bell.type === "run-failed") {
    const { runId, kind, reason } = bell.payload;
    lines.push(
      `A run you delegated failed: ${runId} (kind: ${kind}).`,
      "",
      `Why: ${reason}`,
      "",
      "Nothing is retrying it on its own.",
    );
  } else {
    const { scheduleId, brief, truncated } = bell.payload;
    lines.push(`A schedule came due: ${scheduleId}.`, "", brief);
    if (truncated) lines.push("", "The brief above was cut to fit.");
  }
  lines.push(
    "",
    "Decide what to do about it, and say to the reader only what is worth saying.",
  );
  return lines.join("\n");
}

// The app's sender: the same call every other soul turn makes, on the same
// harness, with no streaming surface listening.
const appSend: SendBellTurn = (turn) =>
  new Promise<string>((resolve, reject) => {
    void runAgentTurn({
      providerId: turn.settings.defaultProviderId as ProviderId,
      modelId: turn.settings.defaultModelId as string,
      systemPrompt: turn.systemPrompt,
      messages: turn.messages,
      tools: turn.tools,
      harness: turn.harness,
      ...(turn.signal ? { signal: turn.signal } : {}),
      ...(turn.onSteerable ? { onSteerable: turn.onSteerable } : {}),
      reasoning: toReasoning(turn.settings.chatThinking),
      telemetry: { surface: "bell", thread: turn.threadId },
      // Nothing is watching this turn happen: there is no composer open and no
      // reader waiting on it. Only the end of it is of any interest.
      onDelta: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onDone: (finalText, _assistant, turnText) => resolve(turnText || finalText),
      onError: (message: string) => reject(new Error(message)),
      onRefusal: (message: string) => reject(new Error(message)),
    });
  });

/** How long a cover may be. One line on a card, and it is never rewritten (docs/60). */
export const COVER_MAX = 120;

/**
 * The first sentence of what the soul said, for the card in the box. Program
 * work, no model call: a second call to summarise one paragraph would cost a
 * turn to say what its first sentence already says.
 */
export function coverOf(reply: string): string {
  const text = reply.trim().replace(/\s+/g, " ");
  if (text === "") return "";
  const end = text.search(/[.!?。！？](\s|$)/u);
  const first = end === -1 ? text : text.slice(0, end + 1);
  return first.length > COVER_MAX ? `${first.slice(0, COVER_MAX - 1).trimEnd()}…` : first;
}

// Only one pass at a time in this process, whatever calls it — the tick, the
// way up, and a developer ringing a bell by hand all land here.
let pass: Promise<number> | null = null;

/**
 * Answer whatever is in the inbox, oldest first, and say how many were answered.
 * Cheap when there is nothing: one directory listing and out.
 */
export function answerBell(deps: AnswerBellDeps): Promise<number> {
  pass ??= runPass(deps).finally(() => {
    pass = null;
  });
  return pass;
}

async function runPass(deps: AnswerBellDeps): Promise<number> {
  const bells = deps.bells ?? appBells();
  const runs = deps.runs ?? appRuns();
  const queued = await bells.read();
  if (queued.length === 0) return 0;

  const send = deps.send ?? appSend;
  const harness = deps.harness ?? soulHarness();
  const now = deps.now ?? Date.now;
  const newThreadId = deps.newThreadId ?? (() => crypto.randomUUID());

  const box = deps.box ?? appBox();

  let answered = 0;
  for (const bell of queued) {
    if (deps.signal?.aborted) break;
    const at = now();
    const date = doorDate(new Date(at));
    // Where the question was asked (docs/68). A `local` run never reaches a file,
    // so the runner copies its deliverTo onto the bell; a synced run is read off
    // its own record, which is where another device's copy would be. The
    // delegator rides along for the same reason.
    let origin: BoxOrigin | null = null;
    if (bell.type !== "wake") {
      const run = await runs.get(bell.payload.runId).catch(() => null);
      const delegator = bell.payload.delegator ?? run?.delegator;
      // A run a program delegated was nobody's question: the domain that asked
      // for it has already put what came back where it belongs (the day's
      // collect round leaves its own card in the box), and there is no
      // conversation waiting on an answer. So no turn, no line in a thread, and
      // nothing in the box — the bell is only acknowledged.
      if (delegator?.kind === "program") {
        // Except when it failed. Then the work left nothing behind and nobody
        // would ever know, so it goes in the box as something to decide about,
        // with the error itself as the cover (docs/68).
        if (bell.type === "run-failed") {
          const { runId, kind, reason } = bell.payload;
          await box
            .put({
              boxId: runId,
              source: "run",
              cover: coverOf(reason) || `${kind} failed`,
              origin: { place: "door", date },
              kind,
              runId,
              needsDecision: true,
              at,
            })
            .catch((e) => console.warn(`run ${runId} failed and its box item would not write`, e));
        }
        await bells.delivered(bell.id);
        await bells.ack(bell.id);
        await runs.markDelivered(bell.payload.runId, now()).catch(() => null);
        answered += 1;
        continue;
      }
      origin = parseOrigin(bell.payload.deliverTo) ?? parseOrigin(run?.deliverTo);
    }
    const rendered = renderBell(bell);
    // A turn already running where the question was asked takes the bell as it
    // stands (docs/72): it goes into that turn's context as an internal steer
    // and nowhere else — no line in the thread file, no row of its own — and
    // what the soul says next is the delivery. Acked only once the model has
    // really been handed it; anything short of that leaves the bell queued.
    if (origin && bell.type !== "wake") {
      const { runId, kind } = bell.payload;
      const into = liveDeliverer(origin.place);
      const handed = into
        ? await into({ origin, bell: rendered, runId }).catch((e) => {
            console.warn(`a bell could not be put into the turn running at ${origin.place}`, e);
            return null;
          })
        : null;
      if (handed) {
        // Same rule as below: a card only where nobody was looking. A turn
        // running on a conversation is not the same thing as a reader in front
        // of it, so the question is asked rather than assumed.
        if (!handed.watching) {
          await box
            .put({
              boxId: runId,
              source: "run",
              // No reply to take a first sentence from: the soul is still
              // writing it. The run's own brief is what the card says instead.
              cover: coverOf(bell.type === "run-failed" ? bell.payload.reason : bell.payload.brief),
              ...(bell.type === "run-done" && bell.payload.output
                ? { body: bell.payload.output }
                : {}),
              origin,
              kind,
              runId,
              needsDecision: bell.type === "run-failed",
              at,
            })
            .catch((e) => console.warn(`run ${runId} was delivered but its box item would not write`, e));
        }
        await bells.delivered(bell.id);
        await bells.ack(bell.id);
        await runs.markDelivered(runId, now()).catch(() => null);
        answered += 1;
        continue;
      }
    }
    const placed = origin ? await openDelivery(origin, rendered, deps) : null;

    let key: string;
    let threadId: string;
    let turn: DeliveredTurn;
    if (placed) {
      ({ key, threadId } = placed);
      turn = placed.turn;
    } else {
      // The door: a bell about a run that named no place, or one whose place
      // could not be laid any more. It is also where a wake bell always lands.
      key = doorKey(date);
      // The day's file, and the one conversation held at the door that day. A bell
      // that arrives before the reader has said anything opens it.
      await loadThreads(key).catch(() => ({}));
      const thread = getBookThread(key) ?? createBookThread(key, newThreadId());
      threadId = thread.id;
      const history: DeskMessage[] = thread.messages.map((m) => ({ role: m.role, text: m.text }));
      const opened = await openDoorTurn({
        settings: deps.settings,
        threadId: thread.id,
        date,
        messages: [...history, { role: "user", text: rendered }],
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      // Aborted while the soul was being read: nothing was sent, so nothing is
      // owed, and the bell is where it was.
      if (!opened) break;
      turn = opened;
    }
    if (turn.refusal) {
      deps.onTrouble?.(bell, turn.refusal);
      break;
    }

    // The conversation is busy for as long as this turn runs: the reader's Stop
    // reaches it and their next line steers it rather than opening a second turn
    // on the same thread (docs/72). Only where the place knows what a running
    // turn is; the door does not.
    const hold = placed?.hold?.(deps.signal);
    let reply: string;
    try {
      reply = await send({
        settings: deps.settings,
        systemPrompt: turn.systemPrompt,
        messages: turn.messages,
        tools: turn.tools,
        harness,
        threadId,
        ...(hold ? { signal: hold.signal, onSteerable: hold.steerable } : {}),
        ...(!hold && deps.signal ? { signal: deps.signal } : {}),
      });
    } catch (e) {
      hold?.release();
      // Whatever went wrong with this turn will go wrong with the next bell too
      // — the same model, the same key, the same window. The pass stops and the
      // whole queue waits for the next tick.
      deps.onTrouble?.(bell, e instanceof Error ? e.message : String(e));
      break;
    }

    // A bell the soul decided to say nothing about is answered all the same: the
    // decision was the turn, and the ledger is waiting on the ack.
    if (reply.trim() !== "") {
      appendMessage(key, threadId, {
        role: "ai",
        text: reply,
        ts: now(),
        // What this line is an answer to. The reader never said anything it
        // could be read as answering, and the work order drawn on it is found
        // by this (docs/72).
        ...(bell.type !== "wake" ? { origin: { runId: bell.payload.runId } } : {}),
      });
      // On disk before the bell is confirmed. The store coalesces its writes,
      // so without this the ack could outlive the reply it is confirming.
      await flushThreads();
    }
    hold?.release();
    // The card that points back at the reply just written (docs/68). Program
    // work: the cover is the reply's first sentence, and the body is a reference
    // to what the run produced rather than the text of it. After the reply is on
    // disk and before the ack, so an item can never point at a conversation that
    // is not there.
    //
    // None of it when the reader is looking at that conversation as the reply
    // lands — the same rule a plain reading turn follows (reading/turn-box.ts).
    // A failure is no exception: what the reader has to decide about, they are
    // already reading. Asked now and not when the turn was assembled, because
    // the run took a while and they may have walked over to it in the meantime.
    if (bell.type !== "wake" && !placed?.watching?.()) {
      const { runId, kind } = bell.payload;
      await box
        .put({
          boxId: runId,
          source: "run",
          cover: coverOf(reply),
          ...(bell.type === "run-done" && bell.payload.output
            ? { body: bell.payload.output }
            : {}),
          origin: origin ?? { place: "door", date },
          kind,
          runId,
          needsDecision: bell.type === "run-failed",
          at,
        })
        .catch((e) => console.warn(`run ${runId} was answered but its box item would not write`, e));
    }
    await bells.delivered(bell.id);
    await bells.ack(bell.id);
    // The ack is what the fold waits on (docs/55), and the run file is where
    // the other device reads it: the bell itself is machine-local. Stamped
    // after the ack, so a stamp can never be ahead of the acknowledgement it
    // stands for. A wake bell is about a schedule and there is no run to stamp.
    // A `local` run is in the runner's own store and not on disk, so there is
    // nothing here to stamp; the stamp is what a second device reads, and a
    // local run has no second device.
    if (bell.type !== "wake") {
      await runs.markDelivered(bell.payload.runId, now()).catch(() => null);
    }
    answered += 1;
  }
  return answered;
}

export interface BellWatchDeps {
  /** Read per pass: settings change while the app is open. */
  settings: () => Settings;
  /** How often to look. The shell passes sync's tick, so there is one heartbeat. */
  intervalMs: number;
  onTrouble?: (bell: Bell, reason: string) => void;
}

/**
 * Look in the inbox now and every interval after. Returns the undo.
 *
 * Nothing in the product rings a bell yet (the runner is docs/55 step 7), so in
 * a dev build this also puts `window.__bell` on the page: `scripts/ios-sim.sh
 * eval 'window.__bell.ring("run-done", { runId: "r1", kind: "demo", brief: "…" })'`
 * rings one by hand and the next pass answers it.
 */
export function startBellWatch(deps: BellWatchDeps): () => void {
  const look = (): void => {
    void answerBell({
      settings: deps.settings(),
      ...(deps.onTrouble ? { onTrouble: deps.onTrouble } : {}),
    }).catch((e) => console.warn("bell pass failed", e));
  };
  look();
  const timer = setInterval(look, deps.intervalMs);
  const uninstallBridge = installBellBridge(look);
  return () => {
    clearInterval(timer);
    uninstallBridge();
  };
}

// The dev-only handle on the inbox, on the same channel scripts/ios-sim.sh
// already evaluates JavaScript through (scripts/sim-bridge.ts). Never in a
// production bundle: `import.meta.env.DEV` is false there and the whole block
// is dropped.
function installBellBridge(look: () => void): () => void {
  if (!import.meta.env?.DEV || typeof window === "undefined") return () => {};
  const bridge = {
    ring: async (type: string, payload: Record<string, unknown>) => {
      const bell = await appBells().ring(
        type as "run-done",
        payload as unknown as { runId: string; kind: string; brief: string },
      );
      look();
      return bell;
    },
    read: () => appBells().read(),
    answer: look,
  };
  (window as unknown as Record<string, unknown>).__bell = bridge;
  return () => {
    delete (window as unknown as Record<string, unknown>).__bell;
  };
}

// The turn for the place a run was delegated from, where a domain has said how
// that place is laid (delivery.ts). Null when nothing registered the place, or
// when the material is gone — and then the bell is answered at the door, which
// is where a conversation with nowhere else to go goes.
async function openDelivery(
  origin: BoxOrigin,
  bell: string,
  deps: AnswerBellDeps,
): Promise<Delivery | null> {
  const open = deliveryOpener(origin.place);
  if (!open) return null;
  return await open({
    origin,
    settings: deps.settings,
    bell,
    ...(deps.signal ? { signal: deps.signal } : {}),
  }).catch((e) => {
    console.warn(`a bell could not be answered where it was asked (${origin.place})`, e);
    return null;
  });
}
