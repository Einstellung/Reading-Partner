// Giving the talk (docs/31, the third stage): the built deck, full screen, and a
// record of where the reader was and how long they stayed there.
//
// The deck is the file that already exists on disk — self-contained HTML, opens
// in any browser — dropped into an iframe as srcdoc. It keeps its own paging:
// arrow keys, space, click left/right are its script's, not this view's, so what
// is rehearsed here is the same thing that will run off a USB stick. All this
// view adds is a listener: the deck posts where it is, the host stamps the time.
//
// srcdoc rather than a blob URL, verified on WebKitGTK 2.52.3 under the app's own
// CSP (`frame-src 'self'`, COOP same-origin, COEP require-corp): a 22 MB deck
// loads in 415 ms with no policy violation and its inline script runs and posts
// out. Nothing in the CSP had to change.
//
// The run lands on disk on the way out, whichever way out that was — the End
// button, the back button, or the view being unmounted from under it. A pass
// through a talk is expensive to make and worthless to half-record.

import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose } from "../base/icons";
import { Button } from "../ui/button";
import {
  appendRun,
  buildRun,
  type RehearsalEvent,
  type TranscriptSource,
} from "../../../reading/rehearsal";
import { useDeckHtml } from "./useRehearsal";
import {
  checkDeckProtocol,
  endEvent,
  formatElapsed,
  hasRecordedPages,
  isPageTurn,
  positionLabel,
  type ProtocolCheck,
  readDeckSignal,
  utteranceEvent,
  withSlideEvent,
} from "./rehearsal";

export interface RehearsalViewProps {
  talkId: string;
  talkName: string;
  // The deck to give, AppData-relative. The caller already knows it — that is
  // what enabled the button that got here.
  deckFile: string;
  // Speech, when there is any. The caller makes one before it mounts this view
  // (TalkView) so that capture is already running when the deck reports its
  // first page; with no STT key configured there is none, and the run records
  // pages and no words, which is a run and not a failure.
  transcript?: TranscriptSource;
  onExit(): void;
}

export default function RehearsalView({
  talkId,
  talkName,
  deckFile,
  transcript,
  onExit,
}: RehearsalViewProps) {
  const { html, error } = useDeckHtml(deckFile);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const eventsRef = useRef<RehearsalEvent[]>([]);
  const startedAtRef = useRef(Date.now());
  const savedRef = useRef(false);

  const [current, setCurrent] = useState<{ index: number; total: number; title: string } | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [mismatch, setMismatch] = useState<ProtocolCheck | null>(null);

  // The listener below and the save are both mounted once and hold their
  // closures for the life of the view, so the source is reached through a ref:
  // read the prop directly and a page turn would cut a source the view was
  // handed on its first render.
  const transcriptRef = useRef(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  });

  // Only messages from this view's own frame count. `source === 'deck'` alone is
  // not enough: any document that gets a handle on this window can say it.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || !e.source || e.source !== frame.contentWindow) return;
      const signal = readDeckSignal(e.data);
      if (!signal) return;
      // The deck names its bridge version on the way in. A deck that speaks a
      // different one still pages fine — it is its own script — but what it
      // reports is not something this run can claim to have got right.
      if (signal.type === "ready") {
        const check = checkDeckProtocol(signal);
        setMismatch(check.ok ? null : check);
        return;
      }
      // The page turn is the cut. Desktop STT hands back one block of text with
      // no timings inside it (docs/43), so a segment's only boundaries are the
      // two page turns around it — without this the whole talk is one segment
      // and the transcript has no pages in it. A repeated report is the deck
      // redrawing the page that is already up, and cutting on that would put a
      // seam in the middle of a page.
      if (isPageTurn(eventsRef.current, signal)) transcriptRef.current?.cut();
      eventsRef.current = withSlideEvent(eventsRef.current, signal, Date.now());
      setCurrent({ index: signal.index, total: signal.total, title: signal.title });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Set srcdoc imperatively: the deck is megabytes of string and has no business
  // going through a render pass, and the load handler is what hands the keyboard
  // to the deck — its keydown listener is on its own document, so without focus
  // the arrow keys go nowhere.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || html === null) return;
    const onLoad = () => frame.contentWindow?.focus();
    frame.addEventListener("load", onLoad);
    frame.srcdoc = html;
    return () => frame.removeEventListener("load", onLoad);
  }, [html]);

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

  // Write the run. Once, whichever exit was taken. A view that never got a page
  // out of the deck (it failed to load, or the reader turned round immediately)
  // has nothing to write: an empty row in the history would be a pass that never
  // happened.
  //
  // The last page's words arrive after the reader has left: stopping the source
  // sends the final segment and waits for every earlier one still on its way
  // back from STT, and the utterances land through the callback above. So the
  // run is built on the other side of that await. The rest of this runs after
  // the view is gone — the End button unmounts it before the uploads finish —
  // and that is fine because nothing past this point touches React state: the
  // events are a ref and appendRun writes a file.
  const finish = useCallback(async () => {
    // The gate closes before the first await, so the second caller (the End
    // button and then the unmount, or the other way round) turns back here
    // rather than writing the run twice.
    if (savedRef.current) return;
    savedRef.current = true;
    // Stamped now, not after the wait: the rehearsal ended when the reader
    // stopped talking, not when the last upload came back.
    const endedAt = Date.now();
    const source = transcriptRef.current;
    if (source) {
      await source.stop().catch((e: unknown) => console.warn("transcript stop failed", e));
    }
    const events = [...eventsRef.current, endEvent(endedAt)];
    if (!hasRecordedPages(events)) return;
    const run = buildRun({
      id: crypto.randomUUID(),
      ordinal: 0, // appendRun assigns it
      talkId,
      deckFile,
      startedAt: startedAtRef.current,
      events,
    });
    void appendRun(run).catch((e: unknown) => console.warn("failed to record the run", e));
  }, [talkId, deckFile]);

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
  // this view is gone, and the reader is back in the talk in the meantime.
  const leave = () => {
    void finish();
    onExit();
  };

  return (
    // The one screen that is not on the app's palette and is not tinted with
    // it: a rehearsal is a projected deck, and the chrome around it is dark so
    // the room looks at the slide. The paper tint (styles.css) has nothing to
    // say here — it lightens a reading surface, and there is none.
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
          title="Back to the talk"
          aria-label="Back to the talk"
          onClick={leave}
          className="h-9 w-9 text-white/70 can-hover:hover:bg-white/10 can-hover:hover:text-white"
        >
          <IconClose size={18} />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">{talkName}</span>
        <span className="flex-none text-[13px] tabular-nums text-white/70">
          {positionLabel(current)}
        </span>
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

      {mismatch ? (
        <p
          role="status"
          className="m-0 flex-none border-y border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200"
        >
          {mismatch.notice}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {error ? (
          <p className="m-0 px-4 py-3 text-sm text-white/70">{error}</p>
        ) : (
          <iframe
            ref={frameRef}
            title={`Deck for ${talkName}`}
            className="h-full w-full border-0 bg-[#0d0f14]"
          />
        )}
      </div>
    </div>
  );
}
