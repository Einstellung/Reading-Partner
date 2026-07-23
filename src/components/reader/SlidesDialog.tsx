// Slides dialog (docs/14): pick the books (with notes) a talk draws on, give a
// free-text instruction, and generate a self-contained HTML deck. While a run is
// in flight it shows the same visual language as notes generation — stage, per
// slide progress, liveness seconds, Stop. Done runs list under "Generated decks"
// with Open (system browser) and the file path. Tailwind-only, no emoji.

import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  getCurrentTalk,
  listBooksWithNotes,
  listTalks,
  startTalk,
  type BookWithNotes,
  type SlideRun,
  type SlidesActivity,
  type SlidesPipeline,
  type SlidesSnapshot,
  type TalkEntry,
} from "../../slides";

function LivenessHint({ activity }: { activity: SlidesActivity }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
  const retry = activity.attempt > 1 ? ` · retrying (${activity.attempt}/${activity.attempts})` : "";
  return (
    <>
      {secs}s{activity.chars > 0 ? ` · ${activity.chars} chars` : ""}
      {retry}
    </>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-500",
  running: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

const BTN =
  "rounded-md border border-[#dcdcdc] bg-white px-3 py-1.5 text-sm cursor-pointer enabled:hover:bg-[#f0f0f0] disabled:opacity-40 disabled:cursor-default";
const BTN_PRIMARY =
  "rounded-md bg-[#6c4fd0] px-3 py-1.5 text-sm text-white cursor-pointer enabled:hover:bg-[#5a3fbf] disabled:opacity-40 disabled:cursor-default";

function SlideRow({ slide, activity }: { slide: SlideRun; activity: SlidesActivity | null }) {
  const mine = activity && (activity.kind === "content" || activity.kind === "assets") && activity.slide === slide.index;
  return (
    <div className="flex items-center gap-2 py-1 text-[12px]">
      <span className="w-5 shrink-0 text-right text-neutral-400">{slide.index}</span>
      <span className="min-w-0 flex-1 truncate text-neutral-700">{slide.title}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${STATUS_STYLE[slide.contentStatus]}`}>
        {slide.contentStatus}
      </span>
      {slide.assetStatus && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${STATUS_STYLE[slide.assetStatus]}`}>
          {slide.figure ? "figure" : "image"}
        </span>
      )}
      {mine && (
        <span className="shrink-0 text-[11px] text-neutral-400">
          <LivenessHint activity={activity!} />
        </span>
      )}
    </div>
  );
}

function RunView({ snap, onStop }: { snap: SlidesSnapshot; onStop: () => void }) {
  const st = snap.state;
  if (!st) return null;
  const activity = snap.activity;
  const running = snap.running;
  return (
    <div className="rounded-lg border border-[#eee] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-[#1b1b1b]">{st.title}</div>
        {running && (
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-neutral-400 hover:text-neutral-600" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-neutral-400">
        {st.planStatus === "running" && (
          <>
            Planning the deck…{activity?.kind === "plan" && <> <LivenessHint activity={activity} /></>}
          </>
        )}
        {st.planStatus === "failed" && <span className="text-red-600/90">Plan failed: {st.planError}</span>}
        {st.planStatus === "done" && st.assembleStatus !== "done" && st.runStatus === "running" && (
          <>Writing {st.slides.length} slides…{activity?.kind === "assemble" && " assembling…"}</>
        )}
        {st.runStatus === "done" && <span className="text-green-700">Deck ready.</span>}
        {st.runStatus === "failed" && <span className="text-red-600/90">{st.runError}</span>}
        {st.runStatus === "stopped" && "Stopped."}
      </div>

      {st.slides.length > 0 && (
        <div className="mt-2 max-h-56 overflow-y-auto border-t border-[#f0f0f0] pt-1">
          {st.slides.map((s) => (
            <SlideRow key={s.index} slide={s} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SlidesDialog({
  currentBookId,
  onClose,
}: {
  currentBookId: string;
  onClose: () => void;
}) {
  const [books, setBooks] = useState<BookWithNotes[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set([currentBookId]));
  const [instruction, setInstruction] = useState("");
  const [talks, setTalks] = useState<TalkEntry[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);

  const [pipeline, setPipeline] = useState<SlidesPipeline | null>(() => getCurrentTalk());
  const [snap, setSnap] = useState<SlidesSnapshot | null>(() => getCurrentTalk()?.snapshot() ?? null);

  useEffect(() => {
    listBooksWithNotes().then(setBooks);
    listTalks().then(setTalks);
  }, []);

  useEffect(() => {
    if (!pipeline) {
      setSnap(null);
      return;
    }
    setSnap(pipeline.snapshot());
    return pipeline.subscribe(() => setSnap(pipeline.snapshot()));
  }, [pipeline]);

  // Refresh the deck list when a run completes.
  const runStatus = snap?.state?.runStatus;
  useEffect(() => {
    if (runStatus === "done") listTalks().then(setTalks);
  }, [runStatus]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const running = snap?.running ?? false;

  const generate = () => {
    const ids = books.map((b) => b.bookId).filter((id) => selected.has(id));
    if (ids.length === 0 || running) return;
    setPipeline(startTalk(ids, instruction.trim()));
  };

  const open = async (file: string) => {
    setOpenError(null);
    try {
      await openPath(await join(await appDataDir(), file));
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : "Could not open the deck");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#eee] px-4 py-3">
          <div className="text-[15px] font-semibold text-[#1b1b1b]">Generate a talk deck</div>
          <button type="button" className={BTN} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[#777]">Books to draw on</div>
            {books.length === 0 ? (
              <p className="m-0 text-[12px] text-neutral-400">No books have notes yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {books.map((b) => (
                  <label key={b.bookId} className="flex items-center gap-2 text-[13px] text-neutral-700">
                    <input type="checkbox" checked={selected.has(b.bookId)} onChange={() => toggle(b.bookId)} />
                    <span className="min-w-0 truncate">{b.title}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[#777]">Talk instruction (optional)</div>
            <textarea
              className="min-h-16 w-full rounded-md border border-[#dcdcdc] px-2.5 py-2 text-[13px] [font:inherit]"
              placeholder="Theme, audience, angle… e.g. a 15-minute talk for engineers on the core argument."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={running || selected.size === 0}
              onClick={generate}
            >
              {running ? "Generating…" : "Generate"}
            </button>
            <span className="text-[11px] text-neutral-400">
              Without an illustration key (Settings), decks generate without AI images.
            </span>
          </div>

          {snap?.state && <RunView snap={snap} onStop={() => pipeline?.stop()} />}

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[#777]">Generated decks</div>
            {talks.length === 0 ? (
              <p className="m-0 text-[12px] text-neutral-400">None yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {talks.map((t) => (
                  <div key={t.file} className="flex items-center justify-between gap-2 rounded-md border border-[#eee] px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-neutral-700">{t.title}</div>
                      <div className="truncate text-[11px] text-neutral-400">{t.file}</div>
                    </div>
                    <button type="button" className={BTN} onClick={() => open(t.file)}>
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
            {openError && <p className="m-0 mt-1 text-[11px] text-red-600/90">{openError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
