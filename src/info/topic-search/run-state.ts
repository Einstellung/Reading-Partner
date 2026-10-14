// What topic-search runs keep on this device and nowhere else (docs/info/88
// 「取材 / X」「排队」), the way info-site-sessions.json and
// info-source-health.json are kept: in AppData, out of sync range.
//
//   info-topic-search-state.json   where each (search, query) line stopped and
//                                  the ids it read in the last 30 days; X pages
//                                  opened today; what tonight's runs have used of
//                                  the night's ceiling; the last halt.
//   topic-search-runs/<run id>/    one directory per run: the X progress file
//                                  (one step a line, what a cut-off run resumes
//                                  from) and what the read handed the build.
//
// Losing the state file costs a night of re-reading posts already seen, so it
// is read leniently; writes are chained so two writers never interleave
// (docs/pitfall/484).

import { X_NIGHTLY_LIMITS, type XReadLimits, type XReadResult } from "./x-reader";
import type { XHaltRecord } from "./halt";
import type { XProgressLog, XReaderMemory, XReaderStore, XStep } from "./x-progress";

export const TOPIC_SEARCH_STATE_FILE = "info-topic-search-state.json";
export const TOPIC_SEARCH_RUNS_DIR = "topic-search-runs";
export const X_PROGRESS_FILE = "x-progress.jsonl";
export const X_READ_FILE = "x-read.json";

/** What the night's runs have used of its ceiling, every topic together. */
export interface NightUse {
  night: string;
  posts: number;
  searchPages: number;
  permalinkPages: number;
  activeMs: number;
}

export interface TopicSearchLocalState {
  reader: XReaderMemory;
  night: NightUse | null;
  halt: XHaltRecord | null;
}

export function emptyState(): TopicSearchLocalState {
  return { reader: { marks: {}, daily: null }, night: null, halt: null };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The state off its file; whatever does not read comes back empty. */
export function parseState(text: string): TopicSearchLocalState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyState();
  }
  if (!isObject(raw)) return emptyState();
  const reader = isObject(raw.reader) ? raw.reader : {};
  return {
    reader: {
      marks: isObject(reader.marks) ? (reader.marks as XReaderMemory["marks"]) : {},
      daily: isObject(reader.daily) ? (reader.daily as unknown as XReaderMemory["daily"]) : null,
    },
    night: isObject(raw.night) && typeof raw.night.night === "string" ? (raw.night as unknown as NightUse) : null,
    halt: isObject(raw.halt) && typeof raw.halt.kind === "string" ? (raw.halt as unknown as XHaltRecord) : null,
  };
}

/** The ceiling left for a daily run on `night`, after what the night's earlier runs used. */
export function nightLimits(use: NightUse | null, night: string, ceiling: XReadLimits = X_NIGHTLY_LIMITS): XReadLimits {
  const used = use && use.night === night ? use : null;
  const left = (all: number, spent: number | undefined) => Math.max(0, all - (spent ?? 0));
  return {
    posts: left(ceiling.posts, used?.posts),
    searchPages: left(ceiling.searchPages, used?.searchPages),
    permalinkPages: left(ceiling.permalinkPages, used?.permalinkPages),
    activeMs: left(ceiling.activeMs, used?.activeMs),
  };
}

/** The night's use after a run that read `x`. */
export function spendNight(use: NightUse | null, night: string, x: XReadResult): NightUse {
  const base = use && use.night === night ? use : { night, posts: 0, searchPages: 0, permalinkPages: 0, activeMs: 0 };
  return {
    night,
    posts: base.posts + x.posts.length,
    searchPages: base.searchPages + x.pages.search,
    permalinkPages: base.permalinkPages + x.pages.permalink,
    activeMs: base.activeMs + x.activeMs,
  };
}

export interface StateFs {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeAtomic(path: string, contents: string): Promise<void>;
  appendText(path: string, text: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
}

export interface TopicSearchStateStore {
  load(): Promise<TopicSearchLocalState>;
  update(change: (state: TopicSearchLocalState) => TopicSearchLocalState): Promise<TopicSearchLocalState>;
  /** The X reader's memory, as x-reader.ts asks for it. */
  reader: XReaderStore;
}

export function createStateStore(fs: StateFs, file: string = TOPIC_SEARCH_STATE_FILE): TopicSearchStateStore {
  let chain: Promise<unknown> = Promise.resolve();
  const read = async () => ((await fs.exists(file)) ? parseState(await fs.readText(file)) : emptyState());
  const queued = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };
  const update = (change: (state: TopicSearchLocalState) => TopicSearchLocalState) =>
    queued(async () => {
      const next = change(await read());
      await fs.writeAtomic(file, `${JSON.stringify(next)}\n`);
      return next;
    });
  return {
    load: () => queued(read),
    update,
    reader: {
      load: async () => (await queued(read)).reader,
      save: async (memory) => {
        await update((s) => ({ ...s, reader: memory }));
      },
    },
  };
}

/** A run's directory. */
export function runDirOf(runId: string): string {
  return `${TOPIC_SEARCH_RUNS_DIR}/${runId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** The progress file of a run: one step a line, appended, a torn last line skipped. */
export function progressLog(fs: StateFs, dir: string): XProgressLog {
  const path = `${dir}/${X_PROGRESS_FILE}`;
  return {
    async load() {
      if (!(await fs.exists(path))) return [];
      const steps: XStep[] = [];
      for (const line of (await fs.readText(path)).split("\n")) {
        if (!line.trim()) continue;
        try {
          steps.push(JSON.parse(line) as XStep);
        } catch {
          // A line cut off by a kill; the run goes on from the one before.
        }
      }
      return steps;
    },
    async append(step) {
      await fs.appendText(path, `${JSON.stringify(step)}\n`);
    },
  };
}

/** What the read handed the build, kept so a rerun of a later phase does not read X again. */
export async function saveRead(fs: StateFs, dir: string, x: XReadResult): Promise<void> {
  await fs.writeAtomic(`${dir}/${X_READ_FILE}`, JSON.stringify(x));
}

export async function loadRead(fs: StateFs, dir: string): Promise<XReadResult | null> {
  const path = `${dir}/${X_READ_FILE}`;
  if (!(await fs.exists(path))) return null;
  try {
    return JSON.parse(await fs.readText(path)) as XReadResult;
  } catch {
    return null;
  }
}
