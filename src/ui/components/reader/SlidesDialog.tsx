// Slides dialog (docs/14): pick the books (with notes) a talk draws on, give a
// free-text instruction, and generate a self-contained HTML deck. While a run is
// in flight it shows the same visual language as notes generation — stage, per
// slide progress, liveness seconds, Stop. Done runs list under "Generated decks"
// with Open (system browser) and the file path. Tailwind-only, no emoji.
//
// A centred Dialog (docs/30, fourth pass). NotesPanel still mounts and unmounts
// it, so `open` is constant and onOpenChange reports the closes Radix decides
// on: Escape, and a press outside the box.

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
} from "../../../reading/slides";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

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
          <Button type="button" variant="link" size="link" className="text-[11px] text-neutral-400 hover:text-neutral-600" onClick={onStop}>
            Stop
          </Button>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-neutral-400">
        {st.planStatus === "running" && (
          <>
            Planning the deck…{activity?.kind === "plan" && <> <LivenessHint activity={activity} /></>}
          </>
        )}
        {st.planStatus === "failed" && <span className="text-destructive">Plan failed: {st.planError}</span>}
        {st.planStatus === "done" && st.assembleStatus !== "done" && st.runStatus === "running" && (
          <>Writing {st.slides.length} slides…{activity?.kind === "assemble" && " assembling…"}</>
        )}
        {st.runStatus === "done" && <span className="text-green-700">Deck ready.</span>}
        {st.runStatus === "failed" && <span className="text-destructive">{st.runError}</span>}
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* The height clamp is overlay-safe's alone (docs/30): a second max-height
          at the same specificity would be settled by emit order. `w-[min(...)]`
          rather than a max width for the same reason. `border-0` and `p-0`
          because the box draws its own chrome; the flex column plus min-h-0 on
          the body is what keeps the header in place while the body scrolls, so
          the content's own overflow never has anything to do. */}
      <DialogContent
        aria-describedby={undefined}
        className="z-[80] flex w-[min(35rem,100%)] flex-col gap-0 rounded-xl border-0 p-0 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#eee] px-4 py-3">
          <DialogTitle className="text-[15px] font-semibold leading-normal text-[#1b1b1b]">
            Generate a talk deck
          </DialogTitle>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[#777]">Books to draw on</div>
            {books.length === 0 ? (
              <p className="m-0 text-[12px] text-neutral-400">No books have notes yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {books.map((b) => (
                  <Label key={b.bookId} className="text-[13px] text-neutral-700">
                    <Checkbox checked={selected.has(b.bookId)} onCheckedChange={() => toggle(b.bookId)} />
                    <span className="min-w-0 truncate">{b.title}</span>
                  </Label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[#777]">Talk instruction (optional)</div>
            <Textarea
              className="text-[13px]"
              placeholder="Theme, audience, angle… e.g. a 15-minute talk for engineers on the core argument."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={running || selected.size === 0}
              onClick={generate}
            >
              {running ? "Generating…" : "Generate"}
            </Button>
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
                    <Button type="button" variant="outline" onClick={() => open(t.file)}>
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {openError && <p className="m-0 mt-1 text-[11px] text-destructive">{openError}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
