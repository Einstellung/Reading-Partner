// Hold-to-talk with a person on the other end of it (VITE_SMOKE=dictation-bench).
// main.tsx mounts this instead of the app, so a normal build never loads the
// chunk.
//
// Why it exists: the build on the phone is signed with the .dev bundle id, and
// Google sign-in is bound to the real one (docs/pitfall/31), so there is no way
// into a chat on that build — the shell wants an account before it will show
// one. Everything below reaches the plugin without an account, a sync, a
// network call or a provider key: the composer, the settings file and the voice
// plugin are the whole dependency list.
//
// The bar under test is the shipped one. This file renders the real Composer,
// which renders the real HoldToTalk, which runs the real reducer against the
// real plugin; nothing here reimplements a gesture, a meter or a transcript.
// What it adds is the three things a person needs that the product does not
// give them:
//
//   1. The transcript on screen. The shipping build no longer logs the words
//      (DictationRun.stop logs a character count), so a message that vanishes
//      into a thread nobody can read is not a test. Every send lands in the
//      list above the composer.
//   2. An outcome for the two gestures that produce no message. Sliding to
//      Cancel is supposed to leave no trace, which from the outside is exactly
//      what a broken hold looks like; sliding to Edit drops the text into the
//      composer, which is visible but easy to mistake for the keyboard opening
//      on its own. Both get a row saying which one happened, with the run's own
//      numbers beside it.
//   3. A language switch. The real one is in Settings, behind the shell, and
//      one recognizer decodes one language totally rather than partially
//      (docs/pitfall/164) — so without a switch only half the thing can be
//      tried. It writes the same `dictationLocale` setting the settings card
//      writes and the composer reads.
//   4. An indicator probe, which is measurement rather than product: it parks
//      the audio stack at one step and leaves it there so the status bar can be
//      read (indicator-probe.ts). Every hold line says where it was standing
//      when the finger went down and whether it had been in the stack since the
//      last hold, and a probe call is a line of its own. The first hold after
//      any probe call is refused by the plugin and gets a row saying so — a
//      probe call, `off` included, tears the audio stack down, so a probe in the
//      middle of a run of holds ends it.
//   5. The press's own segments, which the plugin sends once the hold is down
//      and every hold line then carries — whether the microphone was inherited
//      from the hold before it, how long the session, the voice processing, the
//      format read and the first buffer each took, and what the pre-roll held.
//      It is the only road on a shipping build: the `RP-DICT` lines that carry
//      the same numbers are a debug build's only, and the log is the road that
//      broke anyway — a whole afternoon of them was lost to a syslog stream that
//      had died with its reader still running.
//
// Every row also goes into a file as it is made, one appended line each
// (bench-journal.ts). The list on screen is state, and state is gone with the
// process; a bench is held for as long as someone keeps trying things, which is
// long enough for a reload, a backgrounding or the fault under investigation to
// take the page down with the record of it.
//
// The gesture's outcome is read from outside the composer rather than by
// threading a callback through it, because the callback would be production
// surface that only this file wants. Three signals, none of them guesswork: a
// send arrives as the composer's own onSend; an edit is the composer switching
// itself back to keyboard mode, which is a textarea appearing where the bar
// was; a cancel is neither of those happening before the flush window closes.
// A fourth comes from the plugin rather than from the gesture — a press it
// refused because a probe had been in the audio stack since the last hold — and
// it is read before the other three, which are all empty when it is true.
//
// The level readout comes from a second listener on the plugin's event stream.
// Tauri's Swift Plugin keeps an array of channels per event name and trigger
// fans out to every one of them, so this is passive: it sees what the composer
// sees and takes nothing away. It shows counts and a level and never the words
// — the bar deliberately hides its transcript while the finger is down (docs/15),
// and a running commentary above it would turn speaking into proofreading and
// change the thing being judged.

import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { addPluginListener } from "@tauri-apps/api/core";

import { Composer } from "../ui/components/chat/chat";
import {
  DICTATION_EVENT,
  VOICE_PLUGIN,
  hasOnDeviceDictation,
  type DictationEvent,
  type DictationTiming,
} from "../ai/voice/dictation";
import {
  DICTATION_LOCALE_OPTIONS,
  flushSettings,
  loadSettings,
  saveSettings,
  type DictationLocale,
} from "../platform/app/settings";
import { benchJournal, type BenchOutcome } from "./bench-journal";
import {
  INDICATOR_STAGE_OPTIONS,
  PROBE_ENDS_THE_RUN,
  PROBE_REFUSED_THE_HOLD,
  probeRefusedTheHold,
  setIndicatorProbe,
  type IndicatorProbeState,
  type IndicatorStage,
} from "./indicator-probe";
import { NO_HEARD, RESOLVE_MS, classifyHold, type Heard } from "./hold-outcome";
import { holdTheScreen } from "./wake-lock";

interface Entry {
  id: number;
  outcome: BenchOutcome;
  text: string;
  heard: Heard | null;
  locale: DictationLocale;
  timing: DictationTiming | null;
}

const OUTCOME: Record<BenchOutcome, { label: string; note: string; tint: string; rule: string }> = {
  sent: {
    label: "Sent",
    note: "released on the bar",
    tint: "text-emerald-700",
    rule: "border-emerald-500",
  },
  edit: {
    label: "Moved to the composer",
    note: "released on Edit — the words are in the field below, edit and send them",
    tint: "text-sky-700",
    rule: "border-sky-500",
  },
  cancel: {
    label: "Cancelled",
    note: "released on Cancel — nothing kept, which is what should happen",
    tint: "text-neutral-500",
    rule: "border-neutral-400",
  },
  short: {
    label: "Too short",
    note: "released before the recognizer came up; hold for about a second before speaking",
    tint: "text-amber-700",
    rule: "border-amber-500",
  },
  silent: {
    label: "Nothing came through",
    note: "the hold was long enough but no audio reached the page — this one is a fault",
    tint: "text-red-700",
    rule: "border-red-500",
  },
  refused: {
    label: "Refused",
    note: PROBE_REFUSED_THE_HOLD,
    tint: "text-amber-700",
    rule: "border-amber-500",
  },
  typed: {
    label: "Sent from the keyboard",
    note: "typed, not spoken",
    tint: "text-neutral-500",
    rule: "border-neutral-300",
  },
};

// --- the plugin's stream, tapped -------------------------------------------

// A second subscription to the dictation event, kept for the whole session. The
// tally is a ref because it is written fifteen times a second and read once per
// hold; only the level goes through state, and only to move a bar.
function useDictationTap(): {
  level: number;
  // Start a hold's tally over and drop the meter back to the floor, so the last
  // hold's level is not still standing there under the next one.
  reset: () => void;
  tally: React.MutableRefObject<Heard>;
  // The last hold's segments, as the plugin sent them once the run was down.
  // Last one wins and the press clears it, so a set of numbers that arrived too
  // late for its own row is dropped rather than written against the next one.
  timing: React.MutableRefObject<DictationTiming | null>;
  error: string | null;
} {
  const tally = useRef<Heard>({ ...NO_HEARD });
  const timing = useRef<DictationTiming | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasOnDeviceDictation()) {
      setError("This host has no on-device dictation — the bench needs the iPhone build.");
      return;
    }
    let live = true;
    let listener: { unregister(): Promise<void> } | null = null;
    addPluginListener<DictationEvent>(VOICE_PLUGIN, DICTATION_EVENT, (e) => {
      const t = tally.current;
      if (e.kind === "level") {
        t.levels += 1;
        t.peak = Math.max(t.peak, e.value);
        setLevel(e.value);
      } else if (e.kind === "final") {
        t.finals += 1;
      } else if (e.kind === "volatile") {
        t.volatiles += 1;
      } else {
        timing.current = e.timing;
      }
    })
      .then((l) => {
        if (live) listener = l;
        else void l.unregister().catch(() => {});
      })
      .catch((e: unknown) => setError(`Could not listen to the plugin: ${String(e)}`));
    return () => {
      live = false;
      void listener?.unregister().catch(() => {});
    };
  }, []);

  const reset = useCallback(() => {
    tally.current = { ...NO_HEARD };
    timing.current = null;
    setLevel(0);
  }, []);

  return { level, reset, tally, timing, error };
}

// --- the screen --------------------------------------------------------------

function Bench() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [locale, setLocale] = useState<DictationLocale | null>(null);
  const [switching, setSwitching] = useState(false);
  const [holding, setHolding] = useState(false);
  // Whether the probe has been in the audio stack since the last hold, mirrored
  // from the button that put it there. The plugin keeps the same flag and is the
  // one that enforces it; this copy exists so the warning is on screen before
  // the press rather than only in the row after it. One press clears it on both
  // sides — the plugin's refusal resets the stack, and the row that press
  // produces is what clears this.
  const [probeTouched, setProbeTouched] = useState(false);
  const { level, reset, tally, timing, error } = useDictationTap();

  const hostRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const localeRef = useRef<DictationLocale>("zh-CN");
  localeRef.current = locale ?? "zh-CN";

  // The hold being watched: when it went down, when it came up, and the timer
  // that closes it if nothing else does.
  const gesture = useRef<{ at: number; releasedAt: number; timer: number } | null>(null);

  // Every row goes two places: the list on screen, and the file. The id is
  // taken here rather than inside the updater so the row and its line carry the
  // same number.
  const append = useCallback(
    (
      outcome: BenchOutcome,
      text: string,
      heard: Heard | null,
      segments: DictationTiming | null,
    ) => {
      const entry: Entry = {
        id: nextId.current++,
        outcome,
        text,
        heard,
        locale: localeRef.current,
        timing: segments,
      };
      setEntries((list) => [...list, entry]);
      benchJournal.hold({
        index: entry.id,
        outcome: entry.outcome,
        text: entry.text,
        heard: entry.heard,
        locale: entry.locale,
        timing: entry.timing,
      });
    },
    [],
  );

  // Close the hold being watched, reading its outcome off the three signals in
  // hold-outcome.ts.
  const settle = useCallback(
    (sent: boolean, text: string) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      window.clearTimeout(g.timer);
      setProbeTouched(false);
      const heard: Heard = {
        ...tally.current,
        ms: (g.releasedAt || Date.now()) - g.at,
      };
      append(
        classifyHold({
          sent,
          keyboardBack: !!hostRef.current?.querySelector("textarea"),
          heard,
          // The plugin says so itself: every hold carries whether a probe had
          // been in the audio stack since the last one, which is the press it
          // refuses rather than a microphone that failed.
          refused: probeRefusedTheHold(timing.current),
        }),
        text,
        heard,
        // Whatever crossed back before this row was made. The plugin sends it
        // once the run is down, which is inside the flush window the row waits
        // out; a hold that ends before it arrives keeps null rather than
        // borrowing the last one's numbers.
        timing.current,
      );
    },
    [append, tally, timing],
  );

  // A send from the composer. It is the same prop the real chat passes, so a
  // hold released on the bar and a line typed on the keyboard both arrive here;
  // which one it was is whether a hold is open.
  const onSend = useCallback(
    (text: string) => {
      if (gesture.current) settle(true, text);
      else append("typed", text, null, null);
    },
    [append, settle],
  );

  // Pointer events on the way down through the composer, so the hold can be
  // watched without the composer knowing. Only the bar counts: the mic toggle
  // and the send button carry aria-labels of their own, and the bar is the one
  // unlabelled button in voice mode (it takes "Listening" once the hold is up).
  const onPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      const button = (e.target as Element | null)?.closest?.("button");
      if (!button) return;
      const label = button.getAttribute("aria-label");
      if (label && label !== "Listening") return;
      // A hold that started while the last one was still open closes it first.
      settle(false, "");
      reset();
      gesture.current = { at: Date.now(), releasedAt: 0, timer: 0 };
      setHolding(true);
      // The screen lock is refused without user activation (docs/pitfall/162),
      // so the first real touch is where it can be asked for. Repeat requests
      // are harmless and the phone auto-locks in two minutes without one.
      void holdTheScreen();
    },
    [reset, settle],
  );

  const onPointerUpCapture = useCallback(() => {
    const g = gesture.current;
    if (!g || g.releasedAt) return;
    g.releasedAt = Date.now();
    setHolding(false);
    g.timer = window.setTimeout(() => settle(false, ""), RESOLVE_MS);
  }, [settle]);

  // The language, through the file the settings card writes and the composer
  // reads. The flush matters: the composer re-reads settings.json on mount and
  // the store holds a save for half a second, so remounting without it would
  // arm the recognizer in the language just switched away from.
  const pick = useCallback(
    async (next: DictationLocale) => {
      if (switching || next === locale) return;
      setSwitching(true);
      try {
        const current = await loadSettings();
        saveSettings({ ...current, dictationLocale: next });
        await flushSettings();
        setLocale(next);
      } finally {
        setSwitching(false);
      }
    },
    [locale, switching],
  );

  // Open the file before anything can be written to it, so the rows below it
  // are known to belong to this launch and not to the one before.
  useEffect(() => {
    benchJournal.session();
  }, []);

  useEffect(() => {
    loadSettings()
      .then((s) => setLocale(s.dictationLocale))
      .catch(() => setLocale("zh-CN"));
  }, []);

  // The composer opens on the keyboard — voice is a place the user goes, which
  // is right in the product and one tap of ceremony here. The toggle is pressed
  // for them on mount and after every language switch, so the bar is on screen
  // when the app is.
  useEffect(() => {
    if (locale === null) return;
    const id = window.setTimeout(() => {
      const toggle = hostRef.current?.querySelector<HTMLButtonElement>(
        'button[aria-label="Switch to voice"]',
      );
      toggle?.click();
    }, 60);
    return () => window.clearTimeout(id);
  }, [locale]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="flex h-dvh flex-col bg-white pt-safe-3 pr-safe-3 pb-safe-3 pl-safe-3 text-neutral-900">
      <header className="flex shrink-0 items-center justify-between gap-3 px-1 pb-2">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-tight">Hold to talk</div>
          <div className="text-[12px] text-neutral-500">
            {entries.length === 0 ? "nothing yet" : `${entries.length} holds`}
          </div>
        </div>
        <div className="flex shrink-0 rounded-full bg-neutral-100 p-1">
          {DICTATION_LOCALE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={switching || locale === null}
              onClick={() => void pick(o.value)}
              className={
                "min-h-11 rounded-full px-4 text-[14px] font-medium transition-colors " +
                (locale === o.value ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </header>

      <LiveStrip holding={holding} level={level} error={error} />

      <IndicatorProbe onTouched={() => setProbeTouched(true)} />

      {probeTouched && (
        <div className="mt-1 shrink-0 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
          {PROBE_ENDS_THE_RUN}
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {entries.length === 0 ? (
          <Instructions />
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      <div
        ref={hostRef}
        className="shrink-0 px-1 pt-2"
        onPointerDownCapture={onPointerDownCapture}
        onPointerUpCapture={onPointerUpCapture}
        onPointerCancelCapture={onPointerUpCapture}
      >
        {locale !== null && (
          // Keyed by language: the composer reads the setting once, when it
          // mounts, so a switch has to give it a new mount to read it in.
          <Composer key={locale} onSend={onSend} placeholder="Say something…" pill />
        )}
      </div>
    </div>
  );
}

// The run as it happens: the level the plugin is reporting, and how much of it
// there has been. No text — the bar hides its transcript on purpose while the
// finger is down, and showing it here would undo that.
function LiveStrip({
  holding,
  level,
  error,
}: {
  holding: boolean;
  level: number;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-[13px] leading-snug text-red-700">
        {error}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2">
      <span className="w-16 shrink-0 text-[12px] font-medium tabular-nums text-neutral-500">
        {holding ? `${Math.round(level * 100)}%` : "input"}
      </span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-200">
        <span
          className={"block h-full rounded-full " + (holding ? "bg-primary" : "bg-neutral-300")}
          style={{ width: `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%` }}
        />
      </span>
    </div>
  );
}

// The orange indicator, one step at a time. Each button parks the audio stack
// somewhere and leaves it there until another is pressed, so the question is
// answered by looking at the status bar rather than by anything on this screen.
// What this screen shows is which step it is standing on and enough of the
// native state to prove it — a stage that says it installed a tap and reports no
// buffers is a stage that did not do what it says.
//
// It is folded away behind one button. The five stages used to sit open above
// the list, a row of full-width targets right above the thumb, and touching any
// of them — Off included — ends the run of holds in progress. A measurement a
// stray tap can spoil should not be one tap away.
//
// A stage is reported upwards the moment it is asked for, before the answer
// comes back: the native side tears the stack down on its way in, so a call that
// then fails has ended the run just as thoroughly as one that succeeded.
function IndicatorProbe({ onTouched }: { onTouched: () => void }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<IndicatorStage>("off");
  const [state, setState] = useState<IndicatorProbeState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = useCallback(
    async (wanted: IndicatorStage) => {
      setBusy(true);
      onTouched();
      try {
        const answer = await setIndicatorProbe(wanted);
        setStage(answer.stage);
        setState(answer);
        setFailure(null);
        benchJournal.probe(wanted, answer);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // The native side tears the probe down before it throws, so the stack is
        // at rest whatever went wrong.
        setStage("off");
        setState(null);
        setFailure(message);
        benchJournal.probe(wanted, { error: message });
      } finally {
        setBusy(false);
      }
    },
    [onTouched],
  );

  const note = INDICATOR_STAGE_OPTIONS.find((o) => o.value === stage)?.note ?? "";
  if (!open) {
    return (
      <div className="shrink-0 pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-11 rounded-lg bg-neutral-100 px-3 text-[12px] font-medium text-neutral-500"
        >
          Indicator probe{stage === "off" ? "" : ` · parked on ${stage}`}
        </button>
      </div>
    );
  }
  return (
    <div className="shrink-0 pt-2">
      <div className="flex gap-1">
        {INDICATOR_STAGE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={() => void pick(o.value)}
            className={
              "min-h-11 min-w-0 flex-1 rounded-lg px-1 text-[12px] font-medium transition-colors " +
              (stage === o.value
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-500")
            }
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 shrink-0 rounded-lg bg-neutral-100 px-2 text-[12px] font-medium text-neutral-500"
        >
          Hide
        </button>
      </div>
      <div className="px-2 pt-1 text-[11px] leading-snug text-neutral-500">
        {failure ? (
          <span className="text-red-700">{failure}</span>
        ) : (
          <>
            {note}
            {state && stage !== "off" && (
              <span className="tabular-nums">
                {" · "}
                {state.engineRunning ? "engine" : "no engine"} ·{" "}
                {state.tapInstalled ? "tap" : "no tap"} · {state.buffers} buffers · in [
                {state.inputs}]
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ entry }: { entry: Entry }) {
  const style = OUTCOME[entry.outcome];
  const h = entry.heard;
  // Press to first audio buffer, which is the number every one of these holds
  // is being run to find out. The rest of the segments are in the file.
  const firstBuffer = entry.timing?.steps.firstBuffer;
  return (
    <div className={"border-l-2 pl-3 " + style.rule}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={"text-[13px] font-semibold " + style.tint}>{style.label}</span>
        <span className="text-[11px] text-neutral-400">{entry.locale}</span>
        {entry.timing && (
          <span className="text-[11px] text-neutral-400">
            {entry.timing.reused ? "reused" : "built"}
          </span>
        )}
        {h && (
          <span className="text-[11px] tabular-nums text-neutral-400">
            {(h.ms / 1000).toFixed(1)}s · peak {Math.round(h.peak * 100)}% · {h.finals} settled ·{" "}
            {h.volatiles} guesses
          </span>
        )}
        {firstBuffer !== undefined && (
          <span className="text-[11px] tabular-nums text-neutral-400">
            {Math.round(firstBuffer)} ms to audio
          </span>
        )}
      </div>
      {entry.text ? (
        <div className="whitespace-pre-wrap break-words text-[16px] leading-snug text-neutral-900">
          {entry.text}
        </div>
      ) : (
        <div className="text-[13px] leading-snug text-neutral-500">{style.note}</div>
      )}
    </div>
  );
}

function Instructions() {
  return (
    <div className="flex flex-col gap-2 pt-2 text-[14px] leading-relaxed text-neutral-600">
      <p className="m-0">Hold the bar below and speak. Let go and the words land here.</p>
      <p className="m-0">
        While holding, slide up-left onto <b>Cancel</b> to throw the hold away, or up-right onto{" "}
        <b>Edit</b> to put the words in the field instead of sending them. Every hold gets a line
        here saying which of the three it was, so a cancel that worked does not look like a bar that
        did not.
      </p>
      <p className="m-0">
        The switch at the top is the dictation language. It is the same setting the app keeps, and
        speaking the other language into it produces a confident wrong transcript rather than a
        rough one, so set it to what you are about to speak.
      </p>
      <p className="m-0">
        Under it is the audio setting the next press uses. Hold five times on one before moving to
        the next; the second and later presses are the interesting ones, because that is where
        keeping the engine can show. Every line here and in the file says which one it ran on.
      </p>
      <p className="m-0">
        Behind <b>Indicator probe</b> is a row that parks the audio stack at one step and leaves it
        there, so the orange dot in the status bar can be read without guessing what turned it on.
        It is folded away because touching it ends the run of holds in progress — every stage,
        including <b>Off</b>, tears the whole stack down. The plugin refuses the first hold after
        one and puts the stack back to nothing in the same breath; that hold gets a row saying so,
        and the holds before it no longer belong to a run. Probe first, then measure, never the two
        interleaved.
      </p>
    </div>
  );
}

// --- entry point -------------------------------------------------------------

// Nothing on this build can be watched from outside it: console.log does not
// reach the device syslog from WKWebView, and iOS 26 moved the screenshot
// service behind the personalised developer image, which libimobiledevice
// cannot mount. So a page that throws is a white screen and no way to find out
// why — from here or from the person holding the phone. Both nets below turn
// that into a sentence they can read out.
function complain(what: string, e: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;
  const line = document.createElement("pre");
  line.style.cssText =
    "margin:0;padding:12px 14px;font:13px/1.45 ui-monospace,Menlo,monospace;" +
    "white-space:pre-wrap;word-break:break-word;color:#b91c1c;background:#fef2f2";
  line.textContent = `${what}: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`;
  root.prepend(line);
}

export function runDictationBench(): void {
  window.addEventListener("unhandledrejection", (event) => {
    complain("unhandled rejection", event.reason);
  });
  try {
    const root = document.getElementById("root") as HTMLElement;
    ReactDOM.createRoot(root).render(<Bench />);
  } catch (e) {
    complain("the bench did not mount", e);
  }
}
