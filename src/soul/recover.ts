// Finishing the turn the last process died in the middle of, on the soul's
// old session.
//
// Until docs/soul/87 第二阶段 every soul turn ran on one held harness over a
// session group of its own; now they all run on the durable runtime, which
// recovers its own. What is left is the first start after the upgrade:
// finishOldSoulSession opens the newest soul session once, and whatever it
// finds still open there is a turn that was being answered when the app was
// killed (legion/execute/harness.ts). The reader asked something and got
// nothing back. Then the group is deleted, and no later start touches it.
// This file goes in 第四阶段.
// So the run is resumed rather than aborted: pi writes the interrupted tool's
// synthetic result — unless the tool said it is safe to run again — and the
// model picks the turn up from there. What it says lands where the question was
// asked, and the reader is told nothing about any of it. A reply that arrives
// late reads as a reply that arrived late.
//
// It runs on the previous session's own harness, in the background: nobody is
// waiting on it.
//
// What lands is the whole turn and not only its ending. A turn that called
// tools wrote a sentence or two before each of them, and those rounds are
// committed to the session: the process died somewhere after them. The resumed
// run only hands back what it said itself, so what the dead process had already
// written is read off the transcript and put in front of it. Without that the
// reader gets a closing paragraph with no argument above it, which is what a
// turn interrupted on the reader's iPad used to leave behind
// (docs/pitfall/391).
//
// Resuming only ever continues a turn that was inside a tool call. A process
// killed mid-sentence — the ordinary case, since a sentence is what a turn
// spends most of its time on — cannot be continued at all: pi commits the
// frames it has as an assistant message and ends the run as an error. The turn
// still said something, and that something is on the branch once the resume has
// settled it, so the branch is read back and what it says is the reply
// (docs/pitfall/395).
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

import {
  BACKGROUND_CONTEXT,
  type AgentMessage,
  type Context,
  type Entry,
  type FileSystem,
} from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { joinRoundTexts } from "../ai/turn-view/turn-rows";
import type { ProviderId } from "../ai";
import { modelIdFor } from "../ai/model-tier";
import { resolveCall } from "../ai/providers";
import type { TurnLane } from "../legion/execute/contract";
import { createSessionRepo } from "../legion/execute/harness";
import { holdHarness, type HeldHarness, type HeldRecovery, type HeldTurn } from "../legion/execute/held";
import { DELIVERY_ENTRY, PROMPT_ENTRY, runAgentTurn } from "../legion/execute/turn";
import type { BoxOrigin, BoxStore } from "../box";
import { loadSettings, toReasoning, type Settings } from "../platform/app/settings";
import { coverOf } from "./bell";
import { deliveryOpener, originOf, type Delivery } from "./delivery";
import { landReply } from "./landing";

/** One try at finishing a turn, written on the branch that holds it. */
export const RECOVERY_ATTEMPT = "reading-partner.recovery-attempt";

/** How many times one interrupted turn is resumed before it is given up on. */
export const MAX_ATTEMPTS = 2;

export interface RecoverDeps {
  /**
   * The lane the soul's turns run on. Each conversation's turns run on a lane
   * under it, `<lane>/<conversation>` (legion/execute/held.ts), and an open run
   * on any of them is the soul's.
   */
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

// The app's sender: the turn on the talk model with no streaming surface
// listening, settling on its end. `messages` is empty because the prompt is
// already in the session the lane belongs to — the turn resumes a run rather
// than starting one.
const appSend: SendResumedTurn = (turn) =>
  new Promise<string>((resolve, reject) => {
    void runAgentTurn({
      providerId: turn.settings.defaultProviderId as ProviderId,
      modelId: modelIdFor(turn.settings, "talk") as string,
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

/** Where the soul's turns ran before docs/soul/87 第二阶段: one lane, one session group. */
export const SOUL_LANE: TurnLane = { name: "soul", sessions: "soul" };

export interface FinishDeps {
  settings?: () => Promise<Settings>;
  /** The session store. AppData's unless a test hands one in. */
  fileSystem?: FileSystem;
  context?: Context;
  /** What the harness is opened with. The configured model unless a test hands one in. */
  seed?: (settings: Settings) => Promise<HeldTurn>;
  /** How the open session is finished. recoverSoulSession unless a test hands one in. */
  recover?: (previous: HeldRecovery, context: Context) => Promise<void>;
}

/**
 * What the harness is opened with. It fixes its model registry at creation and
 * the recovery's own slot is seeded from here, so the previous session opens
 * with a registry that can answer at all; the turn that resumes brings its own
 * model, prompt and tools. Nothing streams through this one.
 */
async function seedTurn(settings: Settings): Promise<HeldTurn> {
  const { model } = await resolveCall(
    settings.defaultProviderId as ProviderId,
    settings.defaultModelId as string,
    [],
  );
  return {
    model,
    streamFn: () => {
      throw new Error("the soul's session was opened without a turn");
    },
    tools: [],
    systemPrompt: "",
    toProviderMessages: (messages: AgentMessage[]) => messages as Message[],
  };
}

/**
 * Finish the turn the old soul session left open, once, at start (the shell
 * calls it), and then delete the session group so no later start opens it.
 * No soul session on disk is the ordinary case and costs one listing: nothing
 * is opened and nothing is written.
 *
 * Opening it at start rather than on a later turn is docs/pitfall/394: the
 * reader whose answer was interrupted has the least reason to ask again.
 * Failures are logged and dropped, and the group stays for the next start: a
 * device with no provider configured has nothing to resume with yet.
 */
export async function finishOldSoulSession(deps: FinishDeps = {}): Promise<void> {
  const context = deps.context ?? BACKGROUND_CONTEXT;
  const store = deps.fileSystem ? { fileSystem: deps.fileSystem } : {};
  try {
    const repo = createSessionRepo(store);
    if ((await repo.list({ cwd: SOUL_LANE.sessions }, context)).length === 0) return;
    const settings = await (deps.settings ?? loadSettings)();
    const recover =
      deps.recover ??
      ((previous: HeldRecovery, ctx: Context) => recoverSoulSession(previous, { lane: SOUL_LANE.name }, ctx));
    // Set while the harness opens, before the open returns, when the newest
    // session has something left open (held.ts).
    let recovering: Promise<void> = Promise.resolve();
    const held = holdHarness({
      lane: SOUL_LANE,
      ...store,
      recover: (previous, ctx) => {
        recovering = recover(previous, ctx).catch(async (e) => {
          console.warn("the old soul session could not be recovered", e);
          await previous.settle(ctx).catch(() => {});
        });
        return recovering;
      },
    });
    await held.open!(await (deps.seed ?? seedTurn)(settings), context);
    await recovering;
    await held.close(context);
    for (const session of await repo.list({ cwd: SOUL_LANE.sessions }, context)) {
      await repo.delete(session, context);
    }
  } catch (e) {
    console.warn("the old soul session could not be finished", e);
  }
}

/**
 * Finish what the previous session left open, then close it. Called once, in
 * the background, while finishOldSoulSession opens the harness.
 */
export async function recoverSoulSession(
  previous: HeldRecovery,
  deps: RecoverDeps,
  context: Context = BACKGROUND_CONTEXT,
): Promise<void> {
  try {
    for (const operation of previous.open) {
      // Only a run is anybody's answer, and only on the soul's own lanes — a
      // worker's session is not this one.
      if (operation.kind !== "run" || !isSoulLane(operation.lane, deps.lane)) {
        await previous.abort(operation.lane, context);
        continue;
      }
      await finishRun(previous, operation.lane, operation.operationId, deps, context);
    }
  } finally {
    await previous.close(context).catch((e) => {
      console.warn("the recovered session would not close", e);
    });
  }
}

// The soul's lane, or one conversation's lane under it.
function isSoulLane(name: string, soul: string): boolean {
  return name === soul || name.startsWith(`${soul}/`);
}

async function finishRun(
  previous: HeldRecovery,
  lane: string,
  operationId: string,
  deps: RecoverDeps,
  context: Context,
): Promise<void> {
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
  // What the dead process already said on this turn, oldest first. Read before
  // the resume, off the snapshot the decision above was made from.
  const already = saidBefore(snapshot.transcript);
  let said: string | null = null;
  try {
    said = await (deps.send ?? appSend)({
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
    // The usual one is the process dying mid-sentence rather than mid-tool.
    // There is no continuing from inside an assistant request the way there is
    // from inside a tool call, so pi settles it instead: it commits the frames
    // it had as an assistant message and ends the run as an error
    // ("Assistant request was interrupted…"). That is not a reason to give up
    // on the turn — it is the turn, written as far as it got, and it is on the
    // branch now where it was not before. So the branch is read again rather
    // than the pre-resume snapshot, and what comes back is the whole of it.
    console.warn("an interrupted turn was settled rather than finished", e);
  }

  // On the way through, `said` is what the resumed run added and `already` is
  // what the dead process had committed before it. On the settled path there is
  // no run to have added anything, and re-reading the branch is the only way to
  // see the partial pi just wrote there.
  const rounds =
    said === null
      ? saidBefore((await previous.inspect(lane, context)).transcript)
      : [...already, said];
  const reply = joinRoundTexts(rounds);
  // Nothing was ever written: no message start, or a partial with no text in
  // it. There is no reply to land and no card worth putting.
  if (!reply.trim()) {
    hold?.release();
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

/**
 * What the interrupted turn had already written, in the order it wrote it.
 *
 * The scan starts at this turn's stamp — every turn on the lane is a branch off
 * the session root and stamps its own before its prompt is accepted, so
 * nothing before the newest stamp belongs to this turn. What follows it starts
 * with the prompt, which is the conversation so far and holds the answers
 * earlier turns already delivered; the stamp's PROMPT_ENTRY says how many
 * messages that is, and the turn's own begin after them. A branch written
 * before that entry existed is read from its last user message on, which can
 * miss what a steered turn said before the steer but never lands an old answer
 * a second time. Assistant text only: a tool result is fed back to the model
 * and was never part of the reply.
 */
export function saidBefore(transcript: readonly Entry[]): string[] {
  let from = 0;
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i]!;
    if (entry.type === "custom" && entry.customType === DELIVERY_ENTRY) {
      from = i + 1;
      break;
    }
  }
  const turn = transcript.slice(from);
  const sized = turn.find((e) => e.type === "custom" && e.customType === PROMPT_ENTRY);
  const size = sized?.type === "custom" ? (sized.data as { messages?: unknown } | undefined)?.messages : undefined;
  let own: readonly Entry[];
  if (typeof size === "number") {
    let prompt = 0;
    own = turn.filter((e) => e.type === "message" && ++prompt > size);
  } else {
    let lastUser = turn.length - 1;
    while (lastUser >= 0) {
      const e = turn[lastUser]!;
      if (e.type === "message" && (e.message as { role?: string }).role === "user") break;
      lastUser -= 1;
    }
    own = turn.slice(lastUser + 1);
  }
  const said: string[] = [];
  for (const entry of own) {
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: string; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((c): c is { type: "text"; text: string } => {
        const part = c as { type?: string; text?: unknown };
        return part.type === "text" && typeof part.text === "string";
      })
      .map((c) => c.text)
      .join("");
    if (text.trim() !== "") said.push(text);
  }
  return said;
}
