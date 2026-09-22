// Finishing the turn the last process died in the middle of.
//
// A process start opens the newest soul session, and whatever it finds still
// open there is a turn that was being answered when the app was killed
// (legion/execute/harness.ts). The reader asked something and got nothing back.
// So the run is resumed rather than aborted: pi writes the interrupted tool's
// synthetic result — unless the tool said it is safe to run again — and the
// model picks the turn up from there. What it says lands where the question was
// asked, and the reader is told nothing about any of it. A reply that arrives
// late reads as a reply that arrived late.
//
// It runs on the previous session's own harness, so this process's first turn
// is not waiting behind it (held.ts): the reader talking right now is answered
// on the fresh session while the old one finishes in the background.
//
// Three ways a run is aborted instead, each without a request going out:
//
//   no stamp     the turn never said where its reply goes (turn.ts,
//                DELIVERY_ENTRY), or the place it named has nobody registered
//                to lay a desk for it. Nothing could receive the answer.
//   twice tried  two attempts are already written on that branch. A turn that
//                kills the process every time it is resumed would otherwise be
//                resumed for ever, once per start.
//   not a run    a compaction or a navigation. Neither is anybody's answer.

import { BACKGROUND_CONTEXT, type Context, type Entry } from "@earendil-works/pi-agent-core";
import type { HeldHarness, HeldRecovery } from "../legion/execute/held";
import { DELIVERY_ENTRY, runAgentTurn } from "../legion/execute/turn";
import type { BoxOrigin, BoxStore } from "../box";
import { loadSettings, toReasoning, type Settings } from "../platform/app/settings";
import type { ProviderId } from "../ai";
import { modelIdFor, tierForThread } from "../ai/model-tier";
import { coverOf } from "./bell";
import { deliveryOpener, originOf, type Delivery } from "./delivery";
import { landReply } from "./landing";

/** One try at finishing a turn, written on the branch that holds it. */
export const RECOVERY_ATTEMPT = "reading-partner.recovery-attempt";

/** How many times one interrupted turn is resumed before it is given up on. */
export const MAX_ATTEMPTS = 2;

export interface RecoverDeps {
  /** The lane the soul's turns run on. */
  lane: string;
  /** This device's settings. Read once per pass; the app's unless injected. */
  settings?: () => Promise<Settings>;
  /** How a place lays the desk the question was asked over. The registry unless injected. */
  opener?: typeof deliveryOpener;
  /** Runs the resumed turn and answers with what the soul said. */
  send?: SendResumedTurn;
  box?: BoxStore;
  now?: () => number;
}

/** What one resumed turn is sent. */
export interface ResumedTurn {
  settings: Settings;
  systemPrompt: string;
  tools: Delivery["turn"]["tools"];
  /** The previous session's harness, standing on the interrupted run. */
  harness: HeldHarness;
  /** The run to finish. */
  operationId: string;
  /**
   * The thread store's key for the conversation the reply lands in. Which of
   * the two models the turn resumes on is read off it (ai/model-tier.ts).
   */
  bookKey: string;
  threadId: string;
  signal?: AbortSignal;
}

export type SendResumedTurn = (turn: ResumedTurn) => Promise<string>;

// The app's sender. Nothing is watching: there is no composer open and no
// reader waiting, so only the end of it is of any interest. `messages` is empty
// because the prompt is already in the session the lane belongs to — the turn
// resumes a run rather than starting one.
const appSend: SendResumedTurn = (turn) =>
  new Promise<string>((resolve, reject) => {
    void runAgentTurn({
      providerId: turn.settings.defaultProviderId as ProviderId,
      modelId: modelIdFor(turn.settings, tierForThread(turn.bookKey)) as string,
      systemPrompt: turn.systemPrompt,
      messages: [],
      tools: turn.tools,
      harness: turn.harness,
      resume: turn.operationId,
      ...(turn.signal ? { signal: turn.signal } : {}),
      reasoning: toReasoning(turn.settings.chatThinking),
      telemetry: { surface: "recovery", thread: turn.threadId },
      onDelta: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onDone: (finalText, _assistant, turnText) => resolve(turnText || finalText),
      onError: (message: string) => reject(new Error(message)),
      onRefusal: (message: string) => reject(new Error(message)),
    });
  });

/**
 * Finish what the previous session left open, then close it. Called once per
 * process, in the background, by the soul's harness.
 */
export async function recoverSoulSession(
  previous: HeldRecovery,
  deps: RecoverDeps,
  context: Context = BACKGROUND_CONTEXT,
): Promise<void> {
  try {
    for (const operation of previous.open) {
      // Only a run is anybody's answer, and only on the soul's own lane — a
      // worker's session is not this one.
      if (operation.kind !== "run" || operation.lane !== deps.lane) {
        await previous.abort(operation.lane, context);
        continue;
      }
      await finishRun(previous, operation.operationId, deps, context);
    }
  } finally {
    await previous.close(context).catch((e) => {
      console.warn("the recovered session would not close", e);
    });
  }
}

async function finishRun(
  previous: HeldRecovery,
  operationId: string,
  deps: RecoverDeps,
  context: Context,
): Promise<void> {
  const { lane } = deps;
  const snapshot = await previous.inspect(lane, context);
  const origin = stampedOrigin(snapshot.transcript);
  if (!origin) {
    await previous.abort(lane, context);
    return;
  }
  // Both what is written and what is only queued: a write made while a run is
  // open sits in the lane's inbox until the run reaches a boundary, and a
  // process that died before that boundary still tried.
  const tried =
    snapshot.transcript.filter(isAttempt).length +
    snapshot.queues.filter((q) => q.type === "custom" && q.customType === RECOVERY_ATTEMPT).length;
  if (tried >= MAX_ATTEMPTS) {
    console.warn(
      `a soul turn has been resumed ${tried} times without finishing; giving up on it`,
    );
    await previous.abort(lane, context);
    return;
  }

  const open = (deps.opener ?? deliveryOpener)(origin.place);
  if (!open) {
    await previous.abort(lane, context);
    return;
  }
  const settings = await (deps.settings ?? loadSettings)();
  // The same assembly the bell uses, for the same reason: the place says how
  // its desk is laid and the soul may not know. Its messages are not sent — the
  // resumed run has its own prompt — but its system prompt, its tools and its
  // budget fit are this turn's, and they have to be the place's own.
  const delivery = await open({ origin, settings, bell: "" }).catch((e) => {
    console.warn(`an interrupted turn could not be rebuilt where it was asked (${origin.place})`, e);
    return null;
  });
  if (!delivery || delivery.turn.refusal) {
    await previous.abort(lane, context);
    return;
  }

  // On the branch before the model is called, so a resume that kills the
  // process again is counted.
  await previous.note(lane, RECOVERY_ATTEMPT, { at: (deps.now ?? Date.now)() }, context);

  // The conversation is busy for as long as this runs, where the place knows
  // what that means: the reader's Stop reaches it and their next line steers it
  // rather than opening a second turn on the same thread (docs/72).
  const hold = delivery.hold?.();
  const borrowed: HeldHarness = {
    lane: { name: lane, sessions: lane },
    acquire: (turn, ctx) => previous.acquire(turn, lane, ctx),
    // The session is closed when the pass is done, not when this turn is.
    close: async () => {},
  };
  let reply: string;
  try {
    reply = await (deps.send ?? appSend)({
      settings,
      systemPrompt: delivery.turn.systemPrompt,
      tools: delivery.turn.tools,
      harness: borrowed,
      operationId,
      bookKey: delivery.key,
      threadId: delivery.threadId,
      ...(hold ? { signal: hold.signal } : {}),
    });
  } catch (e) {
    hold?.release();
    console.warn("an interrupted turn could not be finished", e);
    return;
  }

  const at = (deps.now ?? Date.now)();
  await landReply({
    key: delivery.key,
    threadId: delivery.threadId,
    reply,
    at,
    ...(deps.box ? { box: deps.box } : {}),
    ...(hold ? { release: () => hold.release() } : {}),
    ...(delivery.watching ? { watching: delivery.watching } : {}),
    // The same card an answer that landed unseen always gets (docs/68): no run
    // behind it, so the delivery is named by the thread and the moment.
    card: () => ({
      boxId: `${delivery.threadId}:${at}`,
      source: "turn" as const,
      cover: coverOf(reply),
      origin,
      needsDecision: false,
      at,
    }),
  });
}

// The newest stamp on the branch the run is standing on. Newest because the
// lane records every turn as a branch off the session root and each one stamps
// its own; the scan is from the tip, so the first one it meets is this turn's.
function stampedOrigin(transcript: Entry[]): BoxOrigin | null {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i]!;
    if (entry.type === "custom" && entry.customType === DELIVERY_ENTRY) {
      return originOf(entry.data);
    }
  }
  return null;
}

function isAttempt(entry: Entry): boolean {
  return entry.type === "custom" && entry.customType === RECOVERY_ATTEMPT;
}
