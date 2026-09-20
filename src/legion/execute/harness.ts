// One durable agent harness, wired to this app's storage and this app's
// credentials. Every tool-calling turn in the app runs on one (turn.ts).
//
// What the harness adds over a plain agent loop is durability: every message,
// tool call and tool result is appended to a session file as it happens, so a
// run that dies mid-tool is still on disk. The second process learns about it
// from AgentHarness.create, which hands back the list of operations that were
// still open.
//
// Finishing what the previous process left open is the only thing that session
// is wanted for, so a process start hands it over and then starts a fresh
// session of its own (rotateSession below), and the group keeps its newest few
// files (sweepSessionGroup). Who finishes it and how is the caller's: a caller
// that names a `recovery` is given the previous session's own harness and does
// what it likes with it, and one that does not gets settlePrevious — abort each
// open operation, which writes pi's synthetic "execution was interrupted" tool
// result without calling the model, and let the session go.
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
  FileError,
  JsonlSessionRepo,
  type AgentHarnessTool,
  type AgentMessage,
  type AgentHarness as Harness,
  type CompactionSettings,
  type Context,
  type FileSystem,
  type JsonlSessionMetadata,
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
   * session under `cwd` is settled and a fresh one is created for this process
   * (rotateSession).
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
  /**
   * Take over whatever the previous session left open instead of aborting it
   * (rotateSession). Ignored when a `session` is passed in: there is then no
   * previous session to speak of.
   */
  recovery?: Recovery;
}

/** The previous process's session, with everything needed to finish it. */
export interface PreviousSession {
  harness: Harness<undefined>;
  session: Session<JsonlSessionMetadata>;
  /** What it left running. One entry per lane with an operation still open. */
  open: OpenOperation[];
  /** Close the harness and release the session handle. */
  close(context: Context): Promise<void>;
}

/** How a caller takes the previous session over. */
export interface Recovery {
  /**
   * How the harness over that session is built. Its own, because the live
   * harness's are read off the turn currently holding it (held.ts) and a
   * recovery sharing them would be handed whatever the reader is doing now.
   */
  deps: Pick<HarnessDeps, "models" | "model" | "streamFn" | "systemPrompt" | "toProviderMessages">;
  /**
   * The previous session, when it has something open. Called before this
   * process's own harness is built and never awaited: the first turn of this
   * process does not wait on the last turn of the one before it.
   */
  take(previous: PreviousSession, context: Context): void;
}

export interface HarnessHandle {
  harness: Harness<undefined>;
  /**
   * What this session left running. One entry per lane with an operation still
   * open; `lane.resume()` finishes it and `lane.abort()` settles it.
   *
   * Always empty when the session was resolved here rather than passed in: that
   * path settles the previous session itself and then hands back a fresh one,
   * which holds nothing. It stays on the handle because a caller that passes
   * its own `session` gets what that session holds.
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

type StoreDeps = Pick<HarnessDeps, "fileSystem" | "sessionsRoot" | "now">;

// The repo and the disk it was built on, resolved together. Setting a session
// file aside (openOrCreateSession) renames it behind the repo's back, so it has
// to happen on the very filesystem the repo reads — resolving the default twice
// would put the rename on a second instance.
function sessionStore(deps: StoreDeps): {
  repo: JsonlSessionRepo;
  fileSystem: FileSystem;
  now: () => number;
} {
  const fileSystem = deps.fileSystem ?? createSessionFileSystem();
  const now = deps.now ?? Date.now;
  return {
    fileSystem,
    now,
    repo: new JsonlSessionRepo({
      fileSystem,
      sessionsRoot: deps.sessionsRoot ?? SESSIONS_ROOT,
      now,
    }),
  };
}

/** The session store, as this app keeps it. */
export function createSessionRepo(deps: StoreDeps) {
  return sessionStore(deps).repo;
}

/**
 * Open a harness on a durable session.
 *
 * Without an explicit `session` this is a process start: whatever the previous
 * process left open is settled on the session that holds it, and the harness
 * comes back on a fresh session of the same group (rotateSession).
 */
export async function createHarness(deps: HarnessDeps, context: Context): Promise<HarnessHandle> {
  const store = sessionStore(deps);
  const repo = store.repo;
  const cwd = deps.cwd ?? SESSIONS_ROOT;
  const session = deps.session ?? (await rotateSession(store, deps, cwd, context));
  const { harness, open } = await buildHarness(deps, session, context);

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

// The harness itself, over a session someone else resolved. Two callers: the
// one above, and the settling pass below, which needs a harness on the previous
// session to reach its lanes.
async function buildHarness(
  deps: HarnessDeps,
  session: Session,
  context: Context,
): Promise<{ harness: Harness<undefined>; open: OpenOperation[] }> {
  const tools = deps.tools ?? [];
  return await AgentHarness.create<undefined>(
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
}

// Settle the group's newest session and start a fresh one for this process.
//
// Nothing written to a session is ever read back as context: every turn
// navigates its lane to the session root and assembles the round from the
// conversation files (docs/71). So the newest session is wanted for one thing —
// finishing what a dead process left open — and once that is done, staying on
// it only makes a file that grows by a few hundred lines per answer and is
// replayed whole on every start.
//
// Newest rather than all of them: an operation left open belongs to the run
// that was interrupted, and that is the last session written.
//
// A session that will not open is set aside rather than retried forever. The
// JSONL storage replays every line on open and throws on the first bad one; it
// heals a torn last line and nothing else, so one bad line in the middle makes
// that file fatal for good, and every turn after it dies on the same open
// (docs/pitfall/367). A session is machine-local runtime state and losing one
// costs a device its resumable operations, not its history — the conversation
// the reader sees is projected from elsewhere (src/palace/kinds.ts, docs/71).
async function rotateSession(
  store: ReturnType<typeof sessionStore>,
  deps: HarnessDeps,
  cwd: string,
  context: Context,
): Promise<Session> {
  const { repo, fileSystem, now } = store;
  const existing = await repo.list({ cwd }, context);
  const newest = [...existing].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (newest) {
    let opened: Session<JsonlSessionMetadata> | undefined;
    try {
      opened = await repo.open(newest, context);
    } catch (error) {
      if (isFileFailure(error)) throw error;
      await setAside(fileSystem, newest.path, now(), error, context);
    }
    if (opened) {
      const previous = await attachPrevious(deps, opened, context);
      // Nothing was left running, so there is nothing to hand over and nothing
      // to settle: the file stays where it is and this process moves on.
      if (previous.open.length === 0) await previous.close(context);
      else if (deps.recovery) deps.recovery.take(previous, context);
      else await settlePrevious(previous, context);
    }
  }
  const session = await repo.create({ cwd }, context);
  await sweepSessionGroup(fileSystem, session, context);
  return session;
}

// A harness over the previous session, so its lanes can be reached. Built with
// the recovery's own deps where there is one; with this process's otherwise,
// which is enough for the abort that is all the default settle does.
async function attachPrevious(
  deps: HarnessDeps,
  session: Session<JsonlSessionMetadata>,
  context: Context,
): Promise<PreviousSession> {
  const { harness, open } = await buildHarness(
    { ...deps, ...(deps.recovery ? deps.recovery.deps : {}), tools: [] },
    session,
    context,
  );
  return {
    harness,
    session,
    open,
    async close(ctx) {
      await harness.close(ctx);
      await session.close(ctx);
    },
  };
}

/**
 * Abort every operation the session still holds, then let it go. Abort rather
 * than resume: the tool that was running when the process died is not run again
 * — pi writes its synthetic "execution was interrupted" result and settles the
 * operation — and no request goes out (docs/pitfall/308).
 *
 * What a caller that can find the answer's receiver does instead is resume it
 * (src/soul/recover.ts); this is what happens to everything else.
 */
export async function settlePrevious(
  previous: PreviousSession,
  context: Context,
): Promise<void> {
  try {
    for (const operation of previous.open) {
      const lane = await previous.harness.lane(operation.lane, context);
      await lane.abort(context);
    }
  } finally {
    await previous.close(context);
  }
}

/** How many files a session group keeps, the one just created included. */
const KEEP_SESSIONS = 5;

/**
 * Delete everything in a freshly created session's group but the newest few
 * files. This is the "domain-housekeeping" the palace's `session` row promises
 * (src/palace/kinds.ts).
 *
 * The directory is the repo's own: `metadata.path` is the file the repo just
 * wrote, so its parent is the directory the repo slugged out of `cwd`, and the
 * name is never spelled a second time here. A session file is named after its
 * ISO creation time, so sorting the names sorts by age; a file set aside as
 * `.corrupt-…` keeps the timestamp it was named with and ages out with it.
 *
 * A removal that fails is logged and left where it is: the next start sweeps
 * the same directory again.
 */
export async function sweepSessionGroup(
  fileSystem: FileSystem,
  session: Session<JsonlSessionMetadata>,
  context: Context,
): Promise<void> {
  const path = session.metadata.path;
  const directory = path.slice(0, path.lastIndexOf("/"));
  const listed = await fileSystem.listDir(directory, context);
  if (!listed.ok) {
    console.warn(`session group ${directory} could not be listed: ${listed.error.message}`);
    return;
  }
  const files = listed.value
    .filter((entry) => entry.kind !== "directory")
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const stale of files.slice(0, Math.max(0, files.length - KEEP_SESSIONS))) {
    const removed = await fileSystem.remove(stale.path, { force: true }, context);
    if (!removed.ok) {
      console.warn(`session ${stale.path} could not be swept: ${removed.error.message}`);
    }
  }
}

// Rename the file out of the way. `JsonlSessionRepo.list` only considers names
// ending in `.jsonl`, so the renamed one is never opened again; nothing deletes
// it, because it is the only copy of what the run had written.
async function setAside(
  fileSystem: FileSystem,
  path: string,
  now: number,
  cause: unknown,
  context: Context,
): Promise<void> {
  const aside = `${path}.corrupt-${now}`;
  const renamed = await fileSystem.renameFile(path, aside, context);
  console.warn(
    renamed.ok
      ? `session ${path} would not open; set aside as ${aside} and starting a fresh one`
      : `session ${path} would not open and could not be set aside (${renamed.error.message}); starting a fresh one`,
    cause,
  );
}

// Whether the open failed because the disk would not answer, rather than
// because of what the file holds. session-fs.ts reports every filesystem
// failure as pi's FileError and the repo rethrows it as its own error's
// `cause`; a bad line arrives with a plain Error instead. An unreadable disk
// keeps behaving as it did — the next turn retries it and nothing is renamed.
function isFileFailure(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof FileError) return true;
    // `cause` is ES2022 and this project's lib is older; the runtime has it.
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
