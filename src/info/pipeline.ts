// The info-briefing orchestrator (docs/16): fetch both sources, run one triage
// AI call under the stall watchdog, save the briefing + article cache. A lighter
// sibling of the notes pipeline — a single AI stage, not a resumable multi-stage
// state machine — but the same shape: injected deps so it runs headless in
// tests, subscribe/snapshot so the vestibule can show liveness, stoppable.

import {
  resolveWatchdogConfig,
  runWithWatchdog,
  StoppedError,
  type AiCallOptions,
  type WatchdogConfig,
} from "../ai/watchdog";
import type { CachedArticle } from "./store";
import { todayLocal } from "./store";
import type { Briefing, BriefingItemMeta, FeedbackEvent, InfoItem, TriageResult } from "./types";

export type { AiCallOptions };

const ACTIVITY_NOTIFY_MS = 250;

export interface InfoDeps {
  loadBriefing(date: string): Promise<Briefing | null>;
  loadProfile(): Promise<string>;
  loadFeedback(): Promise<FeedbackEvent[]>;
  // Fetch both sources fully (list + per-article bodies). Returns every item.
  collect(): Promise<InfoItem[]>;
  // The one triage AI call, wrapped by the watchdog. Validates + retries parse
  // internally; throws on a stall/error so the watchdog can retry the attempt.
  triage(
    input: { profile: string; feedback: FeedbackEvent[]; items: InfoItem[] },
    opts: AiCallOptions,
  ): Promise<TriageResult>;
  saveBriefing(briefing: Briefing): Promise<void>;
  saveArticles(date: string, articles: Record<string, CachedArticle>): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimer(ms: number, cb: () => void): () => void;
  today?(): string;
}

export type InfoPhase = "idle" | "fetching" | "triaging";

export interface InfoActivity {
  startedAt: number;
  chars: number;
  attempt: number;
  attempts: number;
}

export interface InfoSnapshot {
  briefing: Briefing | null;
  running: boolean;
  phase: InfoPhase;
  activity: InfoActivity | null;
  error: string | null;
}

function itemsMeta(items: InfoItem[]): Record<string, BriefingItemMeta> {
  const out: Record<string, BriefingItemMeta> = {};
  for (const it of items) {
    out[it.id] = {
      title: it.title,
      url: it.url,
      source: it.source,
      sourceName: it.sourceName,
      publishedAt: it.publishedAt,
    };
  }
  return out;
}

function articleCache(items: InfoItem[]): Record<string, CachedArticle> {
  const out: Record<string, CachedArticle> = {};
  for (const it of items) {
    if (it.contentHtml || it.textContent) {
      out[it.id] = { contentHtml: it.contentHtml, textContent: it.textContent };
    }
  }
  return out;
}

export class InfoPipeline {
  private briefing: Briefing | null = null;
  private running = false;
  private phase: InfoPhase = "idle";
  private activity: InfoActivity | null = null;
  private error: string | null = null;
  private lastActivityNotify = 0;
  private listeners = new Set<() => void>();
  private snap: InfoSnapshot = { briefing: null, running: false, phase: "idle", activity: null, error: null };
  private readonly config: WatchdogConfig;
  private stopController: AbortController | null = null;

  constructor(private readonly deps: InfoDeps, config: Partial<WatchdogConfig> = {}) {
    this.config = resolveWatchdogConfig(config);
  }

  private today(): string {
    return this.deps.today ? this.deps.today() : todayLocal();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): InfoSnapshot {
    return this.snap;
  }

  private notify(): void {
    this.snap = {
      briefing: this.briefing,
      running: this.running,
      phase: this.phase,
      activity: this.activity,
      error: this.error,
    };
    for (const fn of this.listeners) fn();
  }

  private bumpActivity(chars: number): void {
    if (!this.activity) return;
    this.activity = { ...this.activity, chars };
    const now = this.deps.now();
    if (now - this.lastActivityNotify >= ACTIVITY_NOTIFY_MS) {
      this.lastActivityNotify = now;
      this.notify();
    }
  }

  // Load today's briefing from disk (if any) so the vestibule reflects it. A
  // briefing from a previous day is ignored — only today is ever shown.
  async init(): Promise<void> {
    if (this.briefing || this.running) return;
    this.briefing = await this.deps.loadBriefing(this.today());
    this.notify();
  }

  stop(): void {
    if (!this.running) return;
    this.stopController?.abort();
  }

  // Fetch, triage, and save. A second call while running is a no-op. Regenerate
  // is the same entry point — it overwrites today's briefing.
  async generate(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = null;
    this.phase = "fetching";
    this.stopController = new AbortController();
    this.notify();
    try {
      const items = await this.deps.collect();
      if (this.stopController.signal.aborted) throw new StoppedError();
      if (items.length === 0) throw new Error("No articles could be fetched from either source.");
      const [profile, feedback] = await Promise.all([this.deps.loadProfile(), this.deps.loadFeedback()]);

      this.phase = "triaging";
      this.notify();
      const validIds = new Set(items.map((it) => it.id));
      const result = await runWithWatchdog(
        (opts) => this.deps.triage({ profile, feedback, items }, opts),
        this.config,
        { now: this.deps.now, sleep: this.deps.sleep, setTimer: this.deps.setTimer },
        {
          onAttempt: ({ attempt, attempts, startedAt }) => {
            this.activity = { startedAt, chars: 0, attempt, attempts };
            this.lastActivityNotify = this.deps.now();
            this.notify();
          },
          onProgress: (chars) => this.bumpActivity(chars),
        },
        this.stopController.signal,
      );
      // Defensive: only keep references to items we actually have.
      const date = this.today();
      const briefing: Briefing = {
        date,
        generatedAt: this.deps.now(),
        overview: result.overview,
        mustRead: result.mustRead.filter((r) => validIds.has(r.itemId)),
        oneLiners: result.oneLiners.filter((r) => validIds.has(r.itemId)),
        outOfLane: result.outOfLane.filter((r) => validIds.has(r.itemId)),
        filtered: result.filtered.filter((r) => validIds.has(r.itemId)),
        items: itemsMeta(items),
      };
      await this.deps.saveArticles(date, articleCache(items));
      await this.deps.saveBriefing(briefing);
      this.briefing = briefing;
    } catch (e) {
      if (e instanceof StoppedError) {
        this.error = null;
      } else {
        this.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      this.running = false;
      this.phase = "idle";
      this.activity = null;
      this.stopController = null;
      this.notify();
    }
  }
}
