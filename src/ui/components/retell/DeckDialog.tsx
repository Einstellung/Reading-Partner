// This retell's deck (docs/31: the PPT is the retell's product, the last step of the
// loop). Opened from the retell it belongs to, so there is nothing to pick and no
// retell to describe — the materials and the outline are the retell's, and the deck
// lands under the retell's own id.
//
// It is a dialog rather than a third pane in RetellView: a deck run is a list of
// twenty rows with per-row controls, and the retell's two panes (the conversation
// and the outline) are where the reader is actually working. Opening it over the
// retell keeps one entry point and leaves that layout alone.
//
// While a run is in flight it shows the same visual language as notes generation
// — stage, per slide progress, liveness seconds, Stop — and it drives the three
// re-runs the resumable pipeline supports: one slide's body (with an optional
// one-line steer), one slide's image, and the deck itself. Everything a slide had
// to settle for — a chapter that had no note, a figure that could not be cropped,
// a body that will not fit the stage — is printed on its row.
//
// A centred Dialog (docs/30, fourth pass). RetellView mounts and unmounts it, so
// `open` is constant and onOpenChange reports the closes Radix decides on:
// Escape, and a press outside the box.

import { useEffect, useState } from "react";
import {
  getCurrentDeck,
  hasUnrunSlides,
  listDecks,
  listDeckRetells,
  openDeck,
  revealDeckFile,
  startDeck,
  type SlideRun,
  type SlidesActivity,
  type SlidesPipeline,
  type SlidesSnapshot,
  type RetellEntry,
} from "../../../reading/slides";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { OVERLAY_Z } from "../ui/overlay";

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
  pending: "bg-muted-soft text-neutral-500",
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
    <div className="border-b border-border-faint py-1 last:border-0">
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
    <div className="rounded-lg border border-border-subtle p-3">
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
        <div className="mt-2 max-h-72 overflow-y-auto border-t border-border-subtle pt-1">
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

export default function DeckDialog({
  retellId,
  retellName,
  onClose,
}: {
  retellId: string;
  retellName: string;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [deck, setDeck] = useState<RetellEntry | null>(null);
  // null while the check is running; false when the retell has nothing to build a
  // deck from, which is a state the reader has to be told about rather than a
  // button that does nothing.
  const [buildable, setBuildable] = useState<boolean | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // A run this retell started before the dialog was closed and reopened. Another
  // retell's run is not ours to show, so it is filtered out rather than attached.
  const mine = (): SlidesPipeline | null => {
    const p = getCurrentDeck();
    return p?.snapshot().state.id === retellId ? p : null;
  };
  const [pipeline, setPipeline] = useState<SlidesPipeline | null>(mine);
  const [snap, setSnap] = useState<SlidesSnapshot | null>(() => mine()?.snapshot() ?? null);

  // Attach to this retell's deck run if one is already on disk, and pick up the
  // instruction it was started with so a re-plan does not silently lose it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await openDeck(retellId);
      if (!cancelled && p) {
        setPipeline(p);
        setInstruction(p.snapshot().state.instruction);
      }
      const retells = await listDeckRetells();
      if (!cancelled) setBuildable(retells.some((t) => t.retellId === retellId));
    })();
    return () => {
      cancelled = true;
    };
  }, [retellId]);

  useEffect(() => {
    if (!pipeline) {
      setSnap(null);
      return;
    }
    setSnap(pipeline.snapshot());
    return pipeline.subscribe(() => setSnap(pipeline.snapshot()));
  }, [pipeline]);

  // The deck file, refreshed whenever one lands on disk.
  const outputFile = snap?.state?.outputFile;
  const assembleStatus = snap?.state?.assembleStatus;
  useEffect(() => {
    let cancelled = false;
    void listDecks().then((all) => {
      if (!cancelled) setDeck(all.find((d) => d.retellId === retellId) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [retellId, assembleStatus, outputFile]);

  const running = snap?.running ?? false;
  const planned = !!snap?.state && snap.state.slides.length > 0;

  const generate = () => {
    if (running || buildable === false) return;
    void startDeck(retellId, instruction.trim()).then((p) => {
      if (p) setPipeline(p);
    });
  };

  const reveal = async (file: string) => {
    setOpenError(null);
    const failure = await revealDeckFile(file);
    if (failure) setOpenError(failure);
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
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <DialogTitle className="min-w-0 truncate text-[15px] font-semibold leading-normal text-[#1b1b1b]">
            The deck for “{retellName}”
          </DialogTitle>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {buildable === false ? (
            <p className="m-0 text-[12px] text-neutral-400">
              Nothing has been settled in this retell yet, and none of its materials has notes — go
              through a chapter or two first and the deck follows from the outline.
            </p>
          ) : (
            <>
              <div>
                {/* Not a description of the retell: the outline already is the retell.
                    This only steers the shape of the pages. */}
                <div className="mb-1.5 text-[12px] font-semibold text-[#777]">
                  Theme or audience (optional)
                </div>
                <Input
                  className="text-[13px]"
                  placeholder="e.g. 15 minutes, for engineers"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="button" disabled={running || buildable === null} onClick={generate}>
                  {running ? "Generating…" : planned ? "Plan again" : "Generate the deck"}
                </Button>
                <span className="text-[11px] text-neutral-400">
                  {planned
                    ? "Planning again replaces the pages below."
                    : "Without an illustration key (Settings), decks generate without AI images."}
                </span>
              </div>
            </>
          )}

          {snap && pipeline && <RunView snap={snap} pipeline={pipeline} onStop={() => pipeline.stop()} />}

          {deck && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-neutral-700">{deck.title}</div>
                <div className="truncate text-[11px] text-neutral-400">{deck.file}</div>
              </div>
              <Button type="button" variant="outline" onClick={() => reveal(deck.file)}>
                Open
              </Button>
            </div>
          )}
          {openError && <p className="m-0 text-[11px] text-destructive">{openError}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
