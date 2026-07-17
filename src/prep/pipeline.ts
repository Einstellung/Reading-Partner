// The prep pipeline orchestrator: plan -> (fetch -> digest -> note) per paper,
// one paper at a time, resumable from persisted state, lazily ordered by the
// reader's current chapter. All IO and AI calls come in as injected deps so the
// whole state machine runs in bun tests with fakes; live.ts provides the real
// deps (Tauri fs, arXiv/S2, pi-ai).

import { isRateLimitError } from "./http";
import { abstractNoteBody } from "./notes";
import { earliestCooldown, nextQueued, normalizeOnLoad } from "./scheduler";
import { createPrepState, type PrepPaper, type PrepState } from "./types";

// How long a rate-limited paper waits before its next attempt, by cooldown
// round. After the last one is spent, another 429 fails the paper.
const COOLDOWN_MS = [60_000, 300_000, 900_000];

export interface FetchOutcome {
  source: "arxiv" | "semantic-scholar" | null;
  arxivId: string | null;
  abstract: string;
  // Null when no full text could be fetched -> abstract-only note.
  pdfBytes: ArrayBuffer | null;
}

export interface DigestOutcome {
  body: string;
  pages: number | null;
  // True when the PDF turned out unusable (no text layer) and the note fell
  // back to the abstract.
  thin: boolean;
}

export interface PlanOutcome {
  chapters: PrepState["chapters"];
  references: PrepState["references"];
  papers: PrepPaper[];
}

export interface PipelineDeps {
  loadState(hash: string): Promise<PrepState | null>;
  saveState(state: PrepState): Promise<void>;
  buildPlan(): Promise<PlanOutcome>;
  fetchPaper(paper: PrepPaper): Promise<FetchOutcome | null>;
  digestPaper(paper: PrepPaper, fetched: FetchOutcome): Promise<DigestOutcome>;
  writeNote(paper: PrepPaper, body: string): Promise<void>;
  // Resolve a user-typed query (title or arXiv id) to a paper stub.
  resolveAddition(query: string, taken: Set<string>): PrepPaper;
  now(): number;
  // Wait out a cooldown before re-checking the queue (injected so tests never
  // touch real timers).
  sleep(ms: number): Promise<void>;
}

export interface PrepSnapshot {
  state: PrepState | null;
  running: boolean;
}

export class PrepPipeline {
  private state: PrepState | null = null;
  private running = false;
  private currentChapter = 1;
  private listeners = new Set<() => void>();
  private snap: PrepSnapshot = { state: null, running: false };

  constructor(
    private readonly surveyHash: string,
    private readonly surveyName: string,
    private readonly deps: PipelineDeps,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Stable between notifications so useSyncExternalStore doesn't loop.
  snapshot(): PrepSnapshot {
    return this.snap;
  }

  private notify(): void {
    // Deep-ish copy so React sees fresh identities without the pipeline's
    // in-place mutations leaking into rendered state.
    this.snap = {
      state: this.state
        ? { ...this.state, papers: this.state.papers.map((p) => ({ ...p })) }
        : null,
      running: this.running,
    };
    for (const fn of this.listeners) fn();
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    try {
      await this.deps.saveState(this.state);
    } catch (e) {
      console.warn("failed to persist prep state", e);
    }
    this.notify();
  }

  // The reader moved; reorder the lazy queue. Cheap, callable on every page turn.
  setCurrentChapter(chapter: number): void {
    this.currentChapter = chapter;
  }

  skip(slug: string): void {
    const p = this.state?.papers.find((x) => x.slug === slug);
    if (!p || p.status === "done" || p.status === "abstract-only") return;
    p.status = "skipped";
    void this.persist();
  }

  requeue(slug: string): void {
    const p = this.state?.papers.find((x) => x.slug === slug);
    if (!p || (p.status !== "skipped" && p.status !== "failed" && p.status !== "cooldown")) return;
    p.status = "queued";
    p.error = undefined;
    p.retryAt = undefined;
    p.fetchAttempts = undefined;
    void this.persist();
    void this.run();
  }

  addPaper(query: string): void {
    if (!this.state) return;
    const taken = new Set(this.state.papers.map((p) => p.slug));
    const paper = this.deps.resolveAddition(query, taken);
    this.state.papers.push(paper);
    void this.persist();
    void this.run();
  }

  // Idempotent entry point: loads (or creates) the state and runs the loop to
  // exhaustion. Callers that don't want to wait fire-and-forget it; a second
  // call while a run is active is a no-op.
  async ensureStarted(): Promise<void> {
    if (!this.state) {
      const loaded = await this.deps.loadState(this.surveyHash);
      this.state = loaded
        ? normalizeOnLoad(loaded)
        : createPrepState(this.surveyHash, this.surveyName, this.deps.now());
      this.notify();
    }
    await this.run();
  }

  private async run(): Promise<void> {
    if (this.running || !this.state) return;
    this.running = true;
    this.notify();
    try {
      await this.runPlan();
      await this.runPapers();
    } finally {
      this.running = false;
      this.notify();
    }
  }

  private async runPlan(): Promise<void> {
    const s = this.state!;
    if (s.planStatus === "done") return;
    s.planStatus = "running";
    s.planError = undefined;
    await this.persist();
    try {
      const plan = await this.deps.buildPlan();
      // User-added papers survive a replan; nominated ones are replaced.
      const added = s.papers.filter((p) => p.addedByUser);
      s.chapters = plan.chapters;
      s.references = plan.references;
      s.papers = [...plan.papers, ...added];
      s.planStatus = "done";
    } catch (e) {
      s.planStatus = "failed";
      s.planError = e instanceof Error ? e.message : String(e);
    }
    await this.persist();
  }

  private async runPapers(): Promise<void> {
    const s = this.state!;
    if (s.planStatus !== "done") return;
    // One at a time, re-picking after each finish so chapter changes and
    // user additions reorder the remainder. When only rate-limited papers are
    // left, wait out the earliest cooldown and release the ones whose time has
    // come, rather than exiting the run.
    for (;;) {
      const paper = nextQueued(s.papers, this.currentChapter, s.chapters.length);
      if (paper) {
        await this.runOne(paper);
        continue;
      }
      const next = earliestCooldown(s.papers);
      if (next === null) return;
      const wait = next - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
      const now = this.deps.now();
      let released = false;
      for (const p of s.papers) {
        if (p.status === "cooldown" && typeof p.retryAt === "number" && p.retryAt <= now) {
          p.status = "queued";
          p.retryAt = undefined;
          released = true;
        }
      }
      // Nothing became ready (a no-op sleep that didn't advance time) — stop
      // instead of spinning.
      if (!released) return;
      await this.persist();
    }
  }

  private skippedMeanwhile(paper: PrepPaper): boolean {
    return paper.status === "skipped";
  }

  private async runOne(paper: PrepPaper): Promise<void> {
    paper.status = "fetching";
    paper.error = undefined;
    await this.persist();

    let fetched: FetchOutcome | null;
    try {
      fetched = await this.deps.fetchPaper(paper);
    } catch (e) {
      if (!this.skippedMeanwhile(paper)) {
        if (isRateLimitError(e)) this.cooldown(paper, e.message);
        else {
          paper.status = "failed";
          paper.error = e instanceof Error ? e.message : String(e);
        }
      }
      await this.persist();
      return;
    }
    if (this.skippedMeanwhile(paper)) return;
    // A successful fetch clears any rate-limit history.
    paper.fetchAttempts = undefined;
    paper.retryAt = undefined;

    if (!fetched) {
      paper.status = "failed";
      paper.error = "not found on arXiv or Semantic Scholar";
      await this.persist();
      return;
    }
    paper.source = fetched.source;
    if (fetched.arxivId) paper.arxivId = fetched.arxivId;
    paper.abstract = fetched.abstract || paper.abstract;

    if (!fetched.pdfBytes) {
      await this.finishThin(paper);
      return;
    }

    paper.status = "digesting";
    await this.persist();
    try {
      const digest = await this.deps.digestPaper(paper, fetched);
      if (this.skippedMeanwhile(paper)) return;
      paper.pages = digest.pages;
      paper.status = digest.thin ? "abstract-only" : "done";
      await this.deps.writeNote(paper, digest.body || abstractNoteBody(paper.abstract));
    } catch (e) {
      if (!this.skippedMeanwhile(paper)) {
        paper.status = "failed";
        paper.error = e instanceof Error ? e.message : String(e);
      }
    }
    await this.persist();
  }

  // A terminal 429: cool the paper down for a growing interval instead of
  // failing it. After the cooldown rounds are spent, give up with the 429
  // message so the paper reads as failed for a real reason.
  private cooldown(paper: PrepPaper, message: string): void {
    const round = paper.fetchAttempts ?? 0;
    if (round >= COOLDOWN_MS.length) {
      paper.status = "failed";
      paper.error = message;
      return;
    }
    paper.fetchAttempts = round + 1;
    paper.status = "cooldown";
    paper.retryAt = this.deps.now() + COOLDOWN_MS[round];
    paper.error = undefined;
  }

  private async finishThin(paper: PrepPaper): Promise<void> {
    paper.status = "abstract-only";
    try {
      await this.deps.writeNote(paper, abstractNoteBody(paper.abstract));
    } catch (e) {
      paper.status = "failed";
      paper.error = e instanceof Error ? e.message : String(e);
    }
    await this.persist();
  }
}
