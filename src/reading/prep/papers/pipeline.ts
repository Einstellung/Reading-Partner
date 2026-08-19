// The prep pipeline orchestrator: plan -> (fetch -> digest -> note) per paper,
// one paper at a time, resumable from persisted state, lazily ordered by the
// reader's current chapter. All IO and AI calls come in as injected deps so the
// whole state machine runs in bun tests with fakes; live.ts provides the real
// deps (Tauri fs, arXiv/S2, pi-ai).

import type { Fulltext } from "../../../fulltext/types";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_WATCHDOG_MS,
  type AiCallOptions,
  type WatchdogConfig,
} from "../../../ai/watchdog";
import { ObservableRun, type RunSnapshot } from "../../../ai/observable-run";
import { cooldownAfter } from "../../../ai/limiter";
import { isRateLimitError } from "../../papers/http";
import { abstractNoteBody } from "./notes";
import { earliestCooldown, nextQueued, normalizeOnLoad } from "./scheduler";
import { createPrepState, type PrepPaper, type PrepState } from "./types";

// The stall-watchdog defaults, re-exported for callers that tuned them before.
export { DEFAULT_WATCHDOG_MS, DEFAULT_MAX_ATTEMPTS, DEFAULT_RETRY_DELAY_MS };
export type { AiCallOptions };

export type PipelineConfig = WatchdogConfig;

export interface FetchOutcome {
  source: "arxiv" | "openalex" | "semantic-scholar" | "url" | null;
  arxivId: string | null;
  abstract: string;
  // Null when no full text could be fetched -> abstract-only note.
  pdfBytes: ArrayBuffer | null;
  // Link ingestion (docs/09): a pre-extracted full text (a fetched web article,
  // or a URL PDF whose text was extracted during fetch so it reads immediately).
  // When set, digest uses it directly instead of parsing pdfBytes.
  fulltext?: Fulltext | null;
  // What a user-pasted source turned out to be, and its refined title (from PDF
  // metadata / the article's <title>). Copied onto the paper after the fetch.
  kind?: "pdf" | "article";
  title?: string | null;
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
  buildPlan(opts: AiCallOptions): Promise<PlanOutcome>;
  fetchPaper(paper: PrepPaper): Promise<FetchOutcome | null>;
  digestPaper(paper: PrepPaper, fetched: FetchOutcome, opts: AiCallOptions): Promise<DigestOutcome>;
  writeNote(paper: PrepPaper, body: string): Promise<void>;
  // Resolve a user-typed query (title or arXiv id) to a paper stub.
  resolveAddition(query: string, taken: Set<string>): PrepPaper;
  now(): number;
  // Wait out a cooldown before re-checking the queue (injected so tests never
  // touch real timers).
  sleep(ms: number): Promise<void>;
  // Schedule the watchdog; returns a cancel handle. Injected so tests drive it
  // on a virtual clock instead of real setTimeout.
  setTimer(ms: number, cb: () => void): () => void;
}

// Runtime-only liveness of the in-flight long AI call. Never persisted in
// PrepState — it exists only while a plan/digest streams, exposed through the
// snapshot so the panel can show a live counter.
export interface PrepActivity {
  kind: "plan" | "digest";
  slug?: string;
  startedAt: number;
  chars: number;
  // 1-based attempt and the total allowed; attempt > 1 means a retry is in
  // flight after a stall or stream error.
  attempt: number;
  attempts: number;
}

export type PrepSnapshot = RunSnapshot<PrepState | null, PrepActivity>;

// The fetch stage's outcome for a captured source on a resumed run: the text is
// read back out of the fulltext cache the ingest wrote (prep/live.ts). Here
// rather than inline in the live deps so the one rule it carries is testable —
// a cached text is used as it stands, and a missing or unusable one is an error
// rather than a fall through to the network. Falling through would fetch the
// page the reader kept a copy of precisely because it may be paywalled or gone,
// and would write whatever it got today over what they kept.
export function capturedFetch(paper: PrepPaper, cached: Fulltext | null): FetchOutcome {
  if (!cached || cached.status !== "ok") {
    throw new Error("the kept copy of this article is no longer in the text cache");
  }
  return {
    source: "url",
    arxivId: null,
    abstract: paper.abstract ?? "",
    pdfBytes: null,
    fulltext: cached,
    kind: "article",
    title: paper.title,
  };
}

export class PrepPipeline extends ObservableRun<PrepState | null, PrepActivity> {
  private currentChapter = 1;
  // Sources whose fetch stage is already over: their text was captured
  // elsewhere and handed to ingestCaptured, so runOne uses it in place of a
  // fetch. Entries are kept rather than consumed, so a requeue after a failed
  // digest is served from the copy at hand too; the map lives and dies with the
  // pipeline instance, and a run resumed in a later session reads the text back
  // out of the fulltext cache instead (prep/live.ts, PrepPaper.captured).
  private readonly captured = new Map<string, FetchOutcome>();

  constructor(
    private readonly surveyHash: string,
    private readonly surveyName: string,
    private readonly deps: PipelineDeps,
    config: Partial<PipelineConfig> = {},
  ) {
    super(null, deps, config);
  }

  protected copyState(state: PrepState | null): PrepState | null {
    return state ? { ...state, papers: state.papers.map((p) => ({ ...p })) } : null;
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
    let paper: PrepPaper;
    try {
      paper = this.deps.resolveAddition(query, taken);
    } catch (e) {
      // A malformed entry (e.g. a non-https URL) is a no-op rather than a crash.
      console.warn("could not add paper", e);
      return;
    }
    this.state.papers.push(paper);
    void this.persist();
    void this.run();
  }

  // Ingest a user-pasted URL (docs/09 link ingestion): resolve it to a queued
  // source, start processing, and resolve once the FETCH stage finishes — the
  // digest keeps running in the background — so the chat can read the new source
  // in the same turn. Rejects on a non-https URL. The resolved paper reflects
  // its post-fetch status (digesting on success, or failed/abstract-only).
  async ingestSource(url: string): Promise<PrepPaper> {
    await this.ensureLoaded();
    const taken = new Set(this.state!.papers.map((p) => p.slug));
    return this.queue(this.deps.resolveAddition(url, taken)); // throws on non-https
  }

  // Ingest a source whose text is already in hand — an article the reader kept on
  // the info side (docs/21). Same contract as ingestSource, minus the fetch:
  // `fetched` stands in for the fetch stage, so no request goes out and a page
  // that is behind a paywall now still arrives as the copy that was captured.
  // `mint` is given the slugs taken right now, so it can pick a free one.
  async ingestCaptured(
    mint: (taken: Set<string>) => PrepPaper,
    fetched: FetchOutcome,
  ): Promise<PrepPaper> {
    await this.ensureLoaded();
    const paper = mint(new Set(this.state!.papers.map((p) => p.slug)));
    this.captured.set(paper.slug, fetched);
    return this.queue(paper);
  }

  // Put a freshly minted paper on the list and resolve once it leaves the fetch
  // stage. State must already be loaded.
  private async queue(paper: PrepPaper): Promise<PrepPaper> {
    this.state!.papers.push(paper);
    await this.persist();
    const settled = this.awaitFetch(paper.slug);
    // An active run already picks this up (user papers jump the queue); when
    // idle, pump the papers loop without triggering a survey (re)plan.
    void this.pump();
    return settled;
  }

  // Resolve when a paper leaves the fetch stage: fetched (now digesting / done /
  // abstract-only) or failed / cooled down / skipped.
  private awaitFetch(slug: string): Promise<PrepPaper> {
    const settled = (p: PrepPaper | undefined): p is PrepPaper =>
      !!p && p.status !== "queued" && p.status !== "fetching";
    return new Promise<PrepPaper>((resolve) => {
      const current = this.state?.papers.find((p) => p.slug === slug);
      if (settled(current)) {
        resolve({ ...current });
        return;
      }
      const unsub = this.subscribe(() => {
        const p = this.state?.papers.find((x) => x.slug === slug);
        if (settled(p)) {
          unsub();
          resolve({ ...p });
        }
      });
    });
  }

  // Process queued papers if idle, without running the plan stage. Lets a pasted
  // link start fetching immediately, even before (or without) a survey plan.
  private async pump(): Promise<void> {
    if (this.running || !this.state) return;
    this.running = true;
    this.notify();
    try {
      await this.runPapers();
    } finally {
      this.running = false;
      this.notify();
    }
  }

  // Re-run a failed plan. No-op while running; loads state first if needed. The
  // idle run loop picks it up because planStatus is not "done".
  retryPlan(): void {
    if (this.running) return;
    void this.ensureStarted();
  }

  // Re-plan from scratch after a successful plan: reset the plan and let runPlan
  // rebuild it, folding the new nominations into the current papers (see
  // mergePlan). No-op while running.
  replan(): void {
    if (this.running || !this.state) return;
    this.state.planStatus = "pending";
    this.state.planError = undefined;
    this.notify();
    void this.ensureStarted();
  }

  // Idempotent entry point: loads (or creates) the state and runs the loop to
  // exhaustion. Callers that don't want to wait fire-and-forget it; a second
  // call while a run is active is a no-op.
  async ensureStarted(): Promise<void> {
    // Note: when the state is already loaded this must reach `this.run()` in the
    // same synchronous tick (no await before it) so callers see `running` flip
    // immediately after a fire-and-forget ensureStarted() — hence the inline
    // load rather than awaiting the shared ensureLoaded() helper here.
    if (!this.state) {
      const loaded = await this.deps.loadState(this.surveyHash);
      this.state = loaded
        ? normalizeOnLoad(loaded)
        : createPrepState(this.surveyHash, this.surveyName, this.deps.now());
      this.notify();
    }
    await this.run();
  }

  // Load (or create) the state once. Used by ingestSource, which does not need
  // the synchronous-run guarantee ensureStarted keeps.
  private async ensureLoaded(): Promise<void> {
    if (this.state) return;
    const loaded = await this.deps.loadState(this.surveyHash);
    this.state = loaded
      ? normalizeOnLoad(loaded)
      : createPrepState(this.surveyHash, this.surveyName, this.deps.now());
    this.notify();
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
      const plan = await this.callWithWatchdog({ kind: "plan" }, (opts) =>
        this.deps.buildPlan(opts),
      );
      s.chapters = plan.chapters;
      s.references = plan.references;
      s.papers = this.mergePlan(s.papers, plan.papers);
      s.planStatus = "done";
    } catch (e) {
      s.planStatus = "failed";
      s.planError = e instanceof Error ? e.message : String(e);
    }
    await this.persist();
  }

  // Fold a fresh plan's nominations into the existing paper list (a replan, or
  // the first plan against an empty list). User-added papers always survive. A
  // nominated paper whose slug reappears and was already finished keeps its
  // done/abstract-only status and cached fields so its note and PDF stay valid;
  // every other reappearing or brand-new nomination is (re)queued; nominated
  // papers that vanished from the plan are dropped (their note file is orphaned
  // on disk, which is acceptable).
  private mergePlan(existing: PrepPaper[], nominated: PrepPaper[]): PrepPaper[] {
    const added = existing.filter((p) => p.addedByUser);
    const prevBySlug = new Map(existing.filter((p) => !p.addedByUser).map((p) => [p.slug, p]));
    const merged = nominated.map((np) => {
      const prev = prevBySlug.get(np.slug);
      if (prev && (prev.status === "done" || prev.status === "abstract-only")) {
        return {
          ...np,
          status: prev.status,
          source: prev.source,
          abstract: prev.abstract,
          pages: prev.pages,
          arxivId: prev.arxivId ?? np.arxivId,
        };
      }
      return np;
    });
    return [...merged, ...added];
  }

  private async runPapers(): Promise<void> {
    const s = this.state!;
    // Before the plan is ready only user-added sources are eligible (a pasted
    // link ingests without waiting for the survey to be planned); nominated
    // papers wait for the plan. Once planned, everything is in play.
    const pool = () => (s.planStatus === "done" ? s.papers : s.papers.filter((p) => p.addedByUser));
    if (s.planStatus !== "done" && pool().length === 0) return;
    // One at a time, re-picking after each finish so chapter changes and
    // user additions reorder the remainder. When only rate-limited papers are
    // left, wait out the earliest cooldown and release the ones whose time has
    // come, rather than exiting the run.
    for (;;) {
      const paper = nextQueued(pool(), this.currentChapter, s.chapters.length);
      if (paper) {
        await this.runOne(paper);
        continue;
      }
      const next = earliestCooldown(pool());
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
      // A captured source has nothing to fetch: its text came from the reader's
      // own copy, and going to the network here would either fail on a paywall
      // or replace what they kept with what the page serves today.
      //
      // The flag is checked, not just the map: nominated slugs are minted by
      // parsePlan against the plan's own names only, so a replan can hand a
      // survey reference the slug an ingested article already has, and a lookup
      // by slug alone would digest the article's text under the reference's name.
      const captured = paper.captured ? this.captured.get(paper.slug) : undefined;
      fetched = captured ?? (await this.deps.fetchPaper(paper));
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
      paper.error = "not found on arXiv, OpenAlex, or Semantic Scholar";
      await this.persist();
      return;
    }
    paper.source = fetched.source;
    if (fetched.arxivId) paper.arxivId = fetched.arxivId;
    paper.abstract = fetched.abstract || paper.abstract;
    // Link ingestion: refine the provisional title/kind and set the page count
    // now (a pre-extracted full text carries it), so add_source can report the
    // source the moment the fetch stage finishes — before digestion.
    if (fetched.title) paper.title = fetched.title;
    if (fetched.kind) paper.kind = fetched.kind;
    if (fetched.fulltext) paper.pages = fetched.fulltext.pages.length;

    if (!fetched.pdfBytes && !fetched.fulltext) {
      await this.finishThin(paper);
      return;
    }

    paper.status = "digesting";
    await this.persist();
    try {
      const digest = await this.callWithWatchdog({ kind: "digest", slug: paper.slug }, (opts) =>
        this.deps.digestPaper(paper, fetched, opts),
      );
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
  // failing it. The ladder is the shared one (src/ai/limiter); after its rounds
  // are spent, give up with the 429 message so the paper reads as failed for a
  // real reason.
  private cooldown(paper: PrepPaper, message: string): void {
    const round = paper.fetchAttempts ?? 0;
    const wait = cooldownAfter(round);
    if (wait === null) {
      paper.status = "failed";
      paper.error = message;
      return;
    }
    paper.fetchAttempts = round + 1;
    paper.status = "cooldown";
    paper.retryAt = this.deps.now() + wait;
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
