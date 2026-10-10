// The device's one Harness (docs/soul/87, "存储与 Harness", "换代"): one
// SQLite database in AppData `durable/turns-<code>.sqlite`, the code being its
// creation time, the newest one in use. Every conversation of the device runs
// in it; `rp.conversations` maps thread keys to conversations.
//
// The database only grows. After a turn settles, once it is over
// `rotateAtBytes` and nothing is live, the Harness is closed, a new generation
// opened and the old one deleted. Conversations are rebuilt on next use; their
// context comes from the conversation files (extension.ts, beforeRequest), so
// the swap is invisible to the model. Past `forceRotateFactor` times the
// threshold, live work is aborted (background included) to let the swap happen.
//
// Opening does not resume: run recoverBeforeResume (recover.ts) next.

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  Harness,
  type Conversation,
  type ConversationId,
  type ConversationStreamOptions,
  type HarnessInspection,
  type HarnessSettings,
  type Storage,
  type Task,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { SqliteStorage, type SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite";
import { appData } from "../../platform/app/appdata";
import { durableSqliteSize, openDurableSqlite, removeDurableSqlite } from "../../platform/app/durable-sqlite";
import type { AgentTool } from "../execute/contract";
import {
  ConversationsDoc,
  durableExtension,
  ThreadDoc,
  type HistoryReader,
  type ResponseRecorder,
  type ThreadOrigin,
  type TurnCheckpoint,
  type TurnInput,
  type TurnResult,
} from "./extension";
import { DeskCache, toolRegistration, type DeskResolver } from "./tools";
import { createLandStep, type Lander } from "./turn";

export const DURABLE_DIR = "durable";
export const ROTATE_AT_BYTES = 100 * 1024 * 1024;
export const FORCE_ROTATE_FACTOR = 1.5;

export interface DurableHost {
  open(path: string): Promise<SqliteDatabase>;
  /** Delete a closed database with its `-wal` and `-shm`. */
  remove(path: string): Promise<void>;
  /** Bytes of the database file and its WAL. */
  size(path: string): Promise<number>;
  /** File names in an AppData directory; empty when it does not exist. */
  list(dir: string): Promise<string[]>;
}

export function appDurableHost(): DurableHost {
  return {
    open: (path) => openDurableSqlite(path),
    remove: (path) => removeDurableSqlite(path),
    size: (path) => durableSqliteSize(path),
    list: async (dir) => ((await appData.exists(dir)) ? (await appData.readDir(dir)).map((entry) => entry.name) : []),
  };
}

export interface DurableOptions {
  host: DurableHost;
  models: Models;
  /** Every tool any desk can offer; the schema of each name comes from here. */
  catalog: readonly AgentTool[];
  /** Desk resolvers by place (today's openers). */
  resolvers: Readonly<Record<string, DeskResolver>>;
  /** Landing steps by place. */
  landers: Readonly<Record<string, Lander>>;
  readHistory: HistoryReader;
  recordResponse?: ResponseRecorder;
  /** A conversation's `rp.turn` landed and the conversation is free again. */
  onSettled?: (conversationId: ConversationId, origin: ThreadOrigin, result: TurnResult) => void;
  /** The system prompt's sections in order; `rp.desk` holds each turn's text for them. */
  sectionKeys: readonly string[];
  stream?: ConversationStreamOptions;
  dir?: string;
  rotateAtBytes?: number;
  forceRotateFactor?: number;
  now?: () => number;
  onReport?: (error: unknown) => void;
}

export interface DurableRuntime {
  /** The current generation's Harness; a swap replaces it, so read it at each use. */
  readonly harness: Harness;
  readonly storage: Storage;
  readonly path: string;
  readonly registrations: ReadonlyMap<string, ToolRegistration>;
  readonly desks: DeskCache;
  readonly turnTask: Task<TurnInput, TurnCheckpoint, TurnResult, object>;
  now(): number;
  forgetStubs(conversationId: ConversationId): void;
  /** The thread's conversation, created with its `rp.thread` on first use in this generation. */
  conversationFor(key: string, origin: ThreadOrigin, context: Context): Promise<Conversation>;
  /** Swap generations when the database is over the threshold; true when it did. */
  maybeRotate(context: Context): Promise<boolean>;
  close(context: Context): Promise<void>;
}

const GENERATION = /^turns-(\d+)\.sqlite$/;

function idle(inspection: HarnessInspection): boolean {
  return inspection.tasks.length === 0 && inspection.submissions.length === 0;
}

export async function openDurable(options: DurableOptions): Promise<DurableRuntime> {
  const dir = options.dir ?? DURABLE_DIR;
  const now = options.now ?? Date.now;
  const rotateAt = options.rotateAtBytes ?? ROTATE_AT_BYTES;
  const force = rotateAt * (options.forceRotateFactor ?? FORCE_ROTATE_FACTOR);
  const desks = new DeskCache(options.resolvers);
  const registrations = new Map(options.catalog.map((tool) => [tool.name, toolRegistration(tool, desks)]));
  const refusals = new Map<ConversationId, string>();
  const conversations = new Map<string, Promise<Conversation>>();

  let harness!: Harness;
  let storage!: Storage;
  let path = "";
  let code = 0;

  const settledWith = async (conversationId: ConversationId, result: TurnResult) => {
    try {
      const origin = (await harness.snapshot(ThreadDoc, conversationId, BACKGROUND_CONTEXT))?.origin;
      if (origin) options.onSettled?.(conversationId, origin, result);
    } catch (error) {
      options.onReport?.(error);
    }
  };

  const { extension, turnTask, forgetStubs } = durableExtension({
    sectionKeys: options.sectionKeys,
    readHistory: options.readHistory,
    ...(options.recordResponse ? { recordResponse: options.recordResponse } : {}),
    registrations,
    ...(options.onSettled ? { settled: (conversationId: ConversationId, result: TurnResult) => void settledWith(conversationId, result) } : {}),
    land: createLandStep({
      landers: options.landers,
      storage: () => storage,
      takeRefusal: (conversationId) => {
        const message = refusals.get(conversationId);
        refusals.delete(conversationId);
        return message;
      },
    }),
    refuse: (conversationId, message) => {
      refusals.set(conversationId, message);
      void harness
        .conversation(conversationId, BACKGROUND_CONTEXT)
        .then((conversation) => conversation?.abort(BACKGROUND_CONTEXT))
        .catch((error) => options.onReport?.(error));
    },
  });
  const registry = createRegistry();
  registry.install(extension);
  const settings: HarnessSettings = {
    retry: { enabled: false },
    compaction: { enabled: false },
    toolExecution: "sequential",
    progress: { partialIntervalMs: 100, outputIntervalMs: 100 },
    ...(options.stream ? { stream: options.stream } : {}),
  };

  const openGeneration = async (next: number) => {
    code = next;
    path = `${dir}/turns-${next}.sqlite`;
    storage = await SqliteStorage.open(await options.host.open(path));
    harness = await Harness.open(
      storage,
      { models: options.models, registry, settings, ...(options.onReport ? { onReport: options.onReport } : {}) },
      BACKGROUND_CONTEXT,
    );
  };

  const codes = (await options.host.list(dir)).flatMap((name) => {
    const match = GENERATION.exec(name);
    return match ? [Number(match[1])] : [];
  });
  await openGeneration(codes.length > 0 ? Math.max(...codes) : now());

  const find = async (key: string, origin: ThreadOrigin, context: Context): Promise<Conversation> => {
    const id = (await harness.snapshot(ConversationsDoc, context))?.threads[key];
    if (id !== undefined) {
      const existing = await harness.conversation(id as ConversationId, context);
      if (existing) return existing;
    }
    return harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        init: async (tx, conversationId) => {
          (await tx.doc(ThreadDoc, conversationId)).origin = origin;
          (await tx.doc(ConversationsDoc)).threads[key] = conversationId;
        },
      },
      context,
    );
  };

  const rotateIfDue = async (context: Context): Promise<boolean> => {
    const bytes = await options.host.size(path);
    if (bytes <= rotateAt) return false;
    let inspection = await harness.inspect(context);
    if (!idle(inspection)) {
      if (bytes <= force) return false;
      const live = new Set<ConversationId>();
      for (const task of inspection.tasks) live.add(task.record.conversationId);
      for (const record of inspection.submissions) live.add(record.conversationId);
      await Promise.all(
        [...live].map(async (id) => (await harness.conversation(id, context))?.abort(context, { background: true })),
      );
      inspection = await harness.inspect(context);
      if (!idle(inspection)) return false;
    }
    const old = path;
    await harness.close(context);
    conversations.clear();
    desks.clear();
    refusals.clear();
    await openGeneration(Math.max(now(), code + 1));
    harness.resume();
    await options.host.remove(old);
    return true;
  };

  let rotating: Promise<boolean> = Promise.resolve(false);

  return {
    get harness() {
      return harness;
    },
    get storage() {
      return storage;
    },
    get path() {
      return path;
    },
    registrations,
    desks,
    turnTask,
    now,
    forgetStubs,
    conversationFor(key, origin, context) {
      let pending = conversations.get(key);
      if (!pending) {
        pending = find(key, origin, context);
        conversations.set(key, pending);
        pending.catch(() => conversations.delete(key));
      }
      return pending;
    },
    maybeRotate(context) {
      const next = rotating.then(
        () => rotateIfDue(context),
        () => rotateIfDue(context),
      );
      rotating = next;
      return next;
    },
    close: (context) => harness.close(context),
  };
}
