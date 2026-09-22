// A harness held across turns: one session, one lane, every turn of one agent
// run on it in order. The soul holds one (src/soul/harness.ts); a turn that
// runs on it (turn.ts, `held`) borrows the lane for the turn and gives it back.
//
// What a turn brings is decided per turn — its model and stream, its tools,
// its system prompt, its budget fit — and the harness fixes all of those at
// creation (docs/pitfall/307). So the harness is created once with delegates
// that read the turn currently holding it, and acquiring the lane swaps the
// turn in: the tool registry and the lane's active tools, the lane's model,
// and the provider catalogue the harness resolves that model from. Turns are
// serialised on the lane; a second acquire waits for the first release.
//
// Every turn starts on the session root. The lane is navigated back to root
// before its prompt is accepted, so the history the harness hands
// toProviderMessages is this turn's prompt and its own tool rounds, and
// nothing from the turns before it. The session file keeps every turn as its
// own branch off the root; none of them is read back as context, because the
// context is assembled from the conversation files each turn (docs/71).
//
// The first acquire in a process is the expensive one: createHarness lists the
// group's sessions, deals with whatever the previous process left open on the
// newest one, and hands back a fresh session for this process (harness.ts).
// Every acquire after that is a few appended session lines: the lane's
// configuration and a root navigation.
//
// What happens to that open run is `recover`'s to say. Without one it is
// aborted — pi's synthetic "execution was interrupted" tool result, no request.
// With one, the previous session arrives as a HeldRecovery: a second harness,
// with a turn slot of its own so the live one is untouched, standing where the
// interrupted run stopped rather than on the session root. The soul finishes
// its turn there (src/soul/recover.ts) while this process's own turns go on.

import {
  type AgentHarness as Harness,
  type AgentHarnessTool,
  type AgentMessage,
  type Context,
  type FileSystem,
  type JsonValue,
  type LaneSnapshot,
  type OpenOperation,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  type Api,
  type Message,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import type { StreamFn, TurnLane } from "./contract";
import {
  createHarness,
  settlePrevious,
  type HarnessHandle,
  type PreviousSession,
} from "./harness";

// The package exports the harness type but not its lane's.
export type AgentLane = Awaited<ReturnType<Harness<undefined>["lane"]>>;

/** What one turn brings to the harness it borrows. */
export interface HeldTurn {
  model: Model<Api>;
  streamFn: StreamFn;
  tools: AgentHarnessTool<undefined>[];
  systemPrompt?: string;
  toProviderMessages: (
    messages: AgentMessage[],
    context: Context,
  ) => Message[] | Promise<Message[]>;
}

/** The lane for the length of one turn. `release` hands it to the next. */
export interface HeldLane {
  harness: Harness<undefined>;
  lane: AgentLane;
  release(): void;
}

export interface HeldHarness {
  readonly lane: TurnLane;
  /** Borrow the lane, configured for `turn` and standing on the session root. */
  acquire(turn: HeldTurn, context: Context): Promise<HeldLane>;
  /**
   * Open the session without taking the lane, so `recover` runs before anybody
   * asks for a turn. `turn` is only the seed the harness is created with — its
   * model registry has to be able to answer at all — and the turn that resumes
   * brings its own. Absent on a harness that is already standing on a session
   * (the recovery's borrowed one, src/soul/recover.ts), where there is nothing
   * left to open.
   */
  open?(turn: HeldTurn, context: Context): Promise<void>;
  /** Close the harness and its session; a later acquire reopens them. */
  close(context: Context): Promise<void>;
}

/**
 * The previous process's session, held the same way: one turn at a time, with a
 * slot and a model registry of its own. What it is not is a fresh lane — the
 * run that was interrupted is still open on it, so nothing navigates and
 * nothing accepts a prompt; the turn resumes that run where it stopped
 * (turn.ts, `resume`).
 */
export interface HeldRecovery {
  /** What that session left running. */
  open: OpenOperation[];
  /** Configure the previous harness for one turn and borrow its lane. */
  acquire(turn: HeldTurn, lane: string, context: Context): Promise<HeldLane>;
  /** A lane as the dead process left it: its branch, and what is queued on it. */
  inspect(lane: string, context: Context): Promise<LaneSnapshot>;
  /** One entry of the recovery's own bookkeeping, on that lane. */
  note(lane: string, customType: string, data: JsonValue, context: Context): Promise<void>;
  /** Settle one lane's operation without calling the model. */
  abort(lane: string, context: Context): Promise<void>;
  /** Abort whatever is still open and close it: what happens with no recovery. */
  settle(context: Context): Promise<void>;
  /** Close the harness and its session, leaving the file as it stands. */
  close(context: Context): Promise<void>;
}

export interface HoldOptions {
  lane: TurnLane;
  /** Defaults to the AppData session store. */
  fileSystem?: FileSystem;
  sessionsRoot?: string;
  now?: () => number;
  /**
   * Finish what the previous process left open instead of aborting it. Called
   * once, when this process's session is opened — by `open` at start, or by the
   * first acquire — and not awaited: whoever paid for the open goes on without
   * it.
   */
  recover?: (previous: HeldRecovery, context: Context) => void | Promise<void>;
}

// One turn's worth of configuration, and the pi plumbing that reads it back.
// The harness fixes its model registry, its stream, its system prompt and its
// reduction at creation (docs/pitfall/307), so all four are delegates over a
// slot the caller swaps a turn into. Two harnesses means two slots: the live
// one and the previous session's.
function turnSlot(): {
  take: (turn: HeldTurn) => void;
  models: Models;
  streamFn: StreamFn;
  systemPrompt: () => string;
  toProviderMessages: (messages: AgentMessage[], context: Context) => Message[] | Promise<Message[]>;
} {
  // Every model a turn has brought, by provider then id. pi's Models is a
  // registry of providers, each with its catalogue, and the harness resolves
  // the lane's configured model from it by name; a provider is re-set with its
  // whole catalogue whenever a turn brings a model it has not seen.
  const catalogue = new Map<string, Map<string, Model<Api>>>();
  const models = createModels();
  let current: HeldTurn | undefined;

  const streamFn: StreamFn = (model, context, streamOptions) => {
    if (!current) throw new Error("no turn holds the harness");
    return current.streamFn(model, context, streamOptions);
  };

  const register = (model: Model<Api>): void => {
    const known = catalogue.get(model.provider);
    if (known?.get(model.id) === model) return;
    const next = new Map(known ?? []);
    next.set(model.id, model);
    catalogue.set(model.provider, next);
    models.setProvider(
      createProvider({
        id: model.provider,
        name: model.provider,
        auth: { apiKey: { name: model.provider, resolve: async () => ({ auth: {} }) } },
        models: [...next.values()],
        api: { stream: streamFn, streamSimple: streamFn },
      }),
    );
  };

  return {
    take: (turn) => {
      current = turn;
      register(turn.model);
    },
    models,
    streamFn,
    systemPrompt: () => current?.systemPrompt ?? "",
    toProviderMessages: (messages, ctx) =>
      current ? current.toProviderMessages(messages, ctx) : (messages as Message[]),
  };
}

// Configure a harness for one turn and hand back its lane. The same three
// writes on either harness — the tool registry, the lane's active tools, the
// lane's model — and they are what a turn brings that the harness fixed at
// creation.
async function configure(
  harness: Harness<undefined>,
  laneName: string,
  turn: HeldTurn,
  context: Context,
): Promise<AgentLane> {
  const lane = await harness.lane(laneName, context);
  await harness.setTools(turn.tools, context);
  await lane.setActiveTools(
    turn.tools.map((tool) => tool.name),
    context,
  );
  await lane.setModel({ provider: turn.model.provider, modelId: turn.model.id }, context);
  return lane;
}

// The previous session as the recovery holds it. Turns are serialised on it the
// same way, so two open operations are finished one after the other.
function heldRecovery(previous: PreviousSession, slot: ReturnType<typeof turnSlot>): HeldRecovery {
  let tail: Promise<void> = Promise.resolve();
  return {
    open: previous.open,
    async acquire(turn, laneName, context) {
      const waiting = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await waiting;
      try {
        slot.take(turn);
        // No navigation: the run to be finished is standing on its own branch,
        // and moving the lane to the root would strand it there.
        const lane = await configure(previous.harness, laneName, turn, context);
        return { harness: previous.harness, lane, release };
      } catch (e) {
        release();
        throw e;
      }
    },
    async inspect(laneName, context) {
      const lane = await previous.harness.lane(laneName, context);
      const watch = await lane.watch(context);
      // One reading, not a subscription: the snapshot is what a resume decides
      // from, and nothing here is listening for a session nobody is writing.
      watch.unsubscribe();
      return watch.snapshot;
    },
    async note(laneName, customType, data, context) {
      const lane = await previous.harness.lane(laneName, context);
      await lane.appendCustomEntry(customType, data, context);
    },
    async abort(laneName, context) {
      const lane = await previous.harness.lane(laneName, context);
      await lane.abort(context);
    },
    settle: (context) => settlePrevious(previous, context),
    close: (context) => previous.close(context),
  };
}

export function holdHarness(options: HoldOptions): HeldHarness {
  const { lane: laneId } = options;
  const slot = turnSlot();
  const { models, streamFn } = slot;
  let handle: Promise<HarnessHandle> | undefined;
  // The turn holding the lane, as a promise the next acquire waits on.
  let tail: Promise<void> = Promise.resolve();

  const open = (turn: HeldTurn, context: Context): Promise<HarnessHandle> => {
    handle ??= (async () => {
      slot.take(turn);
      const recover = options.recover;
      // The recovery's own slot, seeded with this turn's model so the previous
      // session opens with a registry that can answer at all. Which model its
      // interrupted run captured is the run's own business; the turn that
      // resumes it brings that one.
      const recoverySlot = recover ? turnSlot() : undefined;
      recoverySlot?.take(turn);
      const opened = await createHarness(
        {
          ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
          ...(options.sessionsRoot ? { sessionsRoot: options.sessionsRoot } : {}),
          ...(options.now ? { now: options.now } : {}),
          cwd: laneId.sessions,
          models,
          model: turn.model,
          streamFn,
          tools: [],
          systemPrompt: slot.systemPrompt,
          toProviderMessages: slot.toProviderMessages,
          retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
          compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
          toolExecution: "sequential",
          ...(recover && recoverySlot
            ? {
                recovery: {
                  deps: {
                    models: recoverySlot.models,
                    model: turn.model,
                    streamFn: recoverySlot.streamFn,
                    systemPrompt: recoverySlot.systemPrompt,
                    toProviderMessages: recoverySlot.toProviderMessages,
                  },
                  take: (previous, ctx) => {
                    const taken = heldRecovery(previous, recoverySlot);
                    void (async () => {
                      try {
                        await recover(taken, ctx);
                      } catch (e) {
                        console.warn("the previous session could not be recovered", e);
                        await taken.settle(ctx).catch(() => {});
                      }
                    })();
                  },
                },
              }
            : {}),
        },
        context,
      );
      return opened;
    })();
    // A store that would not open is retried by the next turn rather than
    // failing every turn after it.
    handle.catch(() => {
      handle = undefined;
    });
    return handle;
  };

  return {
    lane: laneId,

    async open(turn, context) {
      await open(turn, context);
    },

    async acquire(turn, context) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const opened = await open(turn, context);
        slot.take(turn);
        const { harness } = opened;
        const lane = await configure(harness, laneId.name, turn, context);
        if ((await lane.getTipId(context)) !== null) {
          const moved = await lane.navigateTree(null, { summarize: false }, context);
          if (!moved.ok) throw new Error(moved.error.message);
        }
        return { harness, lane, release };
      } catch (e) {
        release();
        throw e;
      }
    },

    async close(context) {
      const opened = handle;
      handle = undefined;
      if (!opened) return;
      await (await opened).close(context);
    },
  };
}
