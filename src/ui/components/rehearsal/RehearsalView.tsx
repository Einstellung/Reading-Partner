// Giving the talk (docs/44): the note, whole, on one scrolling page. Reached
// from the topic's Rehearsal section or from the Rehearse button on a retell —
// one object either way, so one view.
//
// Not a deck, and no longer a block at a time. Reading a note while talking asks
// three things of the page — find your place again a second after looking up,
// see what is coming, start or stop anywhere — and one block per screen with a
// Next button answered only the first, by taking the other two away.
//
// So the page never moves by itself: no jump on mount, no restored scroll, no
// auto-advance. A surface that scrolls while the reader is looking at the
// audience is worse than any amount of paging, because they come back to a place
// they did not leave.
//
// Nothing here records where the reader was. A scroll position is not a claim
// about what is being said, and the pass is handed in as the words and the clock
// (handoff.ts); the coach works out the rest from what it can hear.
//
// The run lands on disk on the way out, whichever way out that was — the End
// button, the back button, or the view being unmounted from under it. A pass is
// expensive to make and worthless to half-record.

import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose } from "../base/icons";
import { Button } from "../ui/button";
import {
  appendRun,
  type Rehearsal,
  type RehearsalEvent,
  type TranscriptSource,
} from "../../../reading/rehearsal";
import type { TalkOutline } from "../../../reading/talk";
import {
  browserWakeLockTarget,
  createScreenWakeLock,
  type ScreenWakeLock,
} from "../../../platform/app/wake-lock";
import { Markdown } from "../markdown/Markdown";
import { handOffPass } from "./coach-thread";
import { finishRun, formatElapsed, utteranceEvent } from "./rehearsal";

export interface RehearsalViewProps {
  // The object this pass is recorded against. Created or found by the caller
  // before it mounts this view, so both doors (docs/44) arrive here holding the
  // same thing.
  rehearsal: Rehearsal;
  // The talk being given. Read by the caller rather than here, for the same
  // reason the microphone is opened by the caller: the note has to be on screen
  // before the reader starts talking, and a read from disk after mount would put
  // the first words of the talk against a blank page.
  outline: TalkOutline;
  // Where the close button goes, in words: the retell for one door, the topic's
  // list for the other.
  backLabel: string;
  // Speech, when there is any. The caller makes one before it mounts this view
  // so that capture is already running when the note goes up; with no STT key
  // configured there is none, and the run records the clock and no words, which
  // is a run and not a failure.
  transcript?: TranscriptSource;
  onExit(): void;
  // The pass has been dealt with: written to disk and handed to the talk's
  // conversation, or found to be nothing worth writing. Later than onExit — a
  // source still uploading holds it back by seconds — and `recorded` says which
  // of the two it was, so the caller both re-reads the history at the one moment
  // it changed and stops waiting when there was never anything to wait for.
  onSaved(recorded: boolean): void;
}

// The note, as it is read at arm's length while talking. Everything is set
// against the block's own font size (em, as in MarkdownRenderer's set), so the
// one number that decides how big the note is on an iPhone and on an iPad is the
// font size on the column below.
//
// The renderer this sits over is the app's, and the app's is drawn for a light
// bubble: its own rules colour code, quotes, rules and links for ink on paper.
// Those are the ones repeated here with `!` — at equal specificity the winner
// would otherwise be whichever Tailwind emitted last, which is not a thing to
// hang a talk on.
const NOTE = [
  // Headings are the reader's landmarks — the thing the eye lands on coming back
  // from the audience — so they are brighter than the prose and carry the space.
  "[&_h1]:text-white [&_h1]:text-[1.15em] [&_h2]:text-white [&_h2]:text-[1.1em]",
  "[&_h3]:text-white [&_h4]:text-white [&_h5]:text-white [&_h6]:!text-white/55",
  // Prose and list items, opened up. A line found by eye rather than by reading
  // from the top needs the space between lines to be wider than the space
  // between words.
  "[&_p]:leading-[1.8] [&_li]:leading-[1.8] [&_li]:my-[0.35em]",
  "[&_a]:!text-sky-300",
  "[&_code]:!bg-white/10",
  "[&_pre]:!border-white/10 [&_pre]:!bg-black/40",
  "[&_blockquote]:!border-white/25 [&_blockquote]:!text-white/65",
  "[&_hr]:!border-white/15",
  "[&_th]:!border-white/20 [&_th]:!bg-white/10 [&_td]:!border-white/20",
  // A formula wider than the measure scrolls inside its own box. The alternative
  // is one long equation making the whole note scroll sideways, which loses the
  // reader's place in every block at once.
  "[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden",
].join(" ");

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

  const [elapsed, setElapsed] = useState(0);

  // The listener below and the save are both mounted once and hold their
  // closures for the life of the view, so the source is reached through a ref.
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
  // Tens of minutes go by with nobody touching the iPad — more of them now that
  // there is no Next button to touch — and a device that locks itself suspends
  // the webview: the dictation session listening to the talk goes down with it,
  // and the rest of the pass is recorded as no words at all. Asked for here
  // rather than after any await so the request still rides the tap that opened
  // the rehearsal — Safari wants a gesture for it — and failure is not the
  // caller's business: a screen that naps is a worse rehearsal, not a lost one.
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
  //
  // Nothing cuts the recording any more. The desktop source cut on a page turn
  // and there are no page turns, so its own 60-second ceiling is the only knife
  // left (segmented-source.ts arms it at start and re-arms it after every cut);
  // the dictated source never had one to lose.
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

  // Write the run. Once, whichever exit was taken.
  //
  // The last words arrive after the reader has left: stopping the source sends
  // the final segment and waits for every earlier one still on its way back from
  // STT, and the utterances land through the callback above. So the run is built
  // on the other side of that await, which is finishRun's order (rehearsal.ts).
  // The rest of this runs after the view is gone — the End button unmounts it
  // before the uploads finish — which is why nothing past this point touches this
  // view's state: the events are a ref, the store writes a file, and onSaved
  // belongs to the view above, which is still up.
  const finish = useCallback(async () => {
    // The gate closes before the first await, so the second caller (the End
    // button and then the unmount, or the other way round) turns back here
    // rather than writing the run twice.
    if (savedRef.current) return;
    savedRef.current = true;
    // The screen is handed back at the same gate the run is written at, so the
    // three ways out (End, back, unmount) are one path to keep right and not
    // two. Before the await: the reader has stopped talking, and the words still
    // uploading do not need the iPad awake.
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

  return (
    // The one screen that is not on the app's palette and is not tinted with
    // it: a rehearsal is what a room looks at, and the chrome around it is dark.
    // The paper tint (styles.css) has nothing to say here — it lightens a
    // reading surface, and there is none.
    <div className="absolute inset-0 flex flex-col bg-[#0d0f14]">
      <div
        className="flex flex-none items-center gap-3 pb-2 pl-safe-3 pr-safe-3 pt-safe-2 text-white"
      >
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
        <span
          className="flex-none text-[13px] tabular-nums text-white/70"
          title="How long this rehearsal has been going"
        >
          {formatElapsed(elapsed)}
        </span>
        <Button type="button" onClick={leave}>
          End the rehearsal
        </Button>
      </div>

      {/* The through-line, on screen for the whole pass. Small on purpose: it is
          not said out loud, it is the one thing a reader talking off the top of
          their head can check themselves against (docs/44). */}
      {outline.spine.thesis && (
        <p
          className="m-0 flex-none truncate border-b border-white/10 py-1.5 pl-safe-4 pr-safe-4 text-[11px] text-white/40"
        >
          {outline.spine.thesis}
        </p>
      )}

      {/* The whole note in one column, and the only thing in this view that
          scrolls. `overscroll-contain` so a flick at the end of the last block
          does not hand the gesture to whatever is behind this screen. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-6 pb-safe-16 pl-safe-6 pr-safe-6"
      >
        {segments.length === 0 ? (
          <p className="m-0 text-sm text-white/70">
            This talk has no segments yet. Arrange it at the end of the retell, then rehearse.
          </p>
        ) : (
          // A measure, not a column of the iPad's width: a line the eye has to
          // track back across is a line the reader loses. Blocks are told apart
          // by the space between them and nothing else — no frame, no number, no
          // status — because it is one note and it is read as one.
          <div
            className="mx-auto flex max-w-[36rem] flex-col gap-10 text-[19px] leading-[1.8] text-white/90 sm:text-[21px]"
          >
            {segments.map((segment) => (
              <div key={segment.id} className={NOTE}>
                <Markdown text={segment.body} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
