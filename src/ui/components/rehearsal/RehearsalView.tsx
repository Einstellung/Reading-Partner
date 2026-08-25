// Giving the talk (docs/44): one segment of the outline on screen, and a record
// of which segment the reader was on and how long they stayed there. Reached
// from the topic's Rehearsal section or from the Rehearse button on a retell —
// one object either way, so one view.
//
// Not a deck. The slides are made outside the app and the app never sees that
// file; what is on screen is the outline the reader wrote, one segment at a
// time, in the sizes that say what to do with each part: the through-line small
// and always there because it is the only thing a reader can check themselves
// against, the cues largest because they are what has to be said out loud, the
// figures and formulas whole because in a technical talk the formula is the
// thing being pointed at.
//
// One segment is one screen and the screen does not scroll. A segment that does
// not fit is a segment that wants splitting, and the panel says so rather than
// stepping the type down — which is the whole reason the panel is what holds the
// outline's grain.
//
// The run lands on disk on the way out, whichever way out that was — the End
// button, the back button, or the view being unmounted from under it. A pass is
// expensive to make and worthless to half-record.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { IconClose, IconChevronDown, IconChevronUp } from "../base/icons";
import { Button } from "../ui/button";
import {
  appendRun,
  type Rehearsal,
  type RehearsalEvent,
  type TranscriptSource,
} from "../../../reading/rehearsal";
import type { TalkMaterial, TalkOutline, TalkSegment } from "../../../reading/talk";
import {
  browserWakeLockTarget,
  createScreenWakeLock,
  type ScreenWakeLock,
} from "../../../platform/app/wake-lock";
import { FigureContext } from "../markdown/Markdown";
import { Markdown } from "../markdown/Markdown";
import FigureCard from "../markdown/FigureCard";
import {
  callbackLabel,
  displayMath,
  isSegmentChange,
  nextSegmentIndex,
  nextTitle,
  overflowNotice,
  segmentTitle,
  withSegmentEvent,
} from "./outline-run";
import { handOffPass } from "./coach-thread";
import { finishRun, formatElapsed, positionLabel, utteranceEvent } from "./rehearsal";

export interface RehearsalViewProps {
  // The object this pass is recorded against. Created or found by the caller
  // before it mounts this view, so both doors (docs/44) arrive here holding the
  // same thing.
  rehearsal: Rehearsal;
  // The talk being given. Read by the caller rather than here, for the same
  // reason the microphone is opened by the caller: the panel has to be on screen
  // with a segment up before the reader starts talking, and a read from disk
  // after mount would put the first words of the talk against nothing.
  outline: TalkOutline;
  // Where the close button goes, in words: the retell for one door, the topic's
  // list for the other.
  backLabel: string;
  // Speech, when there is any. The caller makes one before it mounts this view
  // so that capture is already running when the first segment goes up; with no
  // STT key configured there is none, and the run records segments and no words,
  // which is a run and not a failure.
  transcript?: TranscriptSource;
  onExit(): void;
  // The pass has been dealt with: written to disk and handed to the talk's
  // conversation, or found to be nothing worth writing. Later than onExit — a
  // source still uploading holds it back by seconds — and `recorded` says which
  // of the two it was, so the caller both re-reads the history at the one moment
  // it changed and stops waiting when there was never anything to wait for.
  onSaved(recorded: boolean): void;
}

// A formula, through the renderer the rest of the app already reads maths with
// (KaTeX behind react-markdown). No second maths path, and no second copy of the
// fonts: the renderer is lazily loaded and shows the TeX as written until its
// chunk arrives, which on a panel that is about to be talked at for ten minutes
// costs nothing.
function Formula({ tex }: { tex: string }) {
  return (
    <div className="overflow-x-auto text-center text-white [&_.katex]:text-[1.15em]">
      <Markdown text={displayMath(tex)} />
    </div>
  );
}

// A figure, whole. The crop is the app's own figure card, which needs the book
// the figure came out of to be resolvable here — it is when a book is open under
// this screen and not otherwise, and an outline's figure names an id without
// saying which book's (docs/44 leaves the field's grain open). So the picture is
// drawn when the host can find it and the description is what is left when it
// cannot, rather than a card that would go and fetch some other book's figure 3.
function FigureMaterial({ material }: { material: Extract<TalkMaterial, { kind: "figure" }> }) {
  const host = useContext(FigureContext);
  const figure = material.figId && host ? host.getFigure(material.figId) : null;
  if (figure && host && material.figId) {
    return (
      <div className="flex flex-col items-center gap-1">
        <FigureCard host={host} id={material.figId} />
        {material.description && (
          <span className="text-[13px] text-white/50">{material.description}</span>
        )}
      </div>
    );
  }
  return (
    <p className="m-0 text-[15px] leading-relaxed text-white/70">
      {material.figId && (
        <span className="mr-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-white/60">
          Fig. {material.figId}
        </span>
      )}
      {material.description || "A figure that is not on this device."}
    </p>
  );
}

// One segment, one screen. Nothing here scrolls: `overflow-hidden` is what makes
// a segment that does not fit visibly not fit, which is the signal the notice
// above it explains.
function SegmentPanel({
  segments,
  index,
}: {
  segments: readonly TalkSegment[];
  index: number;
}) {
  const segment = segments[index];
  const callback = callbackLabel(segments, segment);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-5 sm:px-10">
      <p className="m-0 flex items-baseline gap-2 text-[15px] text-white/60">
        <span className="tabular-nums text-white/40">{index + 1}.</span>
        <span className="min-w-0">{segmentTitle(segment)}</span>
      </p>

      {/* The cues, in the largest type on the screen. They are the only thing
          here that has to come out of the reader's mouth; everything else is
          there to be pointed at or checked against. */}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {segment.cues.map((cue, i) => (
          <li key={i} className="text-2xl leading-snug text-white sm:text-3xl">
            {cue}
          </li>
        ))}
      </ul>

      {segment.material.length > 0 && (
        <div className="flex flex-col gap-3">
          {segment.material.map((m, i) =>
            m.kind === "tex" ? (
              <Formula key={i} tex={m.tex} />
            ) : (
              <FigureMaterial key={i} material={m} />
            ),
          )}
        </div>
      )}

      {callback && (
        <p className="m-0 mt-auto text-[11px] text-white/30">Pays back {callback}</p>
      )}
    </div>
  );
}

// The whole talk, folded away. Out of sight while a segment is being given —
// the reader should not be looking at the shape of the talk in the middle of
// saying part of it — and one press away when the next thing to do is to go
// somewhere else in it (docs/44).
function JumpList({
  segments,
  current,
  onJump,
}: {
  segments: readonly TalkSegment[];
  current: number;
  onJump(index: number): void;
}) {
  return (
    <aside className="flex w-64 flex-none flex-col overflow-y-auto border-l border-white/10">
      <ul className="m-0 flex list-none flex-col p-0">
        {segments.map((segment, i) => (
          <li key={segment.id}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onJump(i)}
              aria-current={i === current ? "true" : undefined}
              className={`h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left text-[13px] can-hover:hover:bg-white/10 ${
                i === current ? "bg-white/10 text-white" : "text-white/60"
              }`}
            >
              <span className="flex-none tabular-nums text-white/35">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{segmentTitle(segment)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function RehearsalView({
  rehearsal,
  outline,
  backLabel,
  transcript,
  onExit,
  onSaved,
}: RehearsalViewProps) {
  const segments = outline.segments;

  const eventsRef = useRef<RehearsalEvent[]>([]);
  const startedAtRef = useRef(Date.now());
  const savedRef = useRef(false);

  const [current, setCurrent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);

  // The listener below and the save are both mounted once and hold their
  // closures for the life of the view, so the source is reached through a ref:
  // read the prop directly and a segment change would cut a source the view was
  // handed on its first render.
  const transcriptRef = useRef(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  });

  // Same reason, and one more: this one is called after the view is gone (see
  // finish below), so it cannot be read off a render that has been torn down.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  // Keep the screen on for the length of the pass (platform/app/wake-lock).
  // Tens of minutes go by with nobody touching the iPad, and a device that locks
  // itself suspends the webview: the dictation session listening to the talk
  // goes down with it, and the rest of the pass is recorded as segments and no
  // words. Asked for here rather than after any await so the request still rides
  // the tap that opened the rehearsal — Safari wants a gesture for it — and
  // failure is not the caller's business: a screen that naps is a worse
  // rehearsal, not a lost one.
  const lockRef = useRef<ScreenWakeLock | null>(null);
  useEffect(() => {
    const lock = createScreenWakeLock(browserWakeLockTarget());
    lockRef.current = lock;
    lock.set(true);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Date.now() - startedAtRef.current), 500);
    return () => window.clearInterval(id);
  }, []);

  // Speech, when a source is handed in. Declared before the save effect on
  // purpose: React tears cleanups down in declaration order, so the stop is
  // already under way by the time the save runs. It is not enough on its own —
  // stopping the desktop source waits for every segment still uploading, which
  // is why finish() awaits it too. Both calls land on the one stop: a source is
  // stopped once and every caller gets that same promise back.
  useEffect(() => {
    if (!transcript) return;
    void transcript
      .start((u) => {
        eventsRef.current = [...eventsRef.current, utteranceEvent(u)];
      })
      .catch((e: unknown) => console.warn("the transcript source failed to start", e));
    return () => {
      void transcript.stop().catch((e: unknown) => console.warn("transcript stop failed", e));
    };
  }, [transcript]);

  // Putting a segment up is what a deck's page turn used to be: the host stamps
  // the time, the run records it, and the recording is cut so the words either
  // side of it are transcribed as two segments rather than one block hung on
  // whichever segment happened to be up first (docs/43 — desktop STT hands back
  // one lump of text with no timings inside it). Jumping to the segment already
  // on screen is not a change and does not cut.
  const show = useCallback(
    (index: number) => {
      const segment = segments[index];
      if (!segment) return;
      const at = Date.now();
      if (isSegmentChange(eventsRef.current, index)) transcriptRef.current?.cut();
      eventsRef.current = withSegmentEvent(eventsRef.current, segment, index, at);
      setCurrent(index);
    },
    [segments],
  );

  // The first segment goes up with the panel. Declared after the transcript
  // effect so capture is already running when it does; anything said before the
  // first segment event belongs to no segment and is dropped (buildRun).
  const showRef = useRef(show);
  useEffect(() => {
    showRef.current = show;
  });
  useEffect(() => {
    showRef.current(0);
  }, []);

  // Write the run. Once, whichever exit was taken. A view that never got a
  // segment up (an outline with nothing on it, or the reader turning round
  // immediately) has nothing to write: an empty row in the history would be a
  // pass that never happened.
  //
  // The last segment's words arrive after the reader has left: stopping the
  // source sends the final segment and waits for every earlier one still on its
  // way back from STT, and the utterances land through the callback above. So
  // the run is built on the other side of that await, which is finishRun's order
  // (rehearsal.ts). The rest of this runs after the view is gone — the End
  // button unmounts it before the uploads finish — which is why nothing past
  // this point touches this view's state: the events are a ref, the store
  // writes a file, and onSaved belongs to the view above, which is still up.
  const finish = useCallback(async () => {
    // The gate closes before the first await, so the second caller (the End
    // button and then the unmount, or the other way round) turns back here
    // rather than writing the run twice.
    if (savedRef.current) return;
    savedRef.current = true;
    // The screen is handed back at the same gate the run is written at, so the
    // three ways out (End, back, unmount) are one path to keep right and not
    // two. Before the await: the reader has stopped talking, and the segments
    // still uploading do not need the iPad awake.
    lockRef.current?.set(false);
    const saved = await finishRun({
      rehearsalId: rehearsal.id,
      id: crypto.randomUUID(),
      startedAt: startedAtRef.current,
      endedAt: Date.now(),
      source: transcriptRef.current,
      events: () => eventsRef.current,
      save: appendRun,
      // Stopping is handing it in (docs/44): the pass goes into the talk's
      // conversation as the reader's own message, and the coach answers it there
      // rather than here. After the write and never instead of it — finishRun
      // keeps that order.
      handoff: (run, entry) => handOffPass({ outline, entry, pages: run.pages }),
    });
    onSavedRef.current(saved);
  }, [rehearsal.id, outline]);

  // Unmounting is an exit like any other (a topic switch, a book opened from
  // elsewhere), so the save hangs off the cleanup rather than off the buttons.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  useEffect(
    () => () => {
      void finishRef.current();
    },
    [],
  );

  // Leaving does not wait for the run to be written. finish() carries on after
  // this view is gone, and the reader is back where they came from in the
  // meantime; the history there fills in when onSaved fires. Leaving is also the
  // whole of what "the AI says something" costs: the panel closes, the
  // conversation is where it was, and nothing was said out of it during the pass
  // (docs/44).
  const leave = () => {
    void finish();
    onExit();
  };

  const segment = segments[current] ?? null;
  const notice = useMemo(() => (segment ? overflowNotice(segment) : null), [segment]);
  const upNext = nextTitle(segments, current);
  const goNext = nextSegmentIndex(current, segments.length);

  return (
    // The one screen that is not on the app's palette and is not tinted with
    // it: a rehearsal is what a room looks at, and the chrome around it is dark.
    // The paper tint (styles.css) has nothing to say here — it lightens a
    // reading surface, and there is none.
    <div className="absolute inset-0 flex flex-col bg-[#0d0f14]">
      <div className="flex flex-none items-center gap-3 px-3 py-2 text-white">
        {/* The app's one surviving `bg-white`, and the reason it survives: a
            tenth of white is how a control lights up on a near-black bar, and a
            palette token would put a cream fill on it. The contract test names
            this line (tests/ui/components/paper-tint-contract.test.ts). */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={backLabel}
          aria-label={backLabel}
          onClick={leave}
          className="h-9 w-9 text-white/70 can-hover:hover:bg-white/10 can-hover:hover:text-white"
        >
          <IconClose size={18} />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">{outline.name}</span>
        <span className="flex-none text-[13px] tabular-nums text-white/70">
          {positionLabel(segment ? { index: current, total: segments.length } : null)}
        </span>
        <span
          className="flex-none text-[13px] tabular-nums text-white/70"
          title="How long this rehearsal has been going"
        >
          {formatElapsed(elapsed)}
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setJumpOpen((open) => !open)}
          title="The whole talk, to start or stop anywhere in it"
          className="h-9 gap-1.5 px-2 text-[13px] text-white/70 can-hover:hover:bg-white/10 can-hover:hover:text-white"
        >
          Segments
          {jumpOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </Button>
        <Button type="button" onClick={leave}>
          End the rehearsal
        </Button>
      </div>

      {/* The through-line, on screen for the whole pass. Small on purpose: it is
          not said out loud, it is the one thing a reader talking off the top of
          their head can check themselves against (docs/44). */}
      {outline.spine.thesis && (
        <p className="m-0 flex-none truncate border-b border-white/10 px-4 py-1.5 text-[11px] text-white/40">
          {outline.spine.thesis}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="m-0 flex-none border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[13px] text-amber-200"
        >
          {notice}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {segment ? (
          <SegmentPanel segments={segments} index={current} />
        ) : (
          <p className="m-0 flex-1 px-6 py-5 text-sm text-white/70">
            This talk has no segments yet. Arrange it at the end of the retell, then rehearse.
          </p>
        )}
        {jumpOpen && segments.length > 0 && (
          <JumpList
            segments={segments}
            current={current}
            onJump={(i) => {
              show(i);
              setJumpOpen(false);
            }}
          />
        )}
      </div>

      {/* Where this is going. On screen the whole time the current segment is
          being given: landing a segment somewhere the next one can pick up from
          is the hard part, and it cannot be done without knowing what the next
          one is (docs/44). */}
      <div className="flex flex-none items-center gap-3 border-t border-white/10 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[13px] text-white/45">
          {upNext ? `Next: ${upNext}` : "Last segment"}
        </span>
        <Button
          type="button"
          disabled={goNext === null}
          title={goNext === null ? "This is the last segment" : "Go on to the next segment"}
          onClick={() => goNext !== null && show(goNext)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
