// Notes panel (docs/14): the visible face of the book-notes pipeline. Empty
// state offers "Generate notes"; running shows the chapter list with live
// progress; done renders the whole-book framework then each chapter's note.
// Citations are live here (unlike the prep panel): [p.N] jumps the reader and
// [fig:N] renders an inline figure card via the ambient Citation/Figure context.
// Plain and functional by design. Tailwind-only.

import { useEffect, useMemo, useState } from "react";
import type { NotesActivity, NotesSnapshot } from "../../../reading/prep/chapters";
import type { ChapterStatus, NoteChapter } from "../../../reading/prep/chapters";
import { Markdown } from "../markdown/Markdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={() => setSteering((v) => !v)}>
            Regenerate
          </Button>
        )}
        {chapter.status === "failed" && !disabled && (
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onRetry}>
            Retry
          </Button>
        )}
        {chapter.status === "skipped" && !disabled && (
          <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={onGenerate}>
            Generate
          </Button>
        )}
      </div>

      {chapter.status === "skipped" && (
        <div className="mt-1 text-[11px] text-neutral-400">No marks — skipped</div>
      )}

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
        <Button
          type="button"
          variant="secondary"
          // leading-5 puts back what text-sm carries on its own; the size adds
          // leading-none, which this button never had.
          className="leading-5 coarse:py-2.5"
          onClick={onGenerate}
        >
          Generate notes
        </Button>
      </div>
    );
  }

  const doneCount = state.chapters.filter((c) => c.status === "done").length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#eee] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* No Slides button: a deck is a talk's product now and is generated
                from inside the talk (docs/31, ui/components/talk/DeckDialog). */}
            <div className="text-[13px] text-[#1b1b1b]">Notes</div>
          </div>
          {running ? (
            <Button
              type="button"
              variant="link"
              size="link"
              className="text-[11px] text-neutral-400 hover:text-neutral-600 coarse:py-0"
              onClick={onStop}
            >
              Stop
            </Button>
          ) : (
            state.planStatus === "done" && (
              <Button
                type="button"
                variant="link"
                size="link"
                className="text-[11px] text-neutral-400 hover:text-neutral-600 coarse:py-0"
                onClick={onGenerate}
              >
                Resume
              </Button>
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
          <div className="border-b border-[#eee] bg-[#fafafa] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-[#1b1b1b]">Whole-book framework</div>
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
            <span className="text-destructive">Framework failed: {state.overviewError}</span>{" "}
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
