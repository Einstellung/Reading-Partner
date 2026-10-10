// The SQLite-backend scenes of the pi-durable spike
// (docs/research/pi-durable-spike.md, "SQLite 后端"): commit latency while a
// reply streams, twelve conversations in one harness, one conversation's tool
// asking another, per-reply growth and the generation swap, and the crash
// halves. They run on whatever opens the database: the Tauri IPC in the app
// (scripts/durable-probe/main.ts), a bun:sqlite stand-in under test.

import { awaitWithContext, BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type, type TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
  defineExtension,
  defineTool,
  MemoryStorage,
  type ConversationId,
  type Harness,
  type Storage,
} from "@earendil-works/pi-durable";
import { SqliteStorage, type SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite";
import { lines, livePartial, openSpike, SPIKE_MODEL, type SpikeTools } from "./spike";

const ctx = BACKGROUND_CONTEXT;
const agent = { model: SPIKE_MODEL };
const quiet: SpikeTools = { lookup: async (q) => `text of ${q}`, note: async () => "noted" };
const now = () => performance.now();
const round = (n: number) => Math.round(n * 100) / 100;

export interface SceneHost {
  open(path: string): Promise<SqliteDatabase>;
  remove(path: string): Promise<void>;
}

export interface Spread {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export function spread(samples: readonly number[]): Spread {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1] ?? 0), mean: round(mean) };
}

/** Bytes the database holds after a WAL checkpoint, and per table. */
export async function dbBytes(db: SqliteDatabase) {
  await db.all("PRAGMA wal_checkpoint(TRUNCATE)");
  const pages = (await db.get<{ page_count: number }>("PRAGMA page_count"))!.page_count;
  const free = (await db.get<{ freelist_count: number }>("PRAGMA freelist_count"))!.freelist_count;
  const size = (await db.get<{ page_size: number }>("PRAGMA page_size"))!.page_size;
  const tables: Record<string, { rows: number; bytes: number }> = {};
  for (const [table, column] of [
    ["entries", "record"],
    ["documents", "record"],
    ["document_revisions", "content"],
    ["tasks", "record"],
    ["submissions", "record"],
    ["conversations", "record"],
  ]) {
    const row = await db.get<{ rows: number; bytes: number }>(
      `SELECT count(*) AS rows, coalesce(sum(length(CAST(${column} AS BLOB))), 0) AS bytes FROM ${table}`,
    );
    tables[table] = { rows: Number(row!.rows), bytes: Number(row!.bytes) };
  }
  const recordBytes = Object.values(tables).reduce((sum, t) => sum + t.bytes, 0);
  return { fileBytes: pages * size, liveBytes: (pages - free) * size, recordBytes, tables };
}

function lastUser(context: TranscriptContext): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role === "user") {
      return typeof message.content === "string"
        ? message.content
        : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    }
  }
  return "";
}

function lastToolText(context: TranscriptContext): string | undefined {
  const last = context.messages[context.messages.length - 1];
  if (last?.role !== "toolResult") return undefined;
  return last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** Wrap `storage.commit` to time every commit. */
function timeCommits(storage: Storage, samples: number[]) {
  const commit = storage.commit.bind(storage);
  storage.commit = async (writes, context) => {
    const start = now();
    try {
      return await commit(writes, context);
    } finally {
      samples.push(now() - start);
    }
  };
}

const LONG = "潮汐是月球和太阳引力共同作用的结果，".repeat(80); // 1440 characters, 4320 bytes

export interface LatencyOptions {
  tokensPerSecond: number;
  rounds: number;
  /** Host calls made so far; the scene reports calls per commit from it. */
  calls?: () => number;
}

/**
 * One streamed reply on MemoryStorage, then `rounds` on SQLite, each with a
 * 100ms partial interval: commit times, host calls per commit, the longest gap
 * between two pi.live updates, and the database growth per reply.
 */
export async function latencyScene(host: SceneHost, path: string, options: LatencyOptions) {
  const settings = { progress: { partialIntervalMs: 100, outputIntervalMs: 100 } };
  const streamOnce = async (harness: Harness, conversationId: ConversationId) => {
    const conversation = (await harness.conversation(conversationId, ctx))!;
    let last = "";
    let lastAt = 0;
    const gaps: number[] = [];
    const view = await conversation.viewState(ctx);
    view.subscribe((value) => {
      const text = livePartial(value.docs) ?? "";
      if (text === last || text === "") return;
      const t = now();
      if (lastAt) gaps.push(t - lastAt);
      last = text;
      lastAt = t;
    });
    const start = now();
    await (await conversation.submit({ type: "input", content: "Explain the tides." }, ctx)).wait(ctx);
    const ms = now() - start;
    view.dispose?.();
    return { ms, gaps };
  };
  const fauxOptions = { tokensPerSecond: options.tokensPerSecond, tokenSize: { min: 1, max: 2 } };

  const memFaux = fauxProvider(fauxOptions);
  memFaux.setResponses([fauxAssistantMessage(fauxText(LONG))]);
  const mem = await openSpike({ storage: new MemoryStorage(), faux: memFaux, tools: quiet, settings });
  const memRoot = await mem.root(ctx, { agent });
  const baseline = await streamOnce(mem, memRoot.id);
  await mem.close(ctx);

  const db = await host.open(path);
  const storage = await SqliteStorage.open(db);
  const commits: number[] = [];
  timeCommits(storage, commits);
  const faux = fauxProvider(fauxOptions);
  faux.setResponses(Array.from({ length: options.rounds }, () => fauxAssistantMessage(fauxText(LONG))));
  const harness = await openSpike({ storage, faux, tools: quiet, settings });
  const root = await harness.root(ctx, { agent });
  const before = await dbBytes(db);
  const callsBefore = options.calls?.() ?? 0;
  const runs: { ms: number; maxGap: number; commits: number; growth: number; recordGrowth: number }[] = [];
  let size = before.liveBytes;
  let records = before.recordBytes;
  for (let i = 0; i < options.rounds; i++) {
    const n = commits.length;
    const run = await streamOnce(harness, root.id);
    const after = await dbBytes(db);
    runs.push({
      ms: round(run.ms),
      maxGap: round(Math.max(...run.gaps)),
      commits: commits.length - n,
      growth: after.liveBytes - size,
      recordGrowth: after.recordBytes - records,
    });
    size = after.liveBytes;
    records = after.recordBytes;
  }
  const calls = (options.calls?.() ?? 0) - callsBefore;
  const end = await dbBytes(db);
  await harness.close(ctx);
  return {
    baseline: { ms: round(baseline.ms), maxGap: round(Math.max(...baseline.gaps)), updates: baseline.gaps.length + 1 },
    runs,
    commit: spread(commits),
    callsPerCommit: options.calls ? round(calls / commits.length) : undefined,
    end,
  };
}

/** The README's foreground subagent: the child conversation is owned by the tool's task. */
const subagent = defineExtension({
  name: "subagent",
  tools: [
    defineTool({
      name: "subagent",
      description: "Delegate a self-contained task to a subagent and get its answer back.",
      parameters: Type.Object({ task: Type.String() }),
      replay: "safe",
      execute: async (args, api, context) => {
        const child = await api.commit(async (tx) => {
          const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
          if (existing !== undefined) return existing.id;
          return (await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } })).id;
        }, context);
        const request = { type: "input", content: args.task, requestId: `subagent:${api.taskId}` } as const;
        const settled = await (await (await api.conversation(child, context))!.submit(request, context)).wait(context);
        return { content: [{ type: "text", text: `child ${settled.status}` }] };
      },
    }),
  ],
});

/**
 * `count` ownerless conversations submitted at once: every third delegates to a
 * subagent, every third runs a slow `lookup` and gets a steer while it runs.
 */
export async function concurrencyScene(host: SceneHost, path: string, count = 12, timeoutMs = 120_000) {
  const steerAt = new Map<string, () => void>();
  const tools: SpikeTools = {
    ...quiet,
    lookup: async (query) => {
      steerAt.get(query)?.();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return `text of ${query}`;
    },
  };
  const faux = fauxProvider({ tokensPerSecond: 400 });
  const respond = (context: TranscriptContext) => {
    if (lastToolText(context) === undefined) {
      const text = lastUser(context);
      const tag = text.split(" ")[0];
      if (text.includes("[delegate]")) {
        return fauxAssistantMessage([fauxToolCall("subagent", { task: `research for ${tag}` })], { stopReason: "toolUse" });
      }
      if (text.includes("[lookup]")) {
        return fauxAssistantMessage([fauxToolCall("lookup", { query: tag })], { stopReason: "toolUse" });
      }
    }
    return fauxAssistantMessage(fauxText(`${lastUser(context)}: ${"word ".repeat(60)}`));
  };
  faux.setResponses(Array.from({ length: count * 4 }, () => respond));
  const db = await host.open(path);
  const storage = await SqliteStorage.open(db);
  const harness = await openSpike({
    storage,
    faux,
    tools,
    extensions: [subagent],
    settings: { progress: { partialIntervalMs: 100, outputIntervalMs: 100 } },
  });
  const start = now();
  const jobs = Array.from({ length: count }, async (_, i) => {
    const tag = `c${i}`;
    const mode = i % 3 === 0 ? "delegate" : i % 3 === 1 ? "lookup" : "plain";
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
    const steered = mode === "lookup" ? new Promise<void>((resolve) => steerAt.set(tag, resolve)) : undefined;
    const input = await conversation.submit({ type: "input", content: `${tag} [${mode}] go` }, ctx);
    const waits = [input.wait(ctx)];
    if (steered) {
      await steered;
      waits.push((await conversation.submit({ type: "input", content: `${tag}-steer only page one`, whenBusy: "steer" }, ctx)).wait(ctx));
    }
    const settled = await Promise.all(waits);
    const kinds = lines((await conversation.viewState(ctx)).value.entries)
      .filter((l) => l.kind !== "pi.system")
      .map((l) => l.kind);
    return { tag, mode, status: settled.map((s) => s.status), kinds };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
  const outcome = await Promise.race([Promise.all(jobs), timedOut]);
  clearTimeout(timer);
  const ms = round(now() - start);
  if (outcome === "timeout") {
    const inspection = await harness.inspect(ctx);
    return { stuck: true, ms, tasks: inspection.tasks.length, submissions: inspection.submissions.length };
  }
  await harness.waitForIdle(ctx);
  const children = (await storage.scanConversations({}, 1000, undefined, ctx)).items.filter(
    (c) => c.owner !== undefined,
  ).length;
  const bytes = await dbBytes(db);
  await harness.close(ctx);
  return { stuck: false, ms, children, conversations: outcome, bytes };
}

/** A tool in conversation A submits to conversation B and waits for B's answer. */
export async function collaborationScene(host: SceneHost, path: string) {
  let peerId: ConversationId | undefined;
  let harnessRef: Harness | undefined;
  const askPeer = defineExtension({
    name: "peer",
    tools: [
      defineTool({
        name: "ask_peer",
        description: "Ask the peer conversation and return its answer.",
        parameters: Type.Object({ question: Type.String() }),
        replay: "safe",
        execute: async (args, api, context) => {
          const peer = await api.conversation(peerId!, context);
          const request = { type: "input", content: args.question, requestId: `ask:${api.taskId}` } as const;
          const settled = await (await peer!.submit(request, context)).wait(context);
          // The tool API reads only its own conversation; the peer's answer entry is read through the harness.
          const view = await (await harnessRef!.conversation(peerId!, context))!.viewState(context);
          const answers = lines(view.value.entries.filter((e) => settled.status === "done" && e.id === settled.answer));
          const answer = answers[0]?.text ?? "";
          return { content: [{ type: "text", text: answer }] };
        },
      }),
    ],
  });
  const faux = fauxProvider({ tokensPerSecond: 400 });
  const respond = (context: TranscriptContext) => {
    const tool = lastToolText(context);
    if (tool !== undefined) return fauxAssistantMessage(fauxText(`A heard: ${tool}`));
    if (lastUser(context).includes("[ask]")) {
      return fauxAssistantMessage([fauxToolCall("ask_peer", { question: "What moves the tides?" })], { stopReason: "toolUse" });
    }
    return fauxAssistantMessage(fauxText("B says: the moon."));
  };
  faux.setResponses([respond, respond, respond]);
  const db = await host.open(path);
  const harness = await openSpike({ storage: await SqliteStorage.open(db), faux, tools: quiet, extensions: [askPeer] });
  harnessRef = harness;
  const a = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
  const b = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
  peerId = b.id;
  const start = now();
  const settled = await (await a.submit({ type: "input", content: "[ask] what does B think?" }, ctx)).wait(ctx);
  const ms = round(now() - start);
  const aLines = lines((await a.viewState(ctx)).value.entries).filter((l) => l.kind !== "pi.system");
  const bLines = lines((await b.viewState(ctx)).value.entries).filter((l) => l.kind !== "pi.system");
  await harness.close(ctx);
  return { ms, status: settled.status, a: aLines, b: bLines };
}

/**
 * The swap: wait for idle, close, open the next generation, seed the
 * conversation from what the thread file would hold, delete the old one. Then
 * what close does to a tool that is still running.
 */
export async function rotationScene(host: SceneHost, dir: string) {
  const faux = fauxProvider({ tokensPerSecond: 1000 });
  let seen: string[] = [];
  faux.setResponses([
    fauxAssistantMessage(fauxText("First answer.")),
    fauxAssistantMessage(fauxText("Second answer.")),
    (context) => {
      seen = context.messages.map((m) => m.role);
      return fauxAssistantMessage(fauxText("Third answer, on the new generation."));
    },
  ]);
  const oldPath = `${dir}/gen-1.sqlite`;
  const newPath = `${dir}/gen-2.sqlite`;
  const oldDb = await host.open(oldPath);
  const first = await openSpike({ storage: await SqliteStorage.open(oldDb), faux, tools: quiet });
  const conv = await first.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
  await (await conv.submit({ type: "input", content: "Q1" }, ctx)).wait(ctx);
  await (await conv.submit({ type: "input", content: "Q2" }, ctx)).wait(ctx);
  // What the thread file holds once both turns have landed.
  const thread = lines((await conv.viewState(ctx)).value.entries).filter(
    (l) => l.kind === "pi.user" || l.kind === "pi.assistant",
  );
  await first.waitForIdle(ctx);
  const inspection = await first.inspect(ctx);
  const idle = inspection.tasks.length === 0 && inspection.submissions.length === 0;
  const oldBytes = (await dbBytes(oldDb)).liveBytes;
  await first.close(ctx);
  const harnessClosesDb = await oldDb.get("SELECT 1 AS one").then(
    () => false,
    () => true,
  );
  if (!harnessClosesDb) await oldDb.close();
  await host.remove(oldPath);

  const newDb = await host.open(newPath);
  const second = await openSpike({ storage: await SqliteStorage.open(newDb), faux, tools: quiet });
  const seeded = await second.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
  await seeded.commit(async (tx) => {
    const model = thread.map((l) =>
      l.kind === "pi.user"
        ? { role: "user" as const, content: l.text, timestamp: Date.now() }
        : fauxAssistantMessage(fauxText(l.text)),
    );
    await tx.appendEntry(seeded.id, { kind: "app.thread-seed", model });
  }, ctx);
  await (await seeded.submit({ type: "input", content: "Q3" }, ctx)).wait(ctx);
  const newBytes = (await dbBytes(newDb)).liveBytes;
  await second.close(ctx);
  if (!harnessClosesDb) await newDb.close();
  const reopened = await host.open(oldPath);
  const oldGone = (await reopened.get<{ n: number }>("SELECT count(*) AS n FROM sqlite_master"))!.n === 0;
  await reopened.close();
  await host.remove(oldPath);
  await host.remove(newPath);
  return {
    idle,
    harnessClosesDb,
    oldBytes,
    oldGone,
    seededRoles: seen,
    newBytes,
    busyCloseIgnoringCancel: await busyClose(host, dir, false),
    busyCloseHonouringCancel: await busyClose(host, dir, true),
  };
}

/**
 * Close while a tool runs: does close wait for it, and what is left in the old
 * database. `honour` makes the tool stop when its context is cancelled.
 */
async function busyClose(host: SceneHost, dir: string, honour: boolean) {
  const path = `${dir}/busy.sqlite`;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const running = new Promise<void>((resolve) => (started = resolve));
  const long = defineExtension({
    name: "long",
    tools: [
      defineTool({
        name: "long_job",
        description: "A job that runs until released.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async (_args, _api, context) => {
          started();
          await (honour ? awaitWithContext(gate, context) : gate);
          return { content: [{ type: "text", text: "job done" }] };
        },
      }),
    ],
  });
  const faux = fauxProvider({ tokensPerSecond: 1000 });
  faux.setResponses([fauxAssistantMessage([fauxToolCall("long_job", {})], { stopReason: "toolUse" })]);
  const db = await host.open(path);
  const harness = await openSpike({ storage: await SqliteStorage.open(db), faux, tools: quiet, extensions: [long] });
  const conv = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
  await conv.submit({ type: "input", content: "start a long lookup" }, ctx);
  await running;
  const before = await harness.inspect(ctx);
  const start = now();
  const closing = harness.close(ctx).then(() => now() - start);
  const within2s = await Promise.race([closing.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 2000))]);
  release();
  const closeMs = round(await closing);
  const reopened = await host.open(path);
  const leftover = await reopened.all<{ kind: string; status: string }>("SELECT kind, status FROM tasks WHERE status != 'terminal'");
  await reopened.close();
  await host.remove(path);
  return {
    liveTasksWhileRunning: before.tasks.length,
    closeReturnedWithin2s: within2s,
    closeMs,
    leftoverTasks: leftover,
  };
}

const CRASH_ANSWER = "潮汐是月球和太阳引力共同作用的结果，".repeat(80);

/** First half of the crash scene: stream slowly and call `armed` once 200 characters are committed. */
export async function crashStart(host: SceneHost, path: string, armed: (partial: string) => void) {
  const faux = fauxProvider({ tokensPerSecond: 70, tokenSize: { min: 1, max: 2 } });
  faux.setResponses([fauxAssistantMessage(fauxText(CRASH_ANSWER))]);
  const harness = await openSpike({
    storage: await SqliteStorage.open(await host.open(path)),
    faux,
    tools: quiet,
    settings: { progress: { partialIntervalMs: 100, outputIntervalMs: 100 } },
  });
  const root = await harness.root(ctx, { agent });
  let fired = false;
  (await root.viewState(ctx)).subscribe((value) => {
    const partial = livePartial(value.docs) ?? "";
    if (!fired && partial.length >= 200) {
      fired = true;
      armed(partial);
    }
  });
  await root.submit({ type: "input", content: "Explain the tides.", requestId: "crash-1" }, ctx);
}

/** Second half: reopen, read what pi.live holds, resume and wait for the same submission. */
export async function crashResume(host: SceneHost, path: string) {
  const faux = fauxProvider({ tokensPerSecond: 1000 });
  let requestRoles: string[] = [];
  faux.setResponses([
    (context) => {
      requestRoles = context.messages.map((m) => m.role);
      return fauxAssistantMessage(fauxText(CRASH_ANSWER));
    },
  ]);
  const db = await host.open(path);
  const harness = await openSpike({ storage: await SqliteStorage.open(db), faux, tools: quiet });
  const root = await harness.root(ctx, { agent });
  const partialAtReopen = livePartial((await root.viewState(ctx)).value.docs) ?? "";
  const pending = (await harness.inspect(ctx)).submissions.length;
  harness.resume();
  const again = await root.submit({ type: "input", content: "Explain the tides.", requestId: "crash-1" }, ctx);
  const settled = await again.wait(ctx);
  const entries = (await root.viewState(ctx)).value.entries.filter((e) => e.kind !== "pi.system");
  const transcript = lines(entries);
  const stopReasons = entries.map((e) => (e.model?.[0] as { stopReason?: string } | undefined)?.stopReason ?? null);
  await harness.close(ctx);
  return {
    partialAtReopenChars: partialAtReopen.length,
    pendingSubmissionsAtReopen: pending,
    status: settled.status,
    requestRoles,
    transcript: transcript.map((l, i) => ({ kind: l.kind, chars: l.text.length, stopReason: stopReasons[i] })),
    finalAnswerIsFull: transcript[transcript.length - 1]?.text === CRASH_ANSWER,
  };
}
