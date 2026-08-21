// The Prep panel (docs/09): the visible face of whichever preparation this
// document is getting. One panel, because a document gets one kind of material —
// a paper's prep follows its citations out to the works it leans on, a book's
// works inward chapter by chapter, and which one it is was decided before
// anything ran (reading/prep/kind.ts).
//
// Both halves answer the same three questions and are laid out the same way: a
// header saying what stage the run is at, a list of what is being prepared with
// a status and a live counter on each row, and a way back for anything that
// failed. The differences are what a row is (a paper, a chapter) and what can be
// done to it.
//
// Citations are live in the chapter half — [p.N] jumps the reader and [fig:N]
// renders a figure card through the ambient context — and suppressed in the
// paper half, where a note's [p.N] means a page of that paper and jumping the
// reader on it would land somewhere arbitrary.
//
// Plain and functional by design — visibility over polish. Tailwind-only.

import { useEffect, useMemo, useState } from "react";
import type { PrepKind } from "../../../reading/prep";
import type {
  ChapterSpineActivity,
  ChapterSpineSnapshot,
  SpineChapter,
} from "../../../reading/prep/chapters";
import type {
  PaperStatus,
  PrepActivity,
  PrepPaper,
  PrepSnapshot,
} from "../../../reading/prep/papers";
import { CitationContext, Markdown } from "../markdown/Markdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// "1234" -> "1.2k", "812" -> "812". Keeps the liveness line compact.
function compactChars(chars: number): string {
  return chars < 1000 ? String(chars) : `${(chars / 1000).toFixed(1)}k`;
}

// Hostname of a user-pasted source URL, shown as a small provenance hint.
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// What both pipelines publish about a call that is in flight. Taken structurally
// rather than as either pipeline's Activity type: the hint shows the four fields
// and has no business knowing which run they came from.
interface Liveness {
  startedAt: number;
  chars: number;
  attempt: number;
  attempts: number;
}

// A live "47s · 1.2k chars" hint. Seconds tick locally off the injected
// startedAt so they advance smoothly between snapshots; chars come from the
// snapshot. `withUnit` appends " chars" (header) vs. bare (row).
function LivenessHint({ activity, withUnit }: { activity: Liveness; withUnit?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
  const chars = `${compactChars(activity.chars)}${withUnit ? " chars" : ""}`;
  const retry = activity.attempt > 1 ? ` · retrying (${activity.attempt}/${activity.attempts})` : "";
  return (
    <>
      {secs}s · {chars}
      {retry}
    </>
  );
}

const STATUS_PILL = "rounded px-1.5 py-0.5 text-[10px] leading-none";
const SECTION = "border-b border-border-subtle px-3 py-3";
const HEADER = "border-b border-border-subtle px-3 py-2";
const HEADER_LINK =
  "text-[11px] text-neutral-400 hover:text-neutral-600 disabled:opacity-50 coarse:py-0";

const PAPER_STATUS_STYLE: Record<PaperStatus, string> = {
  queued: "bg-muted-soft text-neutral-500",
  fetching: "bg-amber-100 text-amber-700",
  digesting: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  "abstract-only": "bg-sky-100 text-sky-700",
  failed: "bg-red-100 text-red-700",
  cooldown: "bg-amber-50 text-amber-600",
  skipped: "bg-muted-soft text-neutral-400",
};

const CHAPTER_STATUS_STYLE: Record<SpineChapter["status"], string> = {
  pending: "bg-muted-soft text-neutral-500",
  running: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

// The paper half's controls and state, exactly as reading/prep/papers/use-prep
// hands them over.
export interface PaperPrepBindings {
  snapshot: PrepSnapshot | null;
  // Load a paper's note body (frontmatter already stripped); null = none yet.
  loadNote(slug: string): Promise<string | null>;
  onSkip(slug: string): void;
  onRequeue(slug: string): void;
  onAdd(query: string): void;
  onStartPrep(): void;
  onRetryPlan(): void;
  onReplan(): void;
  // Externally selected paper (a clicked [paper-slug p.N] citation).
  selectedSlug?: string | null;
}

// The chapter half's, from reading/prep/chapters/use-chapter-spine.
export interface ChapterPrepBindings {
  snapshot: ChapterSpineSnapshot | null;
  loadOverview(): Promise<string | null>;
  loadChapter(index: number): Promise<string | null>;
  onGenerate(): void;
  onStop(): void;
  onRetryPlan(): void;
  onRetryChapter(index: number): void;
  onRegenerateChapter(index: number, instruction?: string): void;
  onGenerateChapter(index: number): void;
  onRegenerateOverview(): void;
}

interface PrepPanelProps {
  // Which half to show, decided by what is on disk and then by the citation
  // density (reading/prep/kind.ts). The shell works it out; the panel obeys it,
  // including for the empty state, so the button starts the run this document
  // is actually going to get.
  kind: PrepKind;
  papers: PaperPrepBindings;
  chapters: ChapterPrepBindings;
}

// --- the paper half --------------------------------------------------------

function PaperRow({
  paper,
  expanded,
  onToggle,
  onSkip,
  onRequeue,
  loadNote,
  digestActivity,
}: {
  paper: PrepPaper;
  expanded: boolean;
  onToggle(): void;
  onSkip(): void;
  onRequeue(): void;
  loadNote(slug: string): Promise<string | null>;
  // This paper's in-flight digest, when it is the one being digested.
  digestActivity: PrepActivity | null;
}) {
  const [note, setNote] = useState<string | null>(null);
  const hasNote = paper.status === "done" || paper.status === "abstract-only";

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setNote(null);
    loadNote(paper.slug).then((n) => {
      if (!cancelled) setNote(n);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, paper.slug, paper.status, loadNote]);

  const active = paper.status === "queued" || paper.status === "fetching" || paper.status === "digesting";

  return (
    <li className="border-b border-border-subtle px-3 py-2">
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-2 border-0 bg-transparent p-0 text-left"
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-[#1b1b1b]" title={paper.title}>
            {paper.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={`${STATUS_PILL} ${PAPER_STATUS_STYLE[paper.status]}`}>
              {paper.status}
            </span>
            {paper.year && <span className="text-[11px] text-neutral-400">{paper.year}</span>}
            {paper.arxivId && <span className="text-[11px] text-neutral-400">arXiv:{paper.arxivId}</span>}
            {paper.sourceUrl && (
              <span className="text-[11px] text-neutral-400" title={paper.sourceUrl}>
                {sourceHost(paper.sourceUrl)}
              </span>
            )}
            {digestActivity && (
              <span className="text-[11px] text-neutral-400">
                <LivenessHint activity={digestActivity} />
              </span>
            )}
          </span>
        </span>
      </button>
      {paper.status === "failed" && paper.error && (
        <div className="mt-1 text-[11px] text-destructive">{paper.error}</div>
      )}
      {paper.status === "cooldown" && (
        <div className="mt-1 text-[11px] text-amber-600/90">rate-limited, retrying later</div>
      )}
      <div className="mt-1 flex gap-1.5">
        {active && (
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onSkip}>
            Skip
          </Button>
        )}
        {(paper.status === "skipped" || paper.status === "failed" || paper.status === "cooldown") && (
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onRequeue}>
            Retry
          </Button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 rounded-md bg-muted-faint p-2 text-[12px] text-neutral-700">
          {hasNote ? (
            note === null ? (
              <span className="text-neutral-400">Loading note…</span>
            ) : (
              // A note's [p.N] anchors point into the paper, not the document
              // the reader has open; suppress citation links here so they don't
              // jump the reader.
              <CitationContext.Provider value={null}>
                <Markdown text={note} />
              </CitationContext.Provider>
            )
          ) : (
            <span className="text-neutral-400">No note yet — the paper hasn't been digested.</span>
          )}
        </div>
      )}
    </li>
  );
}

function PaperPrep({ papers }: { papers: PaperPrepBindings }) {
  const { snapshot, loadNote, onSkip, onRequeue, onAdd, onRetryPlan, onReplan, selectedSlug } = papers;
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [addText, setAddText] = useState("");

  // A citation click selects a paper from outside; open its note.
  useEffect(() => {
    if (selectedSlug) setExpandedSlug(selectedSlug);
  }, [selectedSlug]);

  const state = snapshot!.state!;
  const doneCount = state.papers.filter((p) => p.status === "done" || p.status === "abstract-only").length;
  const running = snapshot?.running ?? false;
  const activity = snapshot?.activity ?? null;
  const planActivity = activity?.kind === "plan" ? activity : null;

  const submitAdd = () => {
    const q = addText.trim();
    if (!q) return;
    onAdd(q);
    setAddText("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className={HEADER}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] text-[#1b1b1b]">Referenced papers</div>
          {state.planStatus === "done" && (
            <Button
              type="button"
              variant="link"
              size="link"
              className={HEADER_LINK}
              onClick={onReplan}
              disabled={running}
            >
              Replan
            </Button>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-neutral-400">
          {state.planStatus === "running" && (
            <>
              Reading this document's references…
              {planActivity && (
                <>
                  {" "}
                  <LivenessHint activity={planActivity} withUnit />
                </>
              )}
            </>
          )}
          {state.planStatus === "pending" && "Waiting to plan…"}
          {state.planStatus === "failed" && (
            <span className="flex items-center gap-1.5">
              <span className="text-destructive">Plan failed: {state.planError}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="text-neutral-500"
                onClick={onRetryPlan}
                disabled={running}
              >
                Retry
              </Button>
            </span>
          )}
          {state.planStatus === "done" && `${doneCount} of ${state.papers.length} papers ready`}
        </div>
      </div>

      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {state.papers.map((p) => (
          <PaperRow
            key={p.slug}
            paper={p}
            expanded={expandedSlug === p.slug}
            onToggle={() => setExpandedSlug((cur) => (cur === p.slug ? null : p.slug))}
            onSkip={() => onSkip(p.slug)}
            onRequeue={() => onRequeue(p.slug)}
            loadNote={loadNote}
            digestActivity={activity?.kind === "digest" && activity.slug === p.slug ? activity : null}
          />
        ))}
        {state.planStatus === "done" && state.papers.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-neutral-400">No papers nominated.</li>
        )}
      </ul>

      <div className="border-t border-border-subtle p-2">
        <div className="flex gap-1.5">
          <Input
            className="px-2 py-1.5 text-[12px]"
            placeholder="Add paper (title, arXiv id, or URL)"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          />
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={submitAdd}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- the chapter half ------------------------------------------------------

function ChapterSection({
  chapter,
  body,
  activity,
  disabled,
  onRetry,
  onRegenerate,
  onGenerate,
}: {
  chapter: SpineChapter;
  body: string | null;
  activity: ChapterSpineActivity | null;
  // Controls (Regenerate) are inert while any run is in flight.
  disabled: boolean;
  onRetry(): void;
  onRegenerate(instruction?: string): void;
  onGenerate(): void;
}) {
  const [steering, setSteering] = useState(false);
  const [instruction, setInstruction] = useState("");

  const submit = () => {
    onRegenerate(instruction.trim() || undefined);
    setSteering(false);
    setInstruction("");
  };

  return (
    <div className={SECTION}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#1b1b1b]">
            {chapter.index}. {chapter.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={`${STATUS_PILL} ${CHAPTER_STATUS_STYLE[chapter.status]}`}>
              {chapter.status}
            </span>
            <span className="text-[11px] text-neutral-400">
              pp.{chapter.startPage}–{chapter.endPage}
            </span>
            {activity && (
              <span className="text-[11px] text-neutral-400">
                <LivenessHint activity={activity} />
              </span>
            )}
          </div>
        </div>
        {chapter.status === "done" && !disabled && (
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={() => setSteering((v) => !v)}>
            Regenerate
          </Button>
        )}
        {chapter.status === "failed" && !disabled && (
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onRetry}>
            Retry
          </Button>
        )}
        {/* A chapter left pending by a Stop: the way back without re-running the
            whole book. */}
        {chapter.status === "pending" && !disabled && (
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onGenerate}>
            Prepare
          </Button>
        )}
      </div>

      {steering && (
        <div className="mt-1.5 flex gap-1.5">
          <Input
            className="px-2 py-1 text-[12px]"
            placeholder="Optional: how to change it"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
          />
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={submit}>
            Go
          </Button>
        </div>
      )}

      {chapter.status === "failed" && chapter.error && (
        <div className="mt-1 text-[11px] text-destructive">{chapter.error}</div>
      )}

      {chapter.status === "done" && (
        <div className="mt-2 text-[12px] text-neutral-700">
          {body === null ? <span className="text-neutral-400">Loading…</span> : <Markdown text={body} />}
        </div>
      )}
    </div>
  );
}

function ChapterPrep({ chapters }: { chapters: ChapterPrepBindings }) {
  const {
    snapshot,
    loadOverview,
    loadChapter,
    onGenerate,
    onStop,
    onRetryPlan,
    onRetryChapter,
    onRegenerateChapter,
    onGenerateChapter,
    onRegenerateOverview,
  } = chapters;
  const state = snapshot!.state!;
  const running = snapshot?.running ?? false;
  const activity = snapshot?.activity ?? null;
  const planActivity = activity?.kind === "plan" ? activity : null;
  const overviewActivity = activity?.kind === "overview" ? activity : null;

  const [overview, setOverview] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Map<number, string | null>>(new Map());

  // A signature of what is on disk, so a regenerate (status flips through
  // running back to done) reloads the affected spine and the graph.
  const signature = useMemo(() => {
    const chs = state.chapters.map((c) => `${c.index}:${c.status}`).join(",");
    return `${state.overviewStatus}|${chs}`;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    if (state.overviewStatus === "done" || state.overviewStatus === "stale") {
      loadOverview().then((t) => !cancelled && setOverview(t));
    } else {
      setOverview(null);
    }
    const doneChapters = state.chapters.filter((c) => c.status === "done");
    Promise.all(
      doneChapters.map(async (c) => [c.index, await loadChapter(c.index)] as const),
    ).then((pairs) => {
      if (!cancelled) setBodies(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [signature, state, loadOverview, loadChapter]);

  const doneCount = state.chapters.filter((c) => c.status === "done").length;

  return (
    <div className="flex h-full flex-col">
      <div className={HEADER}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] text-[#1b1b1b]">Chapter spines</div>
          {running ? (
            <Button type="button" variant="link" size="link" className={HEADER_LINK} onClick={onStop}>
              Stop
            </Button>
          ) : (
            state.planStatus === "done" && (
              <Button type="button" variant="link" size="link" className={HEADER_LINK} onClick={onGenerate}>
                Resume
              </Button>
            )
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-neutral-400">
          {state.planStatus === "running" && (
            <>
              Reading this book's structure…
              {planActivity && (
                <>
                  {" "}
                  <LivenessHint activity={planActivity} withUnit />
                </>
              )}
            </>
          )}
          {state.planStatus === "pending" && "Waiting to plan…"}
          {state.planStatus === "failed" && (
            <span className="flex items-center gap-1.5">
              <span className="text-destructive">Plan failed: {state.planError}</span>
              <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onRetryPlan} disabled={running}>
                Retry
              </Button>
            </span>
          )}
          {state.planStatus === "done" && `${doneCount} of ${state.chapters.length} chapters ready`}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(state.overviewStatus === "done" || state.overviewStatus === "stale") && (
          <div className={`${SECTION} bg-muted-faint`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-[#1b1b1b]">Chapter graph</div>
              {state.overviewStatus === "stale" && !running && (
                <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onRegenerateOverview}>
                  Regenerate
                </Button>
              )}
            </div>
            {state.overviewStatus === "stale" && (
              <div className="mt-1 text-[11px] text-amber-600/90">
                A chapter changed; this may be out of date.
              </div>
            )}
            <div className="mt-2 text-[12px] text-neutral-700">
              {overview === null ? (
                <span className="text-neutral-400">Loading…</span>
              ) : (
                <Markdown text={overview} />
              )}
            </div>
          </div>
        )}
        {state.overviewStatus === "running" && (
          <div className="border-b border-border-subtle px-3 py-2 text-[11px] text-neutral-400">
            Connecting the chapters…
            {overviewActivity && (
              <>
                {" "}
                <LivenessHint activity={overviewActivity} withUnit />
              </>
            )}
          </div>
        )}
        {state.overviewStatus === "failed" && (
          <div className="border-b border-border-subtle px-3 py-2 text-[11px]">
            <span className="text-destructive">Chapter graph failed: {state.overviewError}</span>{" "}
            <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onRegenerateOverview} disabled={running}>
              Retry
            </Button>
          </div>
        )}

        {state.chapters.map((c) => (
          <ChapterSection
            key={c.index}
            chapter={c}
            body={bodies.get(c.index) ?? null}
            activity={activity?.kind === "chapter" && activity.chapter === c.index ? activity : null}
            disabled={running}
            onRetry={() => onRetryChapter(c.index)}
            onRegenerate={(instruction) => onRegenerateChapter(c.index, instruction)}
            onGenerate={() => onGenerateChapter(c.index)}
          />
        ))}
        {state.planStatus === "done" && state.chapters.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-neutral-400">No chapters found.</div>
        )}
      </div>
    </div>
  );
}

// --- the panel -------------------------------------------------------------

// Nothing prepped yet. The sentence says what this document is going to get, so
// the reader is not left guessing which of the two the button starts.
function StartPrep({ kind, onStart }: { kind: PrepKind; onStart(): void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="m-0 text-sm text-neutral-500">
        {kind === "papers"
          ? "Nothing prepped for this document yet. The AI will read the papers it leans on and write a note on each."
          : "Nothing prepped for this book yet. The AI will read it chapter by chapter and write down what each one does."}
      </p>
      <Button
        type="button"
        variant="secondary"
        // leading-5 puts back what text-sm carries on its own; the size adds
        // leading-none, which this button never had.
        className="leading-5 coarse:py-2.5"
        onClick={onStart}
      >
        Start prep
      </Button>
    </div>
  );
}

export default function PrepPanel({ kind, papers, chapters }: PrepPanelProps) {
  if (kind === "papers") {
    return papers.snapshot?.state ? (
      <PaperPrep papers={papers} />
    ) : (
      <StartPrep kind={kind} onStart={papers.onStartPrep} />
    );
  }
  return chapters.snapshot?.state ? (
    <ChapterPrep chapters={chapters} />
  ) : (
    <StartPrep kind={kind} onStart={chapters.onGenerate} />
  );
}
