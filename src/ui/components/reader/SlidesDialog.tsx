// Slides dialog (docs/14, docs/29): pick the books (with notes) a talk draws on,
// give a free-text instruction, and generate a self-contained HTML deck. While a
// run is in flight it shows the same visual language as notes generation —
// stage, per slide progress, liveness seconds, Stop. Done runs list under
// "Generated decks" with Open (system browser) and the file path.
//
// The talk's state is on disk now, so this dialog also drives the three
// re-runs: one slide's body (with an optional one-line steer, the same shape as
// the notes panel's per-chapter Regenerate), one slide's image, and the deck
// itself. Everything a slide had to settle for — a chapter that had no note, a
// figure that could not be cropped, a body that will not fit the stage — is
// printed on its row. Tailwind-only, no emoji.
//
// A centred Dialog (docs/30, fourth pass). NotesPanel still mounts and unmounts
// it, so `open` is constant and onOpenChange reports the closes Radix decides
// on: Escape, and a press outside the box.

import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  getCurrentTalk,
  hasPendingWork,
  hasUnrunSlides,
  listBooksWithNotes,
  listTalks,
  listTalkStates,
  openTalk,
  startTalk,
  type BookWithNotes,
  type SlideRun,
  type SlidesActivity,
  type SlidesPipeline,
  type SlidesSnapshot,
  type SlidesState,
  type TalkEntry,
} from "../../../reading/slides";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { OVERLAY_Z } from "../ui/overlay";
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
  // A slot that produced no image is not a success and must not look like one.
  missing: "bg-amber-100 text-amber-700",
  stale: "bg-amber-100 text-amber-700",
};

function SlideRow({
  slide,
  activity,
  disabled,
  onRegenerate,
  onRegenerateAsset,
}: {
  slide: SlideRun;
  activity: SlidesActivity | null;
  disabled: boolean;
  onRegenerate: (instruction: string) => void;
  onRegenerateAsset: () => void;
}) {
  const [steering, setSteering] = useState(false);
  const [instruction, setInstruction] = useState("");
  const mine =
    activity && (activity.kind === "content" || activity.kind === "assets") && activity.slide === slide.index;

  const submit = () => {
    setSteering(false);
    onRegenerate(instruction.trim());
    setInstruction("");
  };

  return (
    <div className="border-b border-[#f6f6f6] py-1 last:border-0">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="w-5 shrink-0 text-right text-neutral-400">{slide.index}</span>
        <span className="min-w-0 flex-1 truncate text-neutral-700">{slide.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${STATUS_STYLE[slide.contentStatus]}`}>
          {slide.contentStatus}
        </span>
        {slide.assetStatus && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${STATUS_STYLE[slide.assetStatus]}`}>
            {slide.figure ? "figure" : "image"} {slide.assetStatus}
          </span>
        )}
        {mine && (
          <span className="shrink-0 text-[11px] text-neutral-400">
            <LivenessHint activity={activity!} />
          </span>
        )}
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-neutral-500"
            onClick={() => setSteering((v) => !v)}
          >
            Redo
          </Button>
        )}
        {!disabled && slide.assetStatus && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-neutral-500"
            onClick={onRegenerateAsset}
          >
            {slide.figure ? "Recrop" : "Reimage"}
          </Button>
        )}
      </div>

      {steering && (
        <div className="mt-1.5 flex gap-1.5 pl-7">
          <Input
            className="px-2 py-1 text-[12px]"
            placeholder="Optional: how to change this slide"
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

      {slide.error && <div className="pl-7 text-[11px] text-destructive">{slide.error}</div>}
      {slide.assetError && <div className="pl-7 text-[11px] text-neutral-400">{slide.assetError}</div>}
      {slide.planNotice && <div className="pl-7 text-[11px] text-neutral-400">{slide.planNotice}</div>}
      {slide.sourceNotice && <div className="pl-7 text-[11px] text-neutral-400">{slide.sourceNotice}</div>}
      {slide.overflow && <div className="pl-7 text-[11px] text-amber-700">{slide.overflow}</div>}
    </div>
  );
}

function RunView({
  snap,
  pipeline,
  onStop,
}: {
  snap: SlidesSnapshot;
  pipeline: SlidesPipeline;
  onStop: () => void;
}) {
  const st = snap.state;
  const activity = snap.activity;
  const running = snap.running;
  const bodiesReady = st.slides.length > 0 && st.slides.every((s) => s.contentStatus === "done");
  return (
    <div className="rounded-lg border border-[#eee] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-[#1b1b1b]">{st.title}</div>
        <div className="flex items-center gap-2">
          {running && (
            <Button type="button" variant="link" size="link" className="text-[11px] text-neutral-400 hover:text-neutral-600" onClick={onStop}>
              Stop
            </Button>
          )}
          {!running && hasUnrunSlides(st) && st.planStatus !== "failed" && (
            <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={() => void pipeline.start()}>
              Resume
            </Button>
          )}
          {!running && bodiesReady && st.assembleStatus !== "done" && (
            <Button type="button" variant="outline" size="xs" className="text-neutral-500" onClick={() => pipeline.reassemble()}>
              Rebuild deck
            </Button>
          )}
        </div>
      </div>
      <div className="mt-0.5 text-[11px] text-neutral-400">
        {st.planStatus === "running" && (
          <>
            Planning the deck…{activity?.kind === "plan" && <> <LivenessHint activity={activity} /></>}
          </>
        )}
        {st.planStatus === "failed" && <span className="text-destructive">Plan failed: {st.planError}</span>}
        {/* Name the unit in flight rather than the whole deck: a one-page redo
            must not read like a full regeneration. */}
        {st.planStatus === "done" && running && (
          <>
            {activity?.kind === "content" && <>Writing slide {activity.slide}…</>}
            {activity?.kind === "assets" && <>Fetching the image for slide {activity.slide}…</>}
            {activity?.kind === "assemble" && "Assembling the deck…"}
            {!activity && "Working…"}
          </>
        )}
        {st.runStatus === "done" && <span className="text-green-700">Deck ready.</span>}
        {st.runStatus === "failed" && <span className="text-destructive">{st.runError}</span>}
        {st.runStatus === "stopped" && "Stopped — Resume picks up where it left off."}
        {st.runStatus === "idle" && st.assembleStatus === "stale" && (
          <span className="text-amber-700">Slides changed since the deck was built. Rebuild deck to update it.</span>
        )}
      </div>
      {st.assembleStatus === "failed" && st.assembleError && (
        <div className="mt-0.5 text-[11px] text-destructive">{st.assembleError}</div>
      )}

      {st.slides.length > 0 && (
        <div className="mt-2 max-h-72 overflow-y-auto border-t border-[#f0f0f0] pt-1">
          {st.slides.map((s) => (
            <SlideRow
              key={s.index}
              slide={s}
              activity={activity}
              disabled={running}
              onRegenerate={(instruction) => pipeline.regenerateSlide(s.index, instruction)}
              onRegenerateAsset={() => pipeline.regenerateAsset(s.index)}
            />
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
  const [states, setStates] = useState<SlidesState[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);

  const [pipeline, setPipeline] = useState<SlidesPipeline | null>(() => getCurrentTalk());
  const [snap, setSnap] = useState<SlidesSnapshot | null>(() => getCurrentTalk()?.snapshot() ?? null);

  useEffect(() => {
    listBooksWithNotes().then(setBooks);
    listTalks().then(setTalks);
    listTalkStates().then(setStates);
  }, []);

  useEffect(() => {
    if (!pipeline) {
      setSnap(null);
      return;
    }
    setSnap(pipeline.snapshot());
    return pipeline.subscribe(() => setSnap(pipeline.snapshot()));
  }, [pipeline]);

  // Refresh the deck list whenever a deck lands on disk.
  const outputFile = snap?.state?.outputFile;
  const assembleStatus = snap?.state?.assembleStatus;
  useEffect(() => {
    if (assembleStatus === "done") listTalks().then(setTalks);
  }, [assembleStatus, outputFile]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const running = snap?.running ?? false;
  const currentId = snap?.state?.id;
  // Talks with work left that this dialog is not already attached to.
  const resumable = states.filter((s) => s.id !== currentId && hasPendingWork(s));

  const generate = () => {
    const ids = books.map((b) => b.bookId).filter((id) => selected.has(id));
    if (ids.length === 0 || running) return;
    setPipeline(startTalk(ids, instruction.trim()));
  };

  const reopen = async (talkId: string) => {
    const p = await openTalk(talkId);
    if (p) setPipeline(p);
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
        className={cn(
          OVERLAY_Z.pageDialog,
          "flex w-[min(35rem,100%)] flex-col gap-0 rounded-xl border-0 p-0 shadow-2xl",
        )}
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

          {resumable.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-[#777]">Unfinished talks</div>
              <div className="flex flex-col gap-1.5">
                {resumable.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-[#eee] px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-neutral-700">{s.title}</div>
                      <div className="truncate text-[11px] text-neutral-400">
                        {s.slides.filter((sl) => sl.contentStatus === "done").length}/{s.slides.length} slides written
                      </div>
                    </div>
                    <Button type="button" variant="outline" onClick={() => void reopen(s.id)}>
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {snap && pipeline && <RunView snap={snap} pipeline={pipeline} onStop={() => pipeline.stop()} />}

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
                    <div className="flex shrink-0 items-center gap-1.5">
                      {t.talkId && t.talkId !== currentId && (
                        <Button type="button" variant="outline" onClick={() => void reopen(t.talkId!)}>
                          Edit
                        </Button>
                      )}
                      <Button type="button" variant="outline" onClick={() => open(t.file)}>
                        Open
                      </Button>
                    </div>
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
