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
// the reply is on disk, then `delivered`, then `ack`. A turn that refused or
// failed acks nothing, and the bell is still queued for the next pass.
//
// One at a time. The soul's harness serialises turns anyway (legion/execute/
// held.ts), but a pass that fired every bell at once would queue a stack of
// turns behind a reader who is in the middle of one.

import { appBells, type Bell, type BellStore } from "../legion/bell";
import { runAgentTurn, type AgentTool } from "../legion/execute/turn";
import type { HeldHarness } from "../legion/execute/held";
import type { DeskMessage } from "../desk";
import type { ProviderId } from "../ai";
import { appendMessage, createBookThread, flushThreads, getBookThread, loadThreads } from "../platform/app/threads";
import { toReasoning, type Settings } from "../platform/app/settings";
import { doorDate, doorKey, openDoorTurn } from "./door";
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
}

/** Runs one assembled bell turn and answers with what the soul said. */
export type SendBellTurn = (turn: BellTurn) => Promise<string>;

export interface AnswerBellDeps {
  settings: Settings;
  /** The inbox. The device's own unless a test hands one in. */
  bells?: BellStore;
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
  const queued = await bells.read();
  if (queued.length === 0) return 0;

  const send = deps.send ?? appSend;
  const harness = deps.harness ?? soulHarness();
  const now = deps.now ?? Date.now;
  const newThreadId = deps.newThreadId ?? (() => crypto.randomUUID());

  let answered = 0;
  for (const bell of queued) {
    if (deps.signal?.aborted) break;
    const at = now();
    const date = doorDate(new Date(at));
    const key = doorKey(date);
    // The day's file, and the one conversation held at the door that day. A bell
    // that arrives before the reader has said anything opens it.
    await loadThreads(key).catch(() => ({}));
    const thread = getBookThread(key) ?? createBookThread(key, newThreadId());

    const history: DeskMessage[] = thread.messages.map((m) => ({ role: m.role, text: m.text }));
    const turn = await openDoorTurn({
      settings: deps.settings,
      threadId: thread.id,
      date,
      messages: [...history, { role: "user", text: renderBell(bell) }],
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    // Aborted while the soul was being read: nothing was sent, so nothing is
    // owed, and the bell is where it was.
    if (!turn) break;
    if (turn.refusal) {
      deps.onTrouble?.(bell, turn.refusal);
      break;
    }

    let reply: string;
    try {
      reply = await send({
        settings: deps.settings,
        systemPrompt: turn.systemPrompt,
        messages: turn.messages,
        tools: turn.tools,
        harness,
        threadId: thread.id,
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
    } catch (e) {
      // Whatever went wrong with this turn will go wrong with the next bell too
      // — the same model, the same key, the same window. The pass stops and the
      // whole queue waits for the next tick.
      deps.onTrouble?.(bell, e instanceof Error ? e.message : String(e));
      break;
    }

    // A bell the soul decided to say nothing about is answered all the same: the
    // decision was the turn, and the ledger is waiting on the ack.
    if (reply.trim() !== "") {
      appendMessage(key, thread.id, { role: "ai", text: reply, ts: now() });
      // On disk before the bell is confirmed. The store coalesces its writes,
      // so without this the ack could outlive the reply it is confirming.
      await flushThreads();
    }
    await bells.delivered(bell.id);
    await bells.ack(bell.id);
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
