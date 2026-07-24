// Notes panel (docs/14): the visible face of the book-notes pipeline. Empty
// state offers "Generate notes"; running shows the chapter list with live
// progress; done renders the whole-book framework then each chapter's note.
// Citations are live here (unlike the prep panel): [p.N] jumps the reader and
// [fig:N] renders an inline figure card via the ambient Citation/Figure context.
// Plain and functional by design. Tailwind-only.

import { useEffect, useMemo, useState } from "react";
import type { NotesActivity, NotesSnapshot } from "../../notes";
import type { ChapterStatus, NoteChapter } from "../../notes";
import { Markdown } from "../common/Markdown";
import SlidesDialog from "./SlidesDialog";

function compactChars(chars: number): string {
  return chars < 1000 ? String(chars) : `${(chars / 1000).toFixed(1)}k`;
}

// A live "47s · 1.2k chars" hint for an in-flight AI call, seconds ticking
// locally off startedAt so they advance between snapshots.
function LivenessHint({ activity, withUnit }: { activity: NotesActivity; withUnit?: boolean }) {
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

const STATUS_STYLE: Record<ChapterStatus, string> = {
  pending: "bg-neutral-100 text-neutral-500",
  running: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-neutral-100 text-neutral-400",
};

const SMALL_BTN =
  "rounded border border-[#dcdcdc] bg-white px-1.5 py-0.5 text-[11px] leading-none text-neutral-500 cursor-pointer hover:bg-[#f0f0f0] coarse:px-2.5 coarse:py-2";

interface NotesPanelProps {
  snapshot: NotesSnapshot | null;
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

function ChapterSection({
  chapter,
  body,
  activity,
  disabled,
  onRetry,
  onRegenerate,
  onGenerate,
}: {
  chapter: NoteChapter;
  body: string | null;
  activity: NotesActivity | null;
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
    <div className="border-b border-[#eee] px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#1b1b1b]">
            {chapter.index}. {chapter.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${STATUS_STYLE[chapter.status]}`}>
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
          <button type="button" className={SMALL_BTN} onClick={() => setSteering((v) => !v)}>
            Regenerate
          </button>
        )}
        {chapter.status === "failed" && !disabled && (
          <button type="button" className={SMALL_BTN} onClick={onRetry}>
            Retry
          </button>
        )}
        {chapter.status === "skipped" && !disabled && (
          <button type="button" className={SMALL_BTN} onClick={onGenerate}>
            Generate
          </button>
        )}
      </div>

      {chapter.status === "skipped" && (
        <div className="mt-1 text-[11px] text-neutral-400">No marks — skipped</div>
      )}

      {steering && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-md border border-[#dcdcdc] px-2 py-1 text-[12px] [font:inherit]"
            placeholder="Optional: how to change it"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
          />
          <button type="button" className={SMALL_BTN} onClick={submit}>
            Go
          </button>
        </div>
      )}

      {chapter.status === "failed" && chapter.error && (
        <div className="mt-1 text-[11px] text-red-600/90">{chapter.error}</div>
      )}

      {chapter.status === "done" && (
        <div className="mt-2 text-[12px] text-neutral-700">
          {body === null ? <span className="text-neutral-400">Loading…</span> : <Markdown text={body} />}
        </div>
      )}
    </div>
  );
}

export default function NotesPanel({
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
}: NotesPanelProps) {
  const state = snapshot?.state ?? null;
  const running = snapshot?.running ?? false;
  const activity = snapshot?.activity ?? null;
  const planActivity = activity?.kind === "plan" ? activity : null;
  const overviewActivity = activity?.kind === "overview" ? activity : null;

  const [overview, setOverview] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Map<number, string | null>>(new Map());
  const [showSlides, setShowSlides] = useState(false);

  // A signature of what is on disk, so a regenerate (status flips through
  // running back to done) reloads the affected note and the overview.
  const signature = useMemo(() => {
    if (!state) return "";
    const chs = state.chapters.map((c) => `${c.index}:${c.status}`).join(",");
    return `${state.overviewStatus}|${chs}`;
  }, [state]);

  useEffect(() => {
    if (!state) {
      setOverview(null);
      setBodies(new Map());
      return;
    }
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

  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="m-0 text-sm text-neutral-500">
          No notes for this book yet. Generate lecture notes, one section per chapter.
        </p>
        <button
          type="button"
          className="rounded-md border border-[#c9c2e8] bg-[#efecfb] px-3 py-1.5 text-sm text-[#4a3a9e] cursor-pointer hover:bg-[#e7e3f7] coarse:py-2.5"
          onClick={onGenerate}
        >
          Generate notes
        </button>
      </div>
    );
  }

  const doneCount = state.chapters.filter((c) => c.status === "done").length;

  return (
    <div className="flex h-full flex-col">
      {showSlides && (
        <SlidesDialog currentBookId={state.bookId} onClose={() => setShowSlides(false)} />
      )}
      <div className="border-b border-[#eee] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-[13px] text-[#1b1b1b]">Notes</div>
            {doneCount > 0 && (
              <button
                type="button"
                className="rounded border border-[#c9c2e8] bg-[#efecfb] px-1.5 py-0.5 text-[11px] leading-none text-[#4a3a9e] cursor-pointer hover:bg-[#e7e3f7] coarse:px-2.5 coarse:py-2"
                onClick={() => setShowSlides(true)}
              >
                Slides
              </button>
            )}
          </div>
          {running ? (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-neutral-400 hover:text-neutral-600 coarse:px-2 coarse:py-1.5"
              onClick={onStop}
            >
              Stop
            </button>
          ) : (
            state.planStatus === "done" && (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-neutral-400 hover:text-neutral-600 coarse:px-2 coarse:py-1.5"
                onClick={onGenerate}
              >
                Resume
              </button>
            )
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-neutral-400">
          {state.planStatus === "running" && (
            <>
              Reading the book's structure…
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
              <button type="button" className={SMALL_BTN} onClick={onRetryPlan} disabled={running}>
                Retry
              </button>
            </span>
          )}
          {state.planStatus === "done" && `${doneCount} of ${state.chapters.length} chapters ready`}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(state.overviewStatus === "done" || state.overviewStatus === "stale") && (
          <div className="border-b border-[#eee] bg-[#fafafa] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-[#1b1b1b]">Whole-book framework</div>
              {state.overviewStatus === "stale" && !running && (
                <button type="button" className={SMALL_BTN} onClick={onRegenerateOverview}>
                  Regenerate
                </button>
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
          <div className="border-b border-[#eee] px-3 py-2 text-[11px] text-neutral-400">
            Writing the whole-book framework…
            {overviewActivity && (
              <>
                {" "}
                <LivenessHint activity={overviewActivity} withUnit />
              </>
            )}
          </div>
        )}
        {state.overviewStatus === "failed" && (
          <div className="border-b border-[#eee] px-3 py-2 text-[11px]">
            <span className="text-red-600/90">Framework failed: {state.overviewError}</span>{" "}
            <button type="button" className={SMALL_BTN} onClick={onRegenerateOverview} disabled={running}>
              Retry
            </button>
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
