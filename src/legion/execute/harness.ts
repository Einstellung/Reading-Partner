// One durable agent harness, wired to this app's storage and this app's
// credentials. Every tool-calling turn in the app runs on one (turn.ts).
//
// What the harness adds over a plain agent loop is durability: every message,
// tool call and tool result is appended to a session file as it happens, so a
// run that dies mid-tool is still on disk. The second process learns about it
// from AgentHarness.create, which hands back the list of
// operations that were still open, and lane.resume() finishes each one —
// writing a synthetic tool result that says the execution was interrupted,
// rather than running the tool again (only a tool that declares replay: "safe"
// is re-executed).
//
// Two things are injected and everything else follows from them.
//
//   fileSystem   where sessions live. Defaults to AppData's session store
//                (platform/app/session-fs.ts). A test hands in a disk that is
//                a Map, and no run touches the real one.
//   streamFn     how a round reaches a provider. Production builds one with
//                resolveHarnessStream below, which goes through the same
//                resolveCall and the same providerCallSetup the conversational
//                path uses, so a harness run authenticates exactly as a chat
//                turn does. A test hands in a scripted one.
//
// The harness wants a Models rather than a stream function, because it looks a
// captured model back up by name when it resumes an operation the previous
// process started. So the stream function is wrapped in a one-model provider
// here; that wrapper is the only thing in this file that knows pi-ai exists.

import {
  AgentHarness,
  JsonlSessionRepo,
  type AgentHarnessTool,
  type AgentMessage,
  type AgentHarness as Harness,
  type CompactionSettings,
  type Context,
  type FileSystem,
  type OpenOperation,
  type Session,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  type Api,
  type Message,
  type Model,
  type Models,
  type RetryPolicy,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { createSessionFileSystem, SESSIONS_ROOT } from "../../platform/app/session-fs";
import type { StreamFn } from "./contract";
import { providerCallSetup } from "../../ai/call-setup";
import {
  DEFAULT_MAX_RETRIES,
  resolveCall,
  type ProviderId,
  type ResponseHead,
} from "../../ai/providers";

/** The model a harness runs on, and the stream that reaches it. */
export interface HarnessStream {
  model: Model<Api>;
  streamFn: StreamFn;
}

export interface HarnessDeps {
  /** Defaults to the AppData session store. */
  fileSystem?: FileSystem;
  /** Defaults to {@link SESSIONS_ROOT}. */
  sessionsRoot?: string;
  /** The session clock, injected so a test can name the files it expects. */
  now?: () => number;
  /**
   * Which group of sessions this harness belongs to. The JSONL repo uses it for
   * nothing but the directory name it slugs out of it — it is a grouping key,
   * not a path, and the filesystem never resolves a file against it.
   */
  cwd?: string;
  /**
   * Attach to this session instead of resolving one. When absent the newest
   * session under `cwd` is reopened, and a first run creates one: that is what
   * makes an operation left open by a dead process findable at all.
   */
  session?: Session;
  model: Model<Api>;
  streamFn: StreamFn;
  /**
   * The registry the harness resolves a lane's model from. Built over `model`
   * and `streamFn` when absent; a caller whose turns change model (held.ts)
   * keeps one of its own and adds to it.
   */
  models?: Models;
  tools?: AgentHarnessTool<undefined>[];
  /** A function is read on every request, so it may change between turns. */
  systemPrompt?: string | (() => string | Promise<string>);
  thinkingLevel?: ThinkingLevel;
  /**
   * The last reduction before a request goes out. The harness hands over the
   * whole durable history and takes back the messages to send, which is where
   * this project's budget fitting will go once a caller exists (slice B).
   */
  toProviderMessages?: (
    messages: AgentMessage[],
    context: Context,
  ) => Message[] | Promise<Message[]>;
  /** The harness's own retries on a failed request; its default (three) when unset. */
  retry?: RetryPolicy;
  /** Automatic compaction; the harness's default (on) when unset. */
  compaction?: CompactionSettings;
  /** How one round's tool calls run; the harness's default (parallel) when unset. */
  toolExecution?: "sequential" | "parallel";
}

export interface HarnessHandle {
  harness: Harness<undefined>;
  /**
   * What the previous process left running. One entry per lane with an
   * operation still open; `lane.resume()` finishes it.
   */
  open: OpenOperation[];
  session: Session;
  repo: JsonlSessionRepo;
  /** Close the harness and release the session handle the repo is holding. */
  close(context: Context): Promise<void>;
}

// A Models over one model and one stream function. The harness asks a Models
// for five things (getModel, streamSimple, completeSimple, streamDeferred,
// cancelDeferred); building a real one out of a one-model provider answers all
// five, rather than a hand-written object that answers the three we happen to
// have seen it use.
//
// The provider id has to be the model's own, because that is what the harness
// looks the model up by when it resumes an operation whose captured model
// outlived the process. Auth resolves to nothing: the credential is already
// closed over by the stream function, which is where this app keeps that
// decision (src/ai/providers.ts).
function modelsFor(model: Model<Api>, streamFn: StreamFn): Models {
  const streams = {
    stream: streamFn,
    streamSimple: streamFn,
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: model.provider,
      name: model.provider,
      auth: { apiKey: { name: model.provider, resolve: async () => ({ auth: {} }) } },
      models: [model],
      api: streams,
    }),
  );
  return models;
}

/**
 * The production stream: this app's credentials, transport and per-provider
 * call setup, resolved once and closed over. The same call runAgentTurn makes,
 * plus the setup headers streamChat sends — a harness session is a conversation
 * and the providers that route by one need to be told which.
 */
export async function resolveHarnessStream(params: {
  providerId: ProviderId;
  modelId: string;
  reasoning?: ThinkingLevel;
  /** The conversation the calls belong to; stable across its turns. */
  sessionId: string;
  onResponse?: ResponseHead;
}): Promise<HarnessStream> {
  const call = await resolveCall(params.providerId, params.modelId, [], params.reasoning);
  const setup = providerCallSetup(params.providerId, params.sessionId);
  const streamFn: StreamFn = (model, context, options) =>
    call.provider.streamSimple(model, context, {
      maxRetries: DEFAULT_MAX_RETRIES,
      transport: call.transport,
      onResponse: params.onResponse,
      ...setup,
      ...options,
      apiKey: options?.apiKey ?? call.apiKey,
      headers: { ...setup.headers, ...options?.headers },
    });
  return { model: call.model, streamFn };
}

/** The session store, as this app keeps it. */
export function createSessionRepo(deps: Pick<HarnessDeps, "fileSystem" | "sessionsRoot" | "now">) {
  return new JsonlSessionRepo({
    fileSystem: deps.fileSystem ?? createSessionFileSystem(),
    sessionsRoot: deps.sessionsRoot ?? SESSIONS_ROOT,
    ...(deps.now ? { now: deps.now } : {}),
  });
}

/**
 * Open a harness on a durable session.
 *
 * `open` is the whole point of coming back: an operation the previous process
 * started and never finished is listed there, and resuming its lane is what
 * makes a crash mid-tool a pause rather than a loss.
 */
export async function createHarness(deps: HarnessDeps, context: Context): Promise<HarnessHandle> {
  const repo = createSessionRepo(deps);
  const cwd = deps.cwd ?? SESSIONS_ROOT;
  const session = deps.session ?? (await openOrCreateSession(repo, cwd, context));
  const tools = deps.tools ?? [];

  const { harness, open } = await AgentHarness.create<undefined>(
    {
      session,
      models: deps.models ?? modelsFor(deps.model, deps.streamFn),
      model: deps.model,
      tools,
      activeToolNames: tools.map((tool) => tool.name),
      toolContext: undefined,
      ...(deps.systemPrompt === undefined ? {} : { systemPrompt: deps.systemPrompt }),
      ...(deps.thinkingLevel === undefined ? {} : { thinkingLevel: deps.thinkingLevel }),
      ...(deps.toProviderMessages === undefined
        ? {}
        : { toProviderMessages: deps.toProviderMessages }),
      ...(deps.retry === undefined ? {} : { retry: deps.retry }),
      ...(deps.compaction === undefined ? {} : { compaction: deps.compaction }),
      ...(deps.toolExecution === undefined ? {} : { toolExecution: deps.toolExecution }),
    },
    context,
  );

  return {
    harness,
    open,
    session,
    repo,
    async close(ctx) {
      await harness.close(ctx);
      await session.close(ctx);
    },
  };
}

// The newest session of the group, or a new one. Newest rather than all of
// them: an operation left open belongs to the run that was interrupted, and
// that is the last session written.
async function openOrCreateSession(
  repo: JsonlSessionRepo,
  cwd: string,
  context: Context,
): Promise<Session> {
  const existing = await repo.list({ cwd }, context);
  const newest = [...existing].sort((a, b) => b.createdAt - a.createdAt)[0];
  return newest ? await repo.open(newest, context) : await repo.create({ cwd }, context);
}
