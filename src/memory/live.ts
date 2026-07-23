// Live wiring of the memory module: the Tauri fs behind MemoryFs, one adapter
// per topic for the app's lifetime, the hangup/trim distillation entry points
// (real model through runAgentTurn, same provider config as chat), and a tiny
// change feed so the memory panel refreshes after background writes.

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { runAgentTurn } from "../ai/agent";
import type { ProviderId } from "../ai/providers";
import { loadSettings, toReasoning } from "../app/settings";
import { logEvent } from "../app/events";
import { FileMemoryAdapter, type MemoryAdapter } from "./adapter";
import { isoDate } from "./files";
import { MemoryFileStore, type MemoryFs } from "./store";
import {
  runDistillation,
  selectSilentMarks,
  type DistillAnnotation,
  type DistillMessage,
} from "./distill";

const tauriFs: MemoryFs = {
  async read(path) {
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return null;
    return readTextFile(path, { baseDir: BaseDirectory.AppData });
  },
  async write(path, content) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextFile(path, content, { baseDir: BaseDirectory.AppData });
  },
  async remove(path) {
    await remove(path, { baseDir: BaseDirectory.AppData });
  },
  async listDir(path) {
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return [];
    const entries = await readDir(path, { baseDir: BaseDirectory.AppData });
    return entries.filter((e) => e.isFile).map((e) => e.name);
  },
};

const stores = new Map<string, MemoryFileStore>();
const adapters = new Map<string, FileMemoryAdapter>();

function getStore(topicId: string): MemoryFileStore {
  let s = stores.get(topicId);
  if (!s) {
    s = new MemoryFileStore(topicId, tauriFs);
    stores.set(topicId, s);
  }
  return s;
}

export function getMemoryAdapter(topicId: string): MemoryAdapter {
  let a = adapters.get(topicId);
  if (!a) {
    a = new FileMemoryAdapter(getStore(topicId));
    adapters.set(topicId, a);
  }
  return a;
}

export async function getLastDistillation(topicId: string): Promise<number | null> {
  return (await getStore(topicId).getMeta()).lastDistilledAt;
}

// --- change feed (memory panel refresh after background writes) ---

type MemoryListener = (topicId: string) => void;
const listeners = new Set<MemoryListener>();

export function onMemoryChange(cb: MemoryListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function notifyMemoryChange(topicId: string): void {
  for (const cb of listeners) cb(topicId);
}

// --- distillation triggers ---

export interface DistillThreadOptions {
  topicId: string;
  topicName: string;
  bookName: string;
  threadId: string;
  annotationId: string;
  page: number | null;
  markedText: string;
  messages: DistillMessage[];
  // The book's annotations, so distillation can fold in silent marks made since
  // the last pass (docs/02 part 2). Absent/empty is fine.
  annotations?: DistillAnnotation[];
}

// Message count per thread at its last distillation, so hangup after a trim
// distillation (or a re-opened and immediately re-closed thread) doesn't
// re-distill the same transcript.
const distilledCounts = new Map<string, number>();
const inFlight = new Set<string>();

async function resolveModel(): Promise<{
  providerId: ProviderId;
  modelId: string;
  reasoning: ThinkingLevel | undefined;
}> {
  const s = await loadSettings();
  if (!s.defaultProviderId || !s.defaultModelId) {
    throw new Error("no default AI provider configured (Settings)");
  }
  return {
    providerId: s.defaultProviderId as ProviderId,
    modelId: s.defaultModelId,
    reasoning: toReasoning(s.chatThinking),
  };
}

// One silent distillation turn for a finished (or long-running) thread.
// Never throws and never surfaces UI: memory is derived, a failed pass just
// means the next trigger tries again. `minNewMessages` gates the trim fallback
// so it doesn't re-fire on every turn of a long conversation.
export async function distillThread(
  opts: DistillThreadOptions,
  minNewMessages = 1,
): Promise<void> {
  const { threadId, messages } = opts;
  if (inFlight.has(threadId)) return;
  // Nothing the reader said → nothing that can't be re-derived from the book
  // and the annotation itself.
  if (!messages.some((m) => m.role === "user" && m.text.trim() !== "")) return;
  const since = distilledCounts.get(threadId) ?? 0;
  if (messages.length - since < minNewMessages) return;

  inFlight.add(threadId);
  try {
    const model = await resolveModel();
    const store = getStore(opts.topicId);
    const adapter = getMemoryAdapter(opts.topicId);
    const meta = await store.getMeta();
    const { marks, capped } = selectSilentMarks(
      opts.annotations ?? [],
      meta.lastAnnotationDistillAt,
    );
    const result = await runDistillation(
      {
        topicName: opts.topicName,
        bookName: opts.bookName,
        threadId,
        annotationId: opts.annotationId,
        page: opts.page,
        markedText: opts.markedText,
        messages,
        indexText: await store.readIndexText(),
        today: isoDate(Date.now()),
        silentMarks: marks,
        silentMarksCapped: capped,
      },
      adapter,
      ({ systemPrompt, userText, tools }) =>
        new Promise<void>((resolve, reject) => {
          void runAgentTurn({
            providerId: model.providerId,
            modelId: model.modelId,
            systemPrompt,
            messages: [{ role: "user", text: userText }],
            tools,
            reasoning: model.reasoning,
            onDelta: () => {},
            onToolStart: () => {},
            onToolEnd: () => {},
            onDone: () => resolve(),
            onError: (m) => reject(new Error(m)),
          });
        }),
    );
    distilledCounts.set(threadId, messages.length);
    // Advance both stamps only after a successful pass: the transcript's, and —
    // when this pass actually saw the marks — the silent-marks cursor.
    await store.setMeta({
      lastDistilledAt: Date.now(),
      lastAnnotationDistillAt: marks.length > 0 ? marks[0].createdAt : meta.lastAnnotationDistillAt,
    });
    logEvent(opts.topicId, "distill-run", {
      threadId,
      created: result.created,
      updated: result.updated,
      deleted: result.deleted,
    });
    notifyMemoryChange(opts.topicId);
  } catch (e) {
    console.warn("memory distillation failed", e);
  } finally {
    inFlight.delete(threadId);
  }
}
