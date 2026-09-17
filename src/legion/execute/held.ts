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
// The first acquire in a process is the expensive one: it lists the group's
// sessions, reopens the newest (reading the whole file back) or creates one,
// and finishes whatever the previous process left open — a tool that was
// running when it died is not run again; the operation is aborted, which
// writes pi's synthetic "execution was interrupted" tool result and settles
// it, and the model is not called for it. Every acquire after that is a few
// appended session lines: the lane's configuration and a root navigation.

import {
  type AgentHarness as Harness,
  type AgentHarnessTool,
  type AgentMessage,
  type Context,
  type FileSystem,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  type Api,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import type { StreamFn, TurnLane } from "./contract";
import { createHarness, type HarnessHandle } from "./harness";

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
  /** Close the harness and its session; a later acquire reopens them. */
  close(context: Context): Promise<void>;
}

export interface HoldOptions {
  lane: TurnLane;
  /** Defaults to the AppData session store. */
  fileSystem?: FileSystem;
  sessionsRoot?: string;
  now?: () => number;
}

export function holdHarness(options: HoldOptions): HeldHarness {
  const { lane: laneId } = options;
  // Every model a turn has brought, by provider then id. pi's Models is a
  // registry of providers, each with its catalogue, and the harness resolves
  // the lane's configured model from it by name; a provider is re-set with its
  // whole catalogue whenever a turn brings a model it has not seen.
  const catalogue = new Map<string, Map<string, Model<Api>>>();
  const models = createModels();
  let current: HeldTurn | undefined;
  let handle: Promise<HarnessHandle> | undefined;
  // The turn holding the lane, as a promise the next acquire waits on.
  let tail: Promise<void> = Promise.resolve();

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

  const open = (turn: HeldTurn, context: Context): Promise<HarnessHandle> => {
    handle ??= (async () => {
      register(turn.model);
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
          systemPrompt: () => current?.systemPrompt ?? "",
          toProviderMessages: (messages, ctx) =>
            current ? current.toProviderMessages(messages, ctx) : (messages as Message[]),
          retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
          compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
          toolExecution: "sequential",
        },
        context,
      );
      // What the previous process left running is settled here, not resumed:
      // the tool's synthetic result is written, and the answer it was in the
      // middle of has no caller left to hear it.
      for (const op of opened.open) {
        const stale = await opened.harness.lane(op.lane, context);
        await stale.abort(context);
      }
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

    async acquire(turn, context) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const opened = await open(turn, context);
        current = turn;
        register(turn.model);
        const { harness } = opened;
        const lane = await harness.lane(laneId.name, context);
        await harness.setTools(turn.tools, context);
        await lane.setActiveTools(
          turn.tools.map((tool) => tool.name),
          context,
        );
        await lane.setModel({ provider: turn.model.provider, modelId: turn.model.id }, context);
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
