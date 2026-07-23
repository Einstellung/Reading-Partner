// Prep progress panel (docs/09): the visible face of the lesson-prep pipeline.
// Lists the nominated papers with their statuses, expands a paper to show its
// note, lets the user skip/requeue a paper and append one by title or arXiv id.
// Plain and functional by design — visibility over polish. Tailwind-only.

import { useEffect, useState } from "react";
import type { PrepActivity, PrepSnapshot } from "../../prep/pipeline";
import type { PaperStatus, PrepPaper } from "../../prep/types";
import { CitationContext, Markdown } from "../common/Markdown";

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

// A live "47s · 1.2k chars" hint for an in-flight AI call. Seconds tick locally
// off the injected startedAt so they advance smoothly between snapshots; chars
// come from the snapshot. `withUnit` appends " chars" (header) vs. bare (row).
function LivenessHint({ activity, withUnit }: { activity: PrepActivity; withUnit?: boolean }) {
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

const STATUS_STYLE: Record<PaperStatus, string> = {
  queued: "bg-neutral-100 text-neutral-500",
  fetching: "bg-amber-100 text-amber-700",
  digesting: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  "abstract-only": "bg-sky-100 text-sky-700",
  failed: "bg-red-100 text-red-700",
  cooldown: "bg-amber-50 text-amber-600",
  skipped: "bg-neutral-100 text-neutral-400",
};

const SMALL_BTN =
  "rounded border border-[#dcdcdc] bg-white px-1.5 py-0.5 text-[11px] leading-none text-neutral-500 cursor-pointer hover:bg-[#f0f0f0]";

interface PrepPanelProps {
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
    <li className="border-b border-[#eee] px-3 py-2">
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
            <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${STATUS_STYLE[paper.status]}`}>
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
        <div className="mt-1 text-[11px] text-red-600/90">{paper.error}</div>
      )}
      {paper.status === "cooldown" && (
        <div className="mt-1 text-[11px] text-amber-600/90">rate-limited, retrying later</div>
      )}
      <div className="mt-1 flex gap-1.5">
        {active && (
          <button type="button" className={SMALL_BTN} onClick={onSkip}>
            Skip
          </button>
        )}
        {(paper.status === "skipped" || paper.status === "failed" || paper.status === "cooldown") && (
          <button type="button" className={SMALL_BTN} onClick={onRequeue}>
            Retry
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 rounded-md bg-[#fafafa] p-2 text-[12px] text-neutral-700">
          {hasNote ? (
            note === null ? (
              <span className="text-neutral-400">Loading note…</span>
            ) : (
              // A note's [p.N] anchors point into the paper, not the survey;
              // suppress citation links here so they don't jump the reader.
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

export default function PrepPanel({
  snapshot,
  loadNote,
  onSkip,
  onRequeue,
  onAdd,
  onStartPrep,
  onRetryPlan,
  onReplan,
  selectedSlug,
}: PrepPanelProps) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [addText, setAddText] = useState("");

  // A citation click selects a paper from outside; open its note.
  useEffect(() => {
    if (selectedSlug) setExpandedSlug(selectedSlug);
  }, [selectedSlug]);

  const state = snapshot?.state ?? null;

  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="m-0 text-sm text-neutral-500">
          No lesson prep for this book yet. Start it here or with the Classroom button in a chat.
        </p>
        <button
          type="button"
          className="rounded-md border border-[#c9c2e8] bg-[#efecfb] px-3 py-1.5 text-sm text-[#4a3a9e] cursor-pointer hover:bg-[#e7e3f7]"
          onClick={onStartPrep}
        >
          Start prep
        </button>
      </div>
    );
  }

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
      <div className="border-b border-[#eee] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] text-[#1b1b1b]">Lesson prep</div>
          {state.planStatus === "done" && (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-neutral-400 hover:text-neutral-600 disabled:cursor-default disabled:opacity-50"
              onClick={onReplan}
              disabled={running}
            >
              Replan
            </button>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-neutral-400">
          {state.planStatus === "running" && (
            <>
              Reading the survey's references…
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
              <span className="text-red-600/90">Plan failed: {state.planError}</span>
              <button
                type="button"
                className={SMALL_BTN}
                onClick={onRetryPlan}
                disabled={running}
              >
                Retry
              </button>
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

      <div className="border-t border-[#eee] p-2">
        <div className="flex gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-md border border-[#dcdcdc] px-2 py-1.5 text-[12px] [font:inherit]"
            placeholder="Add paper (title, arXiv id, or URL)"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          />
          <button type="button" className={SMALL_BTN} onClick={submitAdd}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
